/**
 * Instantiation Depth Builder
 *
 * Generates candidates for TS2589 "Type instantiation is excessively deep and possibly infinite"
 * by adding intersection reset patterns (`& {}`) to recursive type definitions.
 *
 * The `& {}` intersection works because TypeScript's instantiation depth counter resets
 * at certain boundaries. An intersection with an empty object type creates such a boundary
 * without changing the type's structural behavior for most practical purposes.
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
 * Information about a recursive type alias.
 */
interface RecursiveTypeInfo {
  /** The file containing the type alias */
  file: string;
  /** The type alias declaration */
  declaration: ts.TypeAliasDeclaration;
  /** The name of the type */
  typeName: string;
  /** Positions of recursive references */
  recursiveReferences: Array<{ node: ts.TypeNode; start: number; end: number }>;
}

/**
 * Find a type alias declaration by name across project files.
 */
function findTypeAliasDeclaration(
  typeName: string,
  ctx: BuilderContext
): { file: string; declaration: ts.TypeAliasDeclaration } | undefined {
  for (const fileName of ctx.host.getFileNames()) {
    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    function visit(node: ts.Node): ts.TypeAliasDeclaration | undefined {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
        return node;
      }
      return ts.forEachChild(node, visit);
    }

    const declaration = visit(sourceFile);
    if (declaration) {
      return { file: fileName, declaration };
    }
  }
  return undefined;
}

/**
 * Check if a type node references a specific type name.
 */
function isRecursiveReference(node: ts.TypeNode, typeName: string): boolean {
  if (ts.isTypeReferenceNode(node)) {
    if (ts.isIdentifier(node.typeName) && node.typeName.text === typeName) {
      return true;
    }
  }
  return false;
}

/**
 * Find all recursive references within a type alias.
 * A recursive reference is when the type references itself.
 */
function findRecursiveReferences(
  declaration: ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile
): Array<{ node: ts.TypeNode; start: number; end: number }> {
  const typeName = declaration.name.text;
  const references: Array<{ node: ts.TypeNode; start: number; end: number }> = [];

  function visit(node: ts.Node): void {
    if (
      ts.isTypeNode(node) &&
      isRecursiveReference(node as ts.TypeNode, typeName)
    ) {
      references.push({
        node: node as ts.TypeNode,
        start: node.getStart(sourceFile),
        end: node.getEnd(),
      });
    }
    ts.forEachChild(node, visit);
  }

  // Only search within the type alias body, not the name
  if (declaration.type) {
    visit(declaration.type);
  }

  return references;
}

/**
 * Analyze a type alias to determine if it's recursive and find repair points.
 */
function analyzeRecursiveType(
  typeName: string,
  ctx: BuilderContext
): RecursiveTypeInfo | undefined {
  const found = findTypeAliasDeclaration(typeName, ctx);
  if (!found) return undefined;

  const { file, declaration } = found;
  const sourceFile = ctx.getSourceFile(file);
  if (!sourceFile) return undefined;

  const recursiveReferences = findRecursiveReferences(declaration, sourceFile);

  // If no recursive references, this isn't the source of the problem
  if (recursiveReferences.length === 0) {
    return undefined;
  }

  return {
    file,
    declaration,
    typeName,
    recursiveReferences,
  };
}

/**
 * Find type aliases that are referenced at the diagnostic position.
 */
function findTypeAliasesAtDiagnostic(ctx: BuilderContext): RecursiveTypeInfo[] {
  const results: RecursiveTypeInfo[] = [];

  if (!ctx.diagnostic.file || ctx.diagnostic.start === undefined) {
    return results;
  }

  const sourceFile = ctx.diagnostic.file;
  const position = ctx.diagnostic.start;

  // Collect all type references at/near the diagnostic position
  const typeNames = new Set<string>();

  function collectTypeRefs(node: ts.Node): void {
    if (position < node.getStart(sourceFile) || position >= node.getEnd()) {
      return;
    }

    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      typeNames.add(node.typeName.text);
    }

    ts.forEachChild(node, collectTypeRefs);
  }

  collectTypeRefs(sourceFile);

  // Analyze each found type name
  for (const typeName of typeNames) {
    const info = analyzeRecursiveType(typeName, ctx);
    if (info) {
      results.push(info);
    }
  }

  return results;
}

/**
 * Generate a candidate that applies the intersection reset pattern.
 *
 * This wraps recursive type references with `& {}` to reset the
 * TypeScript compiler's instantiation depth counter.
 */
function generateIntersectionResetCandidate(
  info: RecursiveTypeInfo,
  ctx: BuilderContext
): CandidateFix | undefined {
  const sourceFile = ctx.getSourceFile(info.file);
  if (!sourceFile) return undefined;

  const changes: FileChange[] = [];

  // For each recursive reference, add `& {}` after it
  for (const ref of info.recursiveReferences) {
    // Skip if already wrapped with intersection
    const textAfter = sourceFile.text.slice(ref.end, ref.end + 10);
    if (textAfter.trim().startsWith("& {}")) {
      continue;
    }

    // Check parent context - if it's inside a conditional type true/false branch
    // we want to wrap at the appropriate level
    const parent = ref.node.parent;

    if (parent && ts.isIndexedAccessTypeNode(parent)) {
      // For indexed access like `Deep<T[K]>`, wrap the whole thing
      changes.push({
        file: info.file,
        start: parent.getEnd(),
        end: parent.getEnd(),
        newText: " & {}",
      });
    } else {
      // Default: add intersection after the type reference
      changes.push({
        file: info.file,
        start: ref.end,
        end: ref.end,
        newText: " & {}",
      });
    }
  }

  // Deduplicate changes at the same position
  const uniqueChanges = changes.filter(
    (change, index, self) =>
      index === self.findIndex((c) => c.start === change.start && c.file === change.file)
  );

  if (uniqueChanges.length === 0) {
    return undefined;
  }

  return createSyntheticFix(
    "addIntersectionReset",
    `Add intersection reset to recursive type '${info.typeName}'`,
    uniqueChanges,
    {
      scopeHint: "wide",
      riskHint: "high",
      tags: ["recursive-type", "instantiation-depth", "intersection-reset"],
      metadata: {
        typeName: info.typeName,
        recursiveRefCount: info.recursiveReferences.length,
        pattern: "intersection-reset",
      },
    }
  );
}

/**
 * InstantiationDepthBuilder - Repairs excessive type instantiation depth errors.
 *
 * This builder targets TS2589 "Type instantiation is excessively deep and possibly infinite"
 * errors and generates synthetic candidates using the intersection reset pattern (`& {}`).
 */
export const InstantiationDepthBuilder: SolutionBuilder = {
  name: "InstantiationDepthBuilder",
  description: "Repairs excessive type instantiation depth errors (TS2589)",
  diagnosticCodes: [2589],

  matches(ctx: BuilderContext): boolean {
    if (ctx.diagnostic.code !== 2589) return false;

    // Check if we can find any recursive type aliases related to this diagnostic
    const typeInfos = findTypeAliasesAtDiagnostic(ctx);
    return typeInfos.length > 0;
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    const candidates: CandidateFix[] = [];

    // Find all recursive types at the diagnostic position
    const typeInfos = findTypeAliasesAtDiagnostic(ctx);

    for (const info of typeInfos) {
      // Generate intersection reset candidate
      const resetCandidate = generateIntersectionResetCandidate(info, ctx);
      if (resetCandidate) {
        candidates.push(resetCandidate);
      }
    }

    // Limit to a reasonable number of candidates
    return candidates.slice(0, 4);
  },
};
