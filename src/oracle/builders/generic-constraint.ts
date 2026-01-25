/**
 * Generic Constraint Builder
 *
 * Generates candidates for TS2344 "Type 'X' does not satisfy the constraint 'Y'"
 * by analyzing the constraint and the failing type to suggest repairs.
 *
 * Features:
 * - Add missing properties to interfaces/types to satisfy constraints
 * - Detect discriminated union constraints and suggest discriminator tags
 * - Confidence scoring for union member matches
 */

import ts from "typescript";
import type {
  SolutionBuilder,
  BuilderContext,
  CandidateFix,
  FileChange,
} from "../../output/types.js";
import { createSyntheticFix } from "../candidate.js";

/**
 * Information about a missing member.
 */
interface MissingMember {
  name: string;
  typeString: string;
  isOptional: boolean;
}

/**
 * Match source indicating how a member was determined to be missing.
 */
type MemberMatchSource = "direct" | "union-discriminator" | "structural";

/**
 * Represents a matched member with confidence scoring.
 */
interface MemberMatch {
  member: MissingMember;
  confidence: number; // 0-1
  source: MemberMatchSource;
}

/**
 * Information about a discriminated union type.
 */
interface DiscriminatedUnionInfo {
  discriminatorProperty: string;
  discriminatorValues: LiteralTypeResult[];
  commonMembers: MissingMember[];
}

/**
 * Extract the constraint message parts from a TS2344 diagnostic.
 * Format: "Type 'X' does not satisfy the constraint 'Y'"
 */
function parseConstraintMessage(
  message: string
): { failingTypeName: string; constraintTypeName: string } | undefined {
  const match = message.match(
    /Type '([^']+)' does not satisfy the constraint '([^']+)'/
  );
  if (!match) return undefined;
  return {
    failingTypeName: match[1],
    constraintTypeName: match[2],
  };
}

/**
 * Extract the base type name from a generic type expression.
 * E.g., "Result<unknown>" -> "Result", "Map<string, number>" -> "Map"
 */
function extractBaseTypeName(typeName: string): string {
  // Find the position of the first '<' to handle generic types
  const genericStart = typeName.indexOf("<");
  if (genericStart !== -1) {
    return typeName.slice(0, genericStart);
  }
  return typeName;
}

/**
 * Find an interface or type alias declaration by name across project files.
 * Handles generic type names by extracting the base type.
 */
function findTypeDeclaration(
  typeName: string,
  ctx: BuilderContext
):
  | { decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration; file: string }
  | undefined {
  // Extract base type name for generic types
  const baseTypeName = extractBaseTypeName(typeName);

  for (const fileName of ctx.host.getFileNames()) {
    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    // Visit all nodes looking for interface or type alias with matching name
    function visit(
      node: ts.Node
    ): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
      if (ts.isInterfaceDeclaration(node) && node.name.text === baseTypeName) {
        return node;
      }
      if (ts.isTypeAliasDeclaration(node) && node.name.text === baseTypeName) {
        return node;
      }
      return ts.forEachChild(node, visit);
    }

    const decl = visit(sourceFile);
    if (decl) {
      return { decl, file: fileName };
    }
  }
  return undefined;
}

/**
 * Extract member signatures from an interface declaration.
 */
function getInterfaceMembers(
  decl: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile
): MissingMember[] {
  const members: MissingMember[] = [];

  for (const member of decl.members) {
    if (ts.isPropertySignature(member) && member.name) {
      const name = ts.isIdentifier(member.name)
        ? member.name.text
        : member.name.getText(sourceFile);
      const typeNode = member.type;
      const typeString = typeNode ? typeNode.getText(sourceFile) : "unknown";
      const isOptional = member.questionToken !== undefined;

      members.push({ name, typeString, isOptional });
    }
  }

  return members;
}

/**
 * Get members from a type alias (if it's an object type literal or union type).
 */
function getTypeAliasMembers(
  decl: ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile
): MissingMember[] {
  const members: MissingMember[] = [];

  if (ts.isTypeLiteralNode(decl.type)) {
    for (const member of decl.type.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const name = ts.isIdentifier(member.name)
          ? member.name.text
          : member.name.getText(sourceFile);
        const typeNode = member.type;
        const typeString = typeNode ? typeNode.getText(sourceFile) : "unknown";
        const isOptional = member.questionToken !== undefined;

        members.push({ name, typeString, isOptional });
      }
    }
  } else if (ts.isUnionTypeNode(decl.type)) {
    // For union types, extract common members across all union branches
    const unionInfo = extractDiscriminatedUnionInfo(decl.type, sourceFile);
    if (unionInfo) {
      // Add the discriminator property as a required member
      // Format literals correctly: strings get quotes, numbers and booleans don't
      const discriminatorType = unionInfo.discriminatorValues
        .map((v) => formatLiteralValue(v))
        .join(" | ");
      members.push({
        name: unionInfo.discriminatorProperty,
        typeString: discriminatorType,
        isOptional: false,
      });

      // Add common members (but mark as optional since union branches may differ)
      for (const commonMember of unionInfo.commonMembers) {
        members.push(commonMember);
      }
    }
  }

  return members;
}

/**
 * Find the discriminator property in a union type.
 * A discriminator is a property present in all union members with literal type values.
 *
 * LIMITATION: This function only analyzes inline type literals.
 * Union types containing type references (e.g., `type Action = CreateAction | UpdateAction`)
 * are not supported because resolving type references requires the TypeChecker, which
 * would add significant complexity. For such unions, this function returns undefined.
 */
function findDiscriminatorProperty(
  unionTypeNode: ts.UnionTypeNode
): string | undefined {
  // Get members from all union branches
  const branchMembers: Map<string, Set<string>>[] = [];

  for (const typeNode of unionTypeNode.types) {
    // Only support inline type literals - skip type references
    // Type references would require TypeChecker to resolve, which adds complexity
    if (!ts.isTypeLiteralNode(typeNode)) {
      // If any branch is not a type literal, we cannot reliably detect discriminators
      return undefined;
    }

    const memberMap = new Map<string, Set<string>>();

    for (const member of typeNode.members) {
      if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
        const propName = member.name.text;
        const literalValue = extractLiteralTypeValue(member.type);
        if (literalValue !== undefined) {
          const values = memberMap.get(propName) ?? new Set<string>();
          values.add(literalValue.value);
          memberMap.set(propName, values);
        }
      }
    }

    branchMembers.push(memberMap);
  }

  if (branchMembers.length === 0) return undefined;

  // Find properties that exist in ALL branches with DIFFERENT literal values
  const firstBranch = branchMembers[0];
  for (const [propName, values] of firstBranch) {
    let isPresentInAll = true;
    const allValues = new Set(values);

    for (let i = 1; i < branchMembers.length; i++) {
      const branchMap = branchMembers[i];
      if (!branchMap.has(propName)) {
        isPresentInAll = false;
        break;
      }
      for (const v of branchMap.get(propName)!) {
        allValues.add(v);
      }
    }

    // A good discriminator is present in all branches with distinct literal values
    if (isPresentInAll && allValues.size === branchMembers.length) {
      return propName;
    }
  }

  return undefined;
}

/**
 * The kind of a literal type.
 */
type LiteralKind = "string" | "number" | "boolean";

/**
 * Result of extracting a literal type value, including kind for proper formatting.
 */
interface LiteralTypeResult {
  value: string;
  kind: LiteralKind;
}

/**
 * Extract a literal value from a type node.
 * Handles string literals, number literals, and boolean literals (true/false).
 * Returns both the value and the literal kind for proper code generation.
 */
function extractLiteralTypeValue(
  typeNode: ts.TypeNode | undefined
): LiteralTypeResult | undefined {
  if (!typeNode) return undefined;

  if (ts.isLiteralTypeNode(typeNode)) {
    const literal = typeNode.literal;
    if (ts.isStringLiteral(literal)) {
      return { value: literal.text, kind: "string" };
    }
    if (ts.isNumericLiteral(literal)) {
      return { value: literal.text, kind: "number" };
    }
    // Handle boolean literals (TrueKeyword and FalseKeyword)
    if (literal.kind === ts.SyntaxKind.TrueKeyword) {
      return { value: "true", kind: "boolean" };
    }
    if (literal.kind === ts.SyntaxKind.FalseKeyword) {
      return { value: "false", kind: "boolean" };
    }
  }

  return undefined;
}

/**
 * Format a literal value for TypeScript code generation.
 * Only string literals need quotes; numbers and booleans are output as-is.
 */
function formatLiteralValue(literal: LiteralTypeResult): string {
  if (literal.kind === "string") {
    return `"${literal.value}"`;
  }
  // Numbers and booleans don't need quotes
  return literal.value;
}

/**
 * Extract discriminated union information from a union type node.
 */
function extractDiscriminatedUnionInfo(
  unionTypeNode: ts.UnionTypeNode,
  sourceFile: ts.SourceFile
): DiscriminatedUnionInfo | undefined {
  const discriminatorProperty = findDiscriminatorProperty(unionTypeNode);
  if (!discriminatorProperty) return undefined;

  const discriminatorValues: LiteralTypeResult[] = [];
  const allBranchMembers: MissingMember[][] = [];

  // Extract members and discriminator values from each branch
  for (const typeNode of unionTypeNode.types) {
    if (ts.isTypeLiteralNode(typeNode)) {
      const branchMembers: MissingMember[] = [];

      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          const propName = member.name.text;

          if (propName === discriminatorProperty) {
            const literalValue = extractLiteralTypeValue(member.type);
            if (literalValue !== undefined) {
              discriminatorValues.push(literalValue);
            }
          } else {
            const typeString = member.type ? member.type.getText(sourceFile) : "unknown";
            const isOptional = member.questionToken !== undefined;
            branchMembers.push({ name: propName, typeString, isOptional });
          }
        }
      }

      allBranchMembers.push(branchMembers);
    }
  }

  // Find common members across all branches
  const commonMembers = findCommonMembers(allBranchMembers);

  return {
    discriminatorProperty,
    discriminatorValues,
    commonMembers,
  };
}

/**
 * Find members that are common across all branches (same name and type).
 */
function findCommonMembers(allBranchMembers: MissingMember[][]): MissingMember[] {
  if (allBranchMembers.length === 0) return [];
  if (allBranchMembers.length === 1) return allBranchMembers[0];

  const firstBranch = allBranchMembers[0];
  const commonMembers: MissingMember[] = [];

  for (const member of firstBranch) {
    let isCommon = true;
    for (let i = 1; i < allBranchMembers.length; i++) {
      const branch = allBranchMembers[i];
      const found = branch.find(
        (m) => m.name === member.name && m.typeString === member.typeString
      );
      if (!found) {
        isCommon = false;
        break;
      }
    }
    if (isCommon) {
      commonMembers.push(member);
    }
  }

  return commonMembers;
}

/**
 * Analyze constraint members and compute confidence-scored matches.
 */
function computeMemberMatches(
  constraintMembers: MissingMember[],
  existingMemberNames: Set<string>,
  constraintDecl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  constraintSourceFile: ts.SourceFile
): MemberMatch[] {
  const matches: MemberMatch[] = [];

  // Check for discriminated union in constraint
  let unionInfo: DiscriminatedUnionInfo | undefined;
  if (ts.isTypeAliasDeclaration(constraintDecl) && ts.isUnionTypeNode(constraintDecl.type)) {
    unionInfo = extractDiscriminatedUnionInfo(constraintDecl.type, constraintSourceFile);
  }

  for (const member of constraintMembers) {
    if (existingMemberNames.has(member.name) || member.isOptional) {
      continue;
    }

    let source: MemberMatchSource = "direct";
    let confidence = 0.8; // Default confidence for direct matches

    // Check if this is the discriminator property
    if (unionInfo && member.name === unionInfo.discriminatorProperty) {
      source = "union-discriminator";
      confidence = 1.0; // Highest confidence for discriminator
    } else if (unionInfo && unionInfo.commonMembers.some((m) => m.name === member.name)) {
      source = "structural";
      confidence = 0.7; // Lower confidence for structural matches from union
    }

    matches.push({ member, confidence, source });
  }

  // Sort by confidence (highest first), then by source priority
  matches.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Discriminator > direct > structural
    const sourcePriority: Record<MemberMatchSource, number> = {
      "union-discriminator": 3,
      direct: 2,
      structural: 1,
    };
    return sourcePriority[b.source] - sourcePriority[a.source];
  });

  return matches;
}

/**
 * Get the names of members already present in a type declaration.
 */
function getExistingMemberNames(
  decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  _sourceFile: ts.SourceFile
): Set<string> {
  const names = new Set<string>();

  if (ts.isInterfaceDeclaration(decl)) {
    for (const member of decl.members) {
      if (
        ts.isPropertySignature(member) &&
        member.name &&
        ts.isIdentifier(member.name)
      ) {
        names.add(member.name.text);
      }
    }
  } else if (ts.isTypeAliasDeclaration(decl) && ts.isTypeLiteralNode(decl.type)) {
    for (const member of decl.type.members) {
      if (
        ts.isPropertySignature(member) &&
        member.name &&
        ts.isIdentifier(member.name)
      ) {
        names.add(member.name.text);
      }
    }
  }

  return names;
}

/**
 * Find the insertion position for new members in an interface.
 */
function findMemberInsertPosition(
  decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile
): number {
  if (ts.isInterfaceDeclaration(decl)) {
    // Insert before the closing brace
    // Find the last member or the opening brace
    if (decl.members.length > 0) {
      const lastMember = decl.members[decl.members.length - 1];
      return lastMember.getEnd();
    } else {
      // Empty interface: find the opening brace position
      const text = sourceFile.text;
      const start = decl.getStart(sourceFile);
      const openBrace = text.indexOf("{", start);
      return openBrace + 1;
    }
  } else if (ts.isTypeAliasDeclaration(decl) && ts.isTypeLiteralNode(decl.type)) {
    if (decl.type.members.length > 0) {
      const lastMember = decl.type.members[decl.type.members.length - 1];
      return lastMember.getEnd();
    } else {
      const text = sourceFile.text;
      const start = decl.type.getStart(sourceFile);
      const openBrace = text.indexOf("{", start);
      return openBrace + 1;
    }
  }

  return -1;
}

/**
 * Generate the text for new member declarations.
 */
function generateMemberText(members: MissingMember[]): string {
  if (members.length === 0) return "";

  const memberText = members.map((m) => `  ${m.name}: ${m.typeString};`).join("\n");

  return "\n" + memberText;
}

/**
 * GenericConstraintBuilder - Repairs generic constraint violations.
 *
 * This builder targets TS2344 "Type 'X' does not satisfy the constraint 'Y'"
 * errors and generates synthetic candidates to add missing properties
 * to the failing type.
 */
export const GenericConstraintBuilder: SolutionBuilder = {
  name: "GenericConstraintBuilder",
  description: "Repairs generic constraint violations by adding missing members",
  diagnosticCodes: [2344],

  matches(ctx: BuilderContext): boolean {
    if (ctx.diagnostic.code !== 2344) return false;

    // Parse the error message to extract type names
    const message = ts.flattenDiagnosticMessageText(
      ctx.diagnostic.messageText,
      "\n"
    );
    const parsed = parseConstraintMessage(message);
    if (!parsed) return false;

    // Must be able to find the failing type declaration
    const failingTypeDecl = findTypeDeclaration(parsed.failingTypeName, ctx);
    if (!failingTypeDecl) return false;

    // Must be able to find the constraint declaration
    const constraintDecl = findTypeDeclaration(parsed.constraintTypeName, ctx);
    if (!constraintDecl) return false;

    return true;
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    const candidates: CandidateFix[] = [];

    const message = ts.flattenDiagnosticMessageText(
      ctx.diagnostic.messageText,
      "\n"
    );
    const parsed = parseConstraintMessage(message);
    if (!parsed) return candidates;

    // Find the failing type declaration
    const failingTypeResult = findTypeDeclaration(parsed.failingTypeName, ctx);
    if (!failingTypeResult) return candidates;

    const { decl: failingDecl, file: failingFile } = failingTypeResult;
    const failingSourceFile = ctx.getSourceFile(failingFile);
    if (!failingSourceFile) return candidates;

    // Find the constraint declaration
    const constraintResult = findTypeDeclaration(parsed.constraintTypeName, ctx);
    if (!constraintResult) return candidates;

    const { decl: constraintDecl, file: constraintFile } = constraintResult;
    const constraintSourceFile = ctx.getSourceFile(constraintFile);
    if (!constraintSourceFile) return candidates;

    // Extract constraint members
    let constraintMembers: MissingMember[] = [];
    if (ts.isInterfaceDeclaration(constraintDecl)) {
      constraintMembers = getInterfaceMembers(constraintDecl, constraintSourceFile);
    } else if (ts.isTypeAliasDeclaration(constraintDecl)) {
      constraintMembers = getTypeAliasMembers(constraintDecl, constraintSourceFile);
    }

    if (constraintMembers.length === 0) return candidates;

    // Get existing members of the failing type
    const existingMemberNames = getExistingMemberNames(failingDecl, failingSourceFile);

    // Compute member matches with confidence scoring
    const memberMatches = computeMemberMatches(
      constraintMembers,
      existingMemberNames,
      constraintDecl,
      constraintSourceFile
    );

    if (memberMatches.length === 0) return candidates;

    // Find insertion position
    const insertPos = findMemberInsertPosition(failingDecl, failingSourceFile);
    if (insertPos < 0) return candidates;

    // Extract just the members for text generation
    const missingMembers = memberMatches.map((m) => m.member);

    // Generate the fix text
    const newText = generateMemberText(missingMembers);

    const change: FileChange = {
      file: failingFile,
      start: insertPos,
      end: insertPos,
      newText,
    };

    // Check if this involves a discriminated union
    const hasDiscriminator = memberMatches.some((m) => m.source === "union-discriminator");
    const tags = ["generic-constraint", "add-member"];
    if (hasDiscriminator) {
      tags.push("discriminated-union");
    }

    // Calculate average confidence
    const avgConfidence =
      memberMatches.reduce((sum, m) => sum + m.confidence, 0) / memberMatches.length;

    // Determine risk based on confidence and match sources
    let riskHint: "low" | "medium" | "high" = "medium";
    if (avgConfidence >= 0.9) {
      riskHint = "low";
    } else if (avgConfidence < 0.7) {
      riskHint = "high";
    }

    const memberNames = missingMembers.map((m) => m.name).join(", ");
    const description = hasDiscriminator
      ? `Add discriminator tag and missing member${missingMembers.length > 1 ? "s" : ""}: ${memberNames}`
      : `Add missing member${missingMembers.length > 1 ? "s" : ""}: ${memberNames}`;

    const candidate = createSyntheticFix(
      "addMissingConstraintMembers",
      description,
      [change],
      {
        scopeHint: "errors",
        riskHint,
        tags,
        metadata: {
          failingType: parsed.failingTypeName,
          constraintType: parsed.constraintTypeName,
          missingMembers: missingMembers.map((m) => m.name),
          memberMatches: memberMatches.map((m) => ({
            name: m.member.name,
            confidence: m.confidence,
            source: m.source,
          })),
          avgConfidence,
          hasDiscriminator,
        },
      }
    );

    candidates.push(candidate);
    return candidates;
  },
};
