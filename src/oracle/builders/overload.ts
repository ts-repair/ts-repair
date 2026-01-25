/**
 * Overload Repair Builder
 *
 * Generates candidates for TS2769 "No overload matches this call" by:
 * 1. Finding the function declaration via AST traversal
 * 2. Generating new overload signatures that match the call pattern
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
 * Information about a function declaration for overload repair.
 */
interface DeclInfo {
  file: string;
  insertPosition: number;
  existingOverloads: ts.FunctionDeclaration[];
}

/**
 * Extract modifiers from a function declaration (export, async, default, etc.).
 * Returns the modifiers as a string prefix for the function signature.
 */
export function extractModifiers(decl: ts.FunctionDeclaration): string {
  const modifiers: string[] = [];

  // Use ts.getModifiers for compatibility (available in TS 4.8+)
  // Falls back to decl.modifiers for older versions
  const declModifiers = ts.getModifiers?.(decl) ?? decl.modifiers;

  if (declModifiers) {
    for (const mod of declModifiers) {
      switch (mod.kind) {
        case ts.SyntaxKind.ExportKeyword:
          modifiers.push("export");
          break;
        case ts.SyntaxKind.DefaultKeyword:
          modifiers.push("default");
          break;
        case ts.SyntaxKind.AsyncKeyword:
          modifiers.push("async");
          break;
        case ts.SyntaxKind.DeclareKeyword:
          modifiers.push("declare");
          break;
        // Skip other modifiers like public/private/protected which don't apply to function declarations
      }
    }
  }

  return modifiers.length > 0 ? modifiers.join(" ") + " " : "";
}

/**
 * Get the return type from the implementation signature.
 * Returns the type string or "void" if no explicit return type.
 */
export function getImplementationReturnType(
  decls: ts.FunctionDeclaration[],
  sourceFile: ts.SourceFile
): string {
  // Find the implementation (the one with a body)
  const impl = decls.find((d) => d.body !== undefined);
  if (!impl) {
    return "void";
  }

  // If there's an explicit return type, extract it from source
  if (impl.type) {
    const start = impl.type.getStart(sourceFile);
    const end = impl.type.getEnd();
    return sourceFile.text.slice(start, end);
  }

  // No explicit return type - default to void
  return "void";
}

/**
 * Find the nearest ancestor call expression from a given node.
 */
function findAncestorCallExpression(
  node: ts.Node
): ts.CallExpression | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCallExpression(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Get the name of the function being called.
 */
function getCalledFunctionName(
  callExpr: ts.CallExpression
): string | undefined {
  if (ts.isIdentifier(callExpr.expression)) {
    return callExpr.expression.text;
  }
  if (ts.isPropertyAccessExpression(callExpr.expression)) {
    return callExpr.expression.name.text;
  }
  return undefined;
}

/**
 * Find all overload declarations for a function in a source file.
 */
function findOverloadDeclarations(
  sourceFile: ts.SourceFile,
  funcName: string
): ts.FunctionDeclaration[] {
  const result: ts.FunctionDeclaration[] = [];

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === funcName) {
      result.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

/**
 * Find the function declaration across all project files.
 */
function findFunctionDeclaration(
  funcName: string,
  ctx: BuilderContext
): DeclInfo | undefined {
  // Search through project files for function declarations
  for (const fileName of ctx.host.getFileNames()) {
    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    const decls = findOverloadDeclarations(sourceFile, funcName);
    if (decls.length > 0) {
      // Insert before the first overload
      const insertPos = decls[0].getStart(sourceFile);
      return {
        file: fileName,
        insertPosition: insertPos,
        existingOverloads: decls,
      };
    }
  }
  return undefined;
}

/**
 * Get the parameter signature from the implementation (last overload).
 * Returns parameter names and types if available.
 */
function getImplementationParams(
  decls: ts.FunctionDeclaration[],
  sourceFile: ts.SourceFile
): string | undefined {
  // The implementation is typically the last declaration (the one with a body)
  const impl = decls.find((d) => d.body !== undefined);
  if (!impl || !impl.parameters || impl.parameters.length === 0) {
    return undefined;
  }

  // Extract parameter text from the source
  const firstParam = impl.parameters[0];
  const lastParam = impl.parameters[impl.parameters.length - 1];
  const start = firstParam.getStart(sourceFile);
  const end = lastParam.getEnd();

  return sourceFile.text.slice(start, end);
}

/**
 * Check if an overload with the given parameter signature already exists.
 */
function overloadExists(
  decls: ts.FunctionDeclaration[],
  params: string,
  sourceFile: ts.SourceFile
): boolean {
  for (const decl of decls) {
    // Skip the implementation (has a body)
    if (decl.body !== undefined) continue;

    // Get the parameter text for this overload
    if (!decl.parameters || decl.parameters.length === 0) {
      // No parameters - check if we're looking for an empty signature
      if (params === "" || params.trim() === "") {
        return true;
      }
      continue;
    }

    const firstParam = decl.parameters[0];
    const lastParam = decl.parameters[decl.parameters.length - 1];
    const start = firstParam.getStart(sourceFile);
    const end = lastParam.getEnd();
    const existingParams = sourceFile.text.slice(start, end);

    // Check if the parameter signatures match (allowing for whitespace differences)
    if (existingParams.replace(/\s+/g, " ").trim() === params.replace(/\s+/g, " ").trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Generate a catch-all overload candidate.
 */
function generateCatchAllOverload(
  funcName: string,
  argCount: number,
  declInfo: DeclInfo,
  ctx: BuilderContext
): CandidateFix | undefined {
  // Try to get parameter signature from implementation for compatibility
  const sourceFile = ctx.getSourceFile(declInfo.file);
  let params: string;
  let description: string;

  if (sourceFile) {
    const implParams = getImplementationParams(
      declInfo.existingOverloads,
      sourceFile
    );
    if (implParams) {
      // Use the implementation's parameter signature for compatibility
      params = implParams;
      description = `Add overload: ${funcName}(${params.replace(/: [^,)]+/g, "")})`;
    } else {
      // Fallback: use rest parameters for maximum flexibility
      params = "...args: unknown[]";
      description = `Add overload: ${funcName}(...args)`;
    }

    // Check if an overload with this signature already exists
    if (overloadExists(declInfo.existingOverloads, params, sourceFile)) {
      // Overload already exists, don't generate a duplicate
      return undefined;
    }
  } else {
    // Fallback: generate positional parameters
    params = Array.from({ length: argCount }, (_, i) => `arg${i}: unknown`).join(
      ", "
    );
    description = `Add overload: ${funcName}(${params.replace(/: unknown/g, "")})`;
  }

  // Extract modifiers and return type from the implementation
  const impl = declInfo.existingOverloads.find((d) => d.body !== undefined);
  const modifiers = impl ? extractModifiers(impl) : "";
  let returnType = sourceFile
    ? getImplementationReturnType(declInfo.existingOverloads, sourceFile)
    : "void";

  // If function is async and return type is not already a Promise, wrap it
  if (modifiers.includes("async") && !returnType.startsWith("Promise")) {
    returnType = `Promise<${returnType}>`;
  }

  const newOverload = `${modifiers}function ${funcName}(${params}): ${returnType};\n`;

  const change: FileChange = {
    file: declInfo.file,
    start: declInfo.insertPosition,
    end: declInfo.insertPosition,
    newText: newOverload,
  };

  return createSyntheticFix(
    "addCatchAllOverload",
    description,
    [change],
    {
      scopeHint: "wide",
      riskHint: "high",
      tags: ["overload", "structural"],
      metadata: { funcName, argCount },
    }
  );
}

/**
 * OverloadRepairBuilder - Repairs overload signature mismatches.
 *
 * This builder targets TS2769 "No overload matches this call" errors
 * and generates synthetic candidates to add new overload signatures
 * at the declaration site.
 */
export const OverloadRepairBuilder: SolutionBuilder = {
  name: "OverloadRepairBuilder",
  description: "Repairs overload signature mismatches",
  diagnosticCodes: [2769],

  matches(ctx: BuilderContext): boolean {
    if (ctx.diagnostic.code !== 2769) return false;

    // Must have a call expression at diagnostic position
    const node = ctx.getNodeAtPosition();
    if (!node) return false;

    const callExpr = findAncestorCallExpression(node);
    if (!callExpr) return false;

    return true;
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    const candidates: CandidateFix[] = [];

    const node = ctx.getNodeAtPosition();
    if (!node) return candidates;

    const callExpr = findAncestorCallExpression(node);
    if (!callExpr) return candidates;

    // Strategy: Generate a permissive overload signature
    // Based on the number of arguments in the call
    const argCount = callExpr.arguments.length;
    const funcName = getCalledFunctionName(callExpr);

    if (!funcName) return candidates;

    // Find the declaration file by searching for the function
    const declInfo = findFunctionDeclaration(funcName, ctx);
    if (!declInfo) return candidates;

    // Generate candidate: add a catch-all overload
    const catchAllCandidate = generateCatchAllOverload(
      funcName,
      argCount,
      declInfo,
      ctx
    );
    if (catchAllCandidate) {
      candidates.push(catchAllCandidate);
    }

    return candidates;
  },
};
