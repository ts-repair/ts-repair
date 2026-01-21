/**
 * Generic Constraint Builder
 *
 * Generates candidates for TS2344 "Type 'X' does not satisfy the constraint 'Y'"
 * by analyzing the constraint and the failing type to suggest repairs.
 *
 * Initial scope: Add missing properties to interfaces/types to satisfy constraints.
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
 * Find an interface or type alias declaration by name across project files.
 */
function findTypeDeclaration(
  typeName: string,
  ctx: BuilderContext
):
  | { decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration; file: string }
  | undefined {
  for (const fileName of ctx.host.getFileNames()) {
    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    // Visit all nodes looking for interface or type alias with matching name
    function visit(
      node: ts.Node
    ): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
      if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
        return node;
      }
      if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
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
 * Get members from a type alias (if it's an object type literal).
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
  }

  return members;
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
 * Compute members that are in the constraint but missing from the failing type.
 */
function computeMissingMembers(
  constraintMembers: MissingMember[],
  existingMemberNames: Set<string>
): MissingMember[] {
  return constraintMembers.filter(
    (member) => !existingMemberNames.has(member.name) && !member.isOptional
  );
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

    // Compute missing members
    const missingMembers = computeMissingMembers(
      constraintMembers,
      existingMemberNames
    );

    if (missingMembers.length === 0) return candidates;

    // Find insertion position
    const insertPos = findMemberInsertPosition(failingDecl, failingSourceFile);
    if (insertPos < 0) return candidates;

    // Generate the fix text
    const newText = generateMemberText(missingMembers);

    const change: FileChange = {
      file: failingFile,
      start: insertPos,
      end: insertPos,
      newText,
    };

    const memberNames = missingMembers.map((m) => m.name).join(", ");
    const description = `Add missing member${missingMembers.length > 1 ? "s" : ""}: ${memberNames}`;

    const candidate = createSyntheticFix(
      "addMissingConstraintMembers",
      description,
      [change],
      {
        scopeHint: "errors",
        riskHint: "medium",
        tags: ["generic-constraint", "add-member"],
        metadata: {
          failingType: parsed.failingTypeName,
          constraintType: parsed.constraintTypeName,
          missingMembers: missingMembers.map((m) => m.name),
        },
      }
    );

    candidates.push(candidate);
    return candidates;
  },
};
