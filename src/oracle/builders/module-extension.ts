/**
 * Module Extension Builder
 *
 * Generates candidates for TS2835 "Relative import paths need explicit file extensions"
 * by parsing the suggested extension from the error message and updating the import.
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
 * Extract the suggested path from a TS2835 error message.
 * Format: "Did you mean './path.js'?"
 */
function extractSuggestedPath(message: string): string | undefined {
  const match = message.match(/Did you mean ['"]([^'"]+)['"]\?/);
  return match?.[1];
}

/**
 * Find the import/export declaration containing the diagnostic position.
 */
function findImportOrExportDeclaration(
  sourceFile: ts.SourceFile,
  position: number
): ts.ImportDeclaration | ts.ExportDeclaration | undefined {
  function visit(node: ts.Node): ts.ImportDeclaration | ts.ExportDeclaration | undefined {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      if (ts.isImportDeclaration(node)) {
        return node;
      }
      if (ts.isExportDeclaration(node)) {
        return node;
      }
      // Recurse into children
      return ts.forEachChild(node, visit);
    }
    return undefined;
  }
  return visit(sourceFile);
}

/**
 * Get the module specifier string literal from an import/export declaration.
 */
function getModuleSpecifier(
  decl: ts.ImportDeclaration | ts.ExportDeclaration
): ts.StringLiteral | undefined {
  if (ts.isImportDeclaration(decl)) {
    if (decl.moduleSpecifier && ts.isStringLiteral(decl.moduleSpecifier)) {
      return decl.moduleSpecifier;
    }
  } else if (ts.isExportDeclaration(decl)) {
    if (decl.moduleSpecifier && ts.isStringLiteral(decl.moduleSpecifier)) {
      return decl.moduleSpecifier;
    }
  }
  return undefined;
}

/**
 * ModuleExtensionBuilder - Repairs missing file extensions in imports.
 *
 * This builder targets TS2835 "Relative import paths need explicit file extensions"
 * errors and generates synthetic candidates to add the suggested extension.
 */
export const ModuleExtensionBuilder: SolutionBuilder = {
  name: "ModuleExtensionBuilder",
  description: "Repairs missing file extensions in ESM imports",
  diagnosticCodes: [2835],

  matches(ctx: BuilderContext): boolean {
    if (ctx.diagnostic.code !== 2835) return false;

    // Must have a suggestion in the message
    const message = ts.flattenDiagnosticMessageText(
      ctx.diagnostic.messageText,
      "\n"
    );
    const suggestedPath = extractSuggestedPath(message);
    if (!suggestedPath) return false;

    // Must be in a file
    const sourceFile = ctx.diagnostic.file;
    if (!sourceFile) return false;

    // Must have a valid position
    const start = ctx.diagnostic.start;
    if (start === undefined) return false;

    // Must find an import/export declaration at this position
    const decl = findImportOrExportDeclaration(sourceFile, start);
    return decl !== undefined;
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    const candidates: CandidateFix[] = [];

    const message = ts.flattenDiagnosticMessageText(
      ctx.diagnostic.messageText,
      "\n"
    );
    const suggestedPath = extractSuggestedPath(message);
    if (!suggestedPath) return candidates;

    const sourceFile = ctx.diagnostic.file;
    if (!sourceFile) return candidates;

    const start = ctx.diagnostic.start;
    if (start === undefined) return candidates;

    // Find the import/export declaration
    const decl = findImportOrExportDeclaration(sourceFile, start);
    if (!decl) return candidates;

    // Get the module specifier
    const specifier = getModuleSpecifier(decl);
    if (!specifier) return candidates;

    // Create change to replace the specifier
    // The specifier includes quotes, so we need to replace just the string content
    const specifierStart = specifier.getStart(sourceFile);
    const specifierEnd = specifier.getEnd();

    // Preserve the quote style from the original
    const originalText = sourceFile.text.slice(specifierStart, specifierEnd);
    const quoteChar = originalText[0]; // ' or "

    const change: FileChange = {
      file: sourceFile.fileName,
      start: specifierStart,
      end: specifierEnd,
      newText: `${quoteChar}${suggestedPath}${quoteChar}`,
    };

    const candidate = createSyntheticFix(
      "addModuleExtension",
      `Add file extension: ${suggestedPath}`,
      [change],
      {
        scopeHint: "modified",
        riskHint: "low",
        tags: ["import", "module-extension"],
        metadata: {
          originalPath: specifier.text,
          suggestedPath,
        },
      }
    );

    candidates.push(candidate);
    return candidates;
  },
};
