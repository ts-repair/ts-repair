/**
 * Instantiation Depth Builder
 *
 * Generates candidates for TS2589 "Type instantiation is excessively deep and possibly infinite"
 * by adding intersection reset patterns (`& {}`) to recursive type definitions.
 *
 * The `& {}` intersection works because TypeScript's instantiation depth counter resets
 * at certain boundaries. An intersection with an empty object type creates such a boundary
 * without changing the type's structural behavior for most practical purposes.
 *
 * Detection Strategy (Tiered):
 * 1. Direct type reference at position - First attempt
 * 2. Walk up AST for enclosing type contexts - If Tier 1 empty
 * 3. Call site analysis (function return types) - If Tier 2 empty
 * 4. Related diagnostics correlation - If Tier 3 empty
 * 5. Project-wide scan for recursive types - Last resort fallback
 */

import ts from "typescript";
import type {
  SolutionBuilder,
  BuilderContext,
  CandidateFix,
  FileChange,
} from "../../output/types.js";
import type { TypeScriptHost } from "../typescript.js";
import { createSyntheticFix } from "../candidate.js";

/** Maximum candidates to return */
const MAX_CANDIDATES = 4;

/**
 * Lookahead buffer size for checking if intersection reset already exists.
 * We check this many characters after a type reference to see if `& {}` is already present.
 * The value 10 covers " & {}" (5 chars) plus whitespace variations.
 */
const INTERSECTION_LOOKAHEAD_SIZE = 10;

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
 * Cache for recursive type analysis results.
 * Keyed by TypeScriptHost to ensure cache invalidation on project changes.
 */
const recursiveTypeCache = new WeakMap<TypeScriptHost, Map<string, RecursiveTypeInfo | null>>();

/**
 * Get the per-host recursive type cache, creating it if needed.
 */
function getRecursiveTypeCache(host: TypeScriptHost): Map<string, RecursiveTypeInfo | null> {
  let cache = recursiveTypeCache.get(host);
  if (!cache) {
    cache = new Map();
    recursiveTypeCache.set(host, cache);
  }
  return cache;
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
 * Uses caching to avoid repeated analysis of the same type.
 */
function analyzeRecursiveType(
  typeName: string,
  ctx: BuilderContext
): RecursiveTypeInfo | undefined {
  // Check cache first
  const cache = getRecursiveTypeCache(ctx.host);
  if (cache.has(typeName)) {
    return cache.get(typeName) ?? undefined;
  }

  const found = findTypeAliasDeclaration(typeName, ctx);
  if (!found) {
    cache.set(typeName, null);
    return undefined;
  }

  const { file, declaration } = found;
  const sourceFile = ctx.getSourceFile(file);
  if (!sourceFile) {
    cache.set(typeName, null);
    return undefined;
  }

  const recursiveReferences = findRecursiveReferences(declaration, sourceFile);

  // If no recursive references, this isn't the source of the problem
  if (recursiveReferences.length === 0) {
    cache.set(typeName, null);
    return undefined;
  }

  const result: RecursiveTypeInfo = {
    file,
    declaration,
    typeName,
    recursiveReferences,
  };

  cache.set(typeName, result);
  return result;
}

// =============================================================================
// Tier 1: Direct type reference at diagnostic position
// =============================================================================

/**
 * Collect type references from a TypeNode recursively.
 */
function collectTypeRefsFromTypeNode(node: ts.TypeNode, typeNames: Set<string>): void {
  if (ts.isTypeReferenceNode(node)) {
    if (ts.isIdentifier(node.typeName)) {
      typeNames.add(node.typeName.text);
    }
    // Also collect from type arguments
    if (node.typeArguments) {
      for (const arg of node.typeArguments) {
        collectTypeRefsFromTypeNode(arg, typeNames);
      }
    }
  } else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const t of node.types) {
      collectTypeRefsFromTypeNode(t, typeNames);
    }
  } else if (ts.isArrayTypeNode(node)) {
    collectTypeRefsFromTypeNode(node.elementType, typeNames);
  } else if (ts.isTupleTypeNode(node)) {
    for (const elem of node.elements) {
      collectTypeRefsFromTypeNode(elem, typeNames);
    }
  } else if (ts.isConditionalTypeNode(node)) {
    collectTypeRefsFromTypeNode(node.checkType, typeNames);
    collectTypeRefsFromTypeNode(node.extendsType, typeNames);
    collectTypeRefsFromTypeNode(node.trueType, typeNames);
    collectTypeRefsFromTypeNode(node.falseType, typeNames);
  } else if (ts.isFunctionTypeNode(node)) {
    if (node.type) {
      collectTypeRefsFromTypeNode(node.type, typeNames);
    }
    for (const param of node.parameters) {
      if (param.type) {
        collectTypeRefsFromTypeNode(param.type, typeNames);
      }
    }
  } else if (ts.isParenthesizedTypeNode(node)) {
    collectTypeRefsFromTypeNode(node.type, typeNames);
  } else if (ts.isIndexedAccessTypeNode(node)) {
    collectTypeRefsFromTypeNode(node.objectType, typeNames);
    collectTypeRefsFromTypeNode(node.indexType, typeNames);
  } else if (ts.isMappedTypeNode(node)) {
    if (node.type) {
      collectTypeRefsFromTypeNode(node.type, typeNames);
    }
  }
}

/**
 * Tier 1: Find type references directly at the diagnostic position.
 */
function findDirectTypeReferencesAtPosition(ctx: BuilderContext): Set<string> {
  const typeNames = new Set<string>();

  if (!ctx.diagnostic.file || ctx.diagnostic.start === undefined) {
    return typeNames;
  }

  const sourceFile = ctx.diagnostic.file;
  const position = ctx.diagnostic.start;

  function collectTypeRefs(node: ts.Node): void {
    if (position < node.getStart(sourceFile) || position >= node.getEnd()) {
      return;
    }

    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      typeNames.add(node.typeName.text);
      // Also collect from type arguments
      if (node.typeArguments) {
        for (const arg of node.typeArguments) {
          collectTypeRefsFromTypeNode(arg, typeNames);
        }
      }
    }

    ts.forEachChild(node, collectTypeRefs);
  }

  collectTypeRefs(sourceFile);
  return typeNames;
}

// =============================================================================
// Tier 2: Walk up AST for enclosing type contexts
// =============================================================================

/**
 * Tier 2: Find type references by walking up the AST to enclosing type contexts.
 * This catches cases where the error is on a value but the type is in an annotation.
 */
function findEnclosingTypeContexts(ctx: BuilderContext): Set<string> {
  const typeNames = new Set<string>();
  const node = ctx.getNodeAtPosition();
  if (!node) return typeNames;

  let current: ts.Node | undefined = node;
  while (current) {
    // Type alias declaration
    if (ts.isTypeAliasDeclaration(current)) {
      typeNames.add(current.name.text);
      if (current.type) {
        collectTypeRefsFromTypeNode(current.type, typeNames);
      }
      break;
    }

    // Variable/property with type annotation
    if (ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current) ||
        ts.isPropertySignature(current) || ts.isParameter(current)) {
      if (current.type) {
        collectTypeRefsFromTypeNode(current.type, typeNames);
      }
    }

    // Function/method return type and parameters
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current) || ts.isMethodDeclaration(current)) {
      if (current.type) {
        collectTypeRefsFromTypeNode(current.type, typeNames);
      }
      for (const param of current.parameters) {
        if (param.type) {
          collectTypeRefsFromTypeNode(param.type, typeNames);
        }
      }
    }

    // Type assertion (as T)
    if (ts.isAsExpression(current) && current.type) {
      collectTypeRefsFromTypeNode(current.type, typeNames);
    }

    current = current.parent;
  }

  return typeNames;
}

// =============================================================================
// Tier 3: Call site analysis (function return types)
// =============================================================================

/**
 * Tier 3: Find type references from function return types at call sites.
 * When the error is at a call expression, the issue may be in the function's return type.
 */
function findReturnTypeRefsIfCallSite(ctx: BuilderContext): Set<string> {
  const typeNames = new Set<string>();
  const node = ctx.getNodeAtPosition();
  if (!node) return typeNames;

  // Find if we're at or near a call expression
  let current: ts.Node | undefined = node;
  let callExpr: ts.CallExpression | undefined;

  while (current) {
    if (ts.isCallExpression(current)) {
      callExpr = current;
      break;
    }
    current = current.parent;
  }

  if (!callExpr) return typeNames;

  // Extract type arguments from the call
  if (callExpr.typeArguments) {
    for (const typeArg of callExpr.typeArguments) {
      collectTypeRefsFromTypeNode(typeArg, typeNames);
    }
  }

  // Try to find the function being called and get its return type
  const callee = callExpr.expression;

  // If it's a simple identifier, look for a function declaration
  if (ts.isIdentifier(callee)) {
    const funcName = callee.text;
    // Search for function with this name in the project
    for (const fileName of ctx.host.getFileNames()) {
      const sourceFile = ctx.getSourceFile(fileName);
      if (!sourceFile) continue;

      ts.forEachChild(sourceFile, (node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === funcName) {
          if (node.type) {
            collectTypeRefsFromTypeNode(node.type, typeNames);
          }
        }
        // Also check variable declarations with arrow functions
        if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === funcName) {
              // Check type annotation
              if (decl.type) {
                collectTypeRefsFromTypeNode(decl.type, typeNames);
              }
              // Check initializer if it's a function
              if (decl.initializer) {
                if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
                  if (decl.initializer.type) {
                    collectTypeRefsFromTypeNode(decl.initializer.type, typeNames);
                  }
                }
              }
            }
          }
        }
      });
    }
  }

  // If it's a property access (e.g., obj.method()), we'd need more complex resolution
  // For now, we extract from the node's type annotation if available
  if (ts.isPropertyAccessExpression(callee)) {
    // This would require type checker access for full resolution
    // For now, we'll skip this case - it can be handled by other tiers
  }

  return typeNames;
}

// =============================================================================
// Tier 4: Related diagnostics correlation
// =============================================================================

/**
 * Tier 4: Find type names mentioned in related TS2589 diagnostics.
 * Multiple TS2589 errors often point to the same recursive type.
 */
function findTypeNamesFromRelatedDiagnostics(ctx: BuilderContext): Set<string> {
  const typeNames = new Set<string>();

  // Look at all current diagnostics for TS2589 errors
  for (const diag of ctx.currentDiagnostics) {
    if (diag.code !== 2589) continue;
    if (!diag.file) continue;

    const message = ts.flattenDiagnosticMessageText(diag.messageText, " ");

    // Extract type names from the error message
    // TS2589 messages often contain the type name
    // Pattern: "Type instantiation is excessively deep" may include type names in quotes
    const quotedNames = message.match(/'([A-Za-z_$][A-Za-z0-9_$]*(?:<[^>]+>)?)'/g);
    if (quotedNames) {
      for (const quoted of quotedNames) {
        // Extract the base type name (without generics)
        const match = quoted.match(/'([A-Za-z_$][A-Za-z0-9_$]*)/);
        if (match) {
          typeNames.add(match[1]);
        }
      }
    }

    // Also collect type refs from the diagnostic position
    if (diag.start !== undefined) {
      const sourceFile = diag.file;
      const position = diag.start;

      const collectTypeRefsAtPos = (node: ts.Node): void => {
        if (position < node.getStart(sourceFile) || position >= node.getEnd()) {
          return;
        }
        if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
          typeNames.add(node.typeName.text);
        }
        ts.forEachChild(node, collectTypeRefsAtPos);
      };

      collectTypeRefsAtPos(sourceFile);
    }
  }

  return typeNames;
}

// =============================================================================
// Tier 5: Project-wide scan for recursive types
// =============================================================================

/**
 * Tier 5: Find all recursive types in the project (last resort fallback).
 * Skips node_modules for performance.
 */
function findAllRecursiveTypesInProject(ctx: BuilderContext): RecursiveTypeInfo[] {
  const results: RecursiveTypeInfo[] = [];

  for (const fileName of ctx.host.getFileNames()) {
    // Skip node_modules - use path separators to avoid matching dirs like node_modules_backup
    if (fileName.includes('/node_modules/') || fileName.includes('\\node_modules\\')) continue;

    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    // Find all type alias declarations
    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node)) {
        const typeName = node.name.text;
        const info = analyzeRecursiveType(typeName, ctx);
        if (info) {
          results.push(info);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Early termination once we have enough candidates
    if (results.length >= MAX_CANDIDATES) {
      break;
    }
  }

  return results;
}

// =============================================================================
// Enhanced detection with tiered strategy
// =============================================================================

/**
 * Enhanced detection using tiered strategy.
 * Tries progressively broader detection until candidates are found.
 */
function findTypeAliasesAtDiagnosticEnhanced(ctx: BuilderContext): RecursiveTypeInfo[] {
  const results: RecursiveTypeInfo[] = [];
  const seenTypes = new Set<string>();

  const addResults = (typeNames: Set<string>): void => {
    for (const typeName of typeNames) {
      if (seenTypes.has(typeName)) continue;
      seenTypes.add(typeName);

      const info = analyzeRecursiveType(typeName, ctx);
      if (info) {
        results.push(info);
      }

      // Early termination
      if (results.length >= MAX_CANDIDATES) return;
    }
  };

  // Tier 1: Direct type reference at position
  const tier1 = findDirectTypeReferencesAtPosition(ctx);
  addResults(tier1);
  if (results.length >= MAX_CANDIDATES) return results;

  // Tier 2: Walk up AST for enclosing type contexts
  if (results.length === 0) {
    const tier2 = findEnclosingTypeContexts(ctx);
    addResults(tier2);
    if (results.length >= MAX_CANDIDATES) return results;
  }

  // Tier 3: Call site analysis (function return types)
  if (results.length === 0) {
    const tier3 = findReturnTypeRefsIfCallSite(ctx);
    addResults(tier3);
    if (results.length >= MAX_CANDIDATES) return results;
  }

  // Tier 4: Related diagnostics correlation
  if (results.length === 0) {
    const tier4 = findTypeNamesFromRelatedDiagnostics(ctx);
    addResults(tier4);
    if (results.length >= MAX_CANDIDATES) return results;
  }

  // Tier 5: Project-wide scan (last resort)
  if (results.length === 0) {
    const tier5 = findAllRecursiveTypesInProject(ctx);
    for (const info of tier5) {
      if (!seenTypes.has(info.typeName)) {
        seenTypes.add(info.typeName);
        results.push(info);
        if (results.length >= MAX_CANDIDATES) break;
      }
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
    const textAfter = sourceFile.text.slice(ref.end, ref.end + INTERSECTION_LOOKAHEAD_SIZE);
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
 *
 * Uses tiered detection strategy:
 * 1. Direct type reference at diagnostic position
 * 2. Walk up AST for enclosing type contexts
 * 3. Call site analysis (function return types)
 * 4. Related diagnostics correlation
 * 5. Project-wide scan for recursive types (skips node_modules)
 */
export const InstantiationDepthBuilder: SolutionBuilder = {
  name: "InstantiationDepthBuilder",
  description: "Repairs excessive type instantiation depth errors (TS2589)",
  diagnosticCodes: [2589],

  matches(ctx: BuilderContext): boolean {
    if (ctx.diagnostic.code !== 2589) return false;

    // Use enhanced detection to find recursive type aliases related to this diagnostic
    const typeInfos = findTypeAliasesAtDiagnosticEnhanced(ctx);
    return typeInfos.length > 0;
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    const candidates: CandidateFix[] = [];

    // Use enhanced detection to find all recursive types
    const typeInfos = findTypeAliasesAtDiagnosticEnhanced(ctx);

    for (const info of typeInfos) {
      // Generate intersection reset candidate
      const resetCandidate = generateIntersectionResetCandidate(info, ctx);
      if (resetCandidate) {
        candidates.push(resetCandidate);
      }

      // Early termination
      if (candidates.length >= MAX_CANDIDATES) break;
    }

    return candidates.slice(0, MAX_CANDIDATES);
  },
};
