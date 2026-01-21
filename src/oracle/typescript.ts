/**
 * TypeScript Integration
 *
 * Wraps TypeScript's Language Service for diagnostic collection and code fix retrieval.
 */

import ts from "typescript";
import path from "path";
import { VirtualFS } from "./vfs.js";
import type { DiagnosticRef, FileChange } from "../output/types.js";

export interface TypeScriptHost {
  /** Get all diagnostics from the project */
  getDiagnostics(): ts.Diagnostic[];

  /**
   * Get diagnostics only for specific files.
   * This is much faster than getDiagnostics() when you only need to check a subset of files.
   * Used by focused verification to only type-check files with errors + modified files.
   */
  getDiagnosticsForFiles(files: Set<string>): ts.Diagnostic[];

  /** Get code fixes for a specific diagnostic */
  getCodeFixes(diagnostic: ts.Diagnostic): readonly ts.CodeFixAction[];

  /** Apply a code fix to the VFS */
  applyFix(fix: ts.CodeFixAction): void;

  /** Get the VFS for snapshot/restore */
  getVFS(): VirtualFS;

  /** Get compiler options */
  getOptions(): ts.CompilerOptions;

  /** Get file names */
  getFileNames(): string[];

  /**
   * Notify the host that files have changed externally (e.g., after VFS restore).
   * This bumps all file versions so the LanguageService re-checks everything.
   */
  notifyFilesChanged(): void;

  /**
   * Notify the host that specific files have changed.
   * More efficient than notifyFilesChanged() when only a few files changed.
   */
  notifySpecificFilesChanged(files: Set<string>): void;

  /**
   * Reset the host to its initial state (VFS reset + version bump).
   * Useful for test isolation when reusing hosts.
   */
  reset(): void;

  /**
   * Refresh the language service to reclaim memory.
   * Creates a new language service instance, allowing the old one to be garbage collected.
   * This is useful during long verification loops to prevent memory growth.
   */
  refreshLanguageService(): void;
}

/**
 * Create a TypeScript host from a project config.
 *
 * Performance optimization: The language service is created once and reused.
 * File versions are tracked per-file and incremented when the VFS changes,
 * allowing TypeScript's incremental checker to recompute only what's needed.
 */
export function createTypeScriptHost(configPath: string): TypeScriptHost {
  const absoluteConfigPath = path.resolve(configPath);
  const configFile = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }

  const basePath = path.dirname(absoluteConfigPath);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    basePath
  );

  const vfs = VirtualFS.fromProject(configPath);
  const fileNames = parsed.fileNames;
  const options = parsed.options;

  // Track per-file versions for incremental updates
  const fileVersions = new Map<string, number>();
  for (const fileName of fileNames) {
    fileVersions.set(fileName, 1);
  }

  // Bump version for a specific file (called when VFS changes)
  function bumpFileVersion(fileName: string): void {
    const current = fileVersions.get(fileName) ?? 0;
    fileVersions.set(fileName, current + 1);
  }

  // Create the language service host (reads from VFS)
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: (fileName) => String(fileVersions.get(fileName) ?? 1),
    getScriptSnapshot: (fileName) => {
      const content = vfs.read(fileName);
      if (content === undefined) return undefined;
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => basePath,
    getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (f) => vfs.fileExists(f),
    readFile: (f) => vfs.read(f),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  // Create the language service (can be refreshed to reclaim memory)
  let documentRegistry = ts.createDocumentRegistry();
  let languageService = ts.createLanguageService(host, documentRegistry);

  return {
    getDiagnostics(): ts.Diagnostic[] {
      const diagnostics: ts.Diagnostic[] = [];

      for (const fileName of fileNames) {
        try {
          diagnostics.push(
            ...languageService.getSyntacticDiagnostics(fileName),
            ...languageService.getSemanticDiagnostics(fileName)
          );
        } catch (e) {
          // Skip files that fail to parse
          console.error(`Warning: Failed to get diagnostics for ${fileName}:`, e);
        }
      }

      // Filter to errors only
      return diagnostics.filter(
        (d) => d.category === ts.DiagnosticCategory.Error
      );
    },

    getDiagnosticsForFiles(files: Set<string>): ts.Diagnostic[] {
      const diagnostics: ts.Diagnostic[] = [];

      for (const fileName of files) {
        // Skip files not in the project
        if (!fileNames.includes(fileName)) {
          continue;
        }

        try {
          diagnostics.push(
            ...languageService.getSyntacticDiagnostics(fileName),
            ...languageService.getSemanticDiagnostics(fileName)
          );
        } catch (e) {
          // Skip files that fail to parse
          console.error(`Warning: Failed to get diagnostics for ${fileName}:`, e);
        }
      }

      // Filter to errors only
      return diagnostics.filter(
        (d) => d.category === ts.DiagnosticCategory.Error
      );
    },

    getCodeFixes(diagnostic: ts.Diagnostic): readonly ts.CodeFixAction[] {
      if (
        !diagnostic.file ||
        diagnostic.start === undefined ||
        diagnostic.length === undefined
      ) {
        return [];
      }

      try {
        return languageService.getCodeFixesAtPosition(
          diagnostic.file.fileName,
          diagnostic.start,
          diagnostic.start + diagnostic.length,
          [diagnostic.code],
          {}, // format options
          {} // preferences
        );
      } catch (e) {
        // Some diagnostics don't have fixes or the query fails
        return [];
      }
    },

    applyFix(fix: ts.CodeFixAction): void {
      for (const fileChange of fix.changes) {
        for (const textChange of fileChange.textChanges) {
          vfs.applyChange(
            fileChange.fileName,
            textChange.span.start,
            textChange.span.start + textChange.span.length,
            textChange.newText
          );
        }
        // Bump version for this file so LS knows to re-check it
        bumpFileVersion(fileChange.fileName);
      }
    },

    getVFS(): VirtualFS {
      return vfs;
    },

    getOptions(): ts.CompilerOptions {
      return options;
    },

    getFileNames(): string[] {
      return fileNames;
    },

    notifyFilesChanged(): void {
      // Bump all file versions so LanguageService re-checks everything
      for (const fileName of fileNames) {
        bumpFileVersion(fileName);
      }
    },

    notifySpecificFilesChanged(files: Set<string>): void {
      // Bump only specified file versions
      for (const fileName of files) {
        if (fileNames.includes(fileName)) {
          bumpFileVersion(fileName);
        }
      }
    },

    reset(): void {
      // Reset VFS to original state and notify LanguageService
      vfs.reset();
      for (const fileName of fileNames) {
        bumpFileVersion(fileName);
      }
    },

    refreshLanguageService(): void {
      // Create a fresh language service to allow the old one to be GC'd
      // This helps reclaim memory during long verification loops
      documentRegistry = ts.createDocumentRegistry();
      languageService = ts.createLanguageService(host, documentRegistry);
    },
  };
}

/**
 * Convert a TypeScript diagnostic to our DiagnosticRef format
 */
export function toDiagnosticRef(diagnostic: ts.Diagnostic): DiagnosticRef {
  const file = diagnostic.file;
  const start = diagnostic.start ?? 0;
  const length = diagnostic.length ?? 0;

  let line = 0;
  let column = 0;
  let fileName = "unknown";

  if (file) {
    const pos = file.getLineAndCharacterOfPosition(start);
    line = pos.line + 1; // 1-indexed
    column = pos.character + 1; // 1-indexed
    fileName = file.fileName;
  }

  return {
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    file: fileName,
    line,
    column,
    start,
    length,
  };
}

/**
 * Convert a CodeFixAction's changes to our FileChange format
 */
export function toFileChanges(fix: ts.CodeFixAction): FileChange[] {
  const changes: FileChange[] = [];

  for (const fileChange of fix.changes) {
    for (const textChange of fileChange.textChanges) {
      changes.push({
        file: fileChange.fileName,
        start: textChange.span.start,
        end: textChange.span.start + textChange.span.length,
        newText: textChange.newText,
      });
    }
  }

  return changes;
}

/**
 * Get an approximate set of reverse dependencies for a set of files.
 *
 * This is a conservative heuristic: it finds files that likely import
 * any of the modified files by checking if they contain the base name.
 *
 * This is an approximation because:
 * - It doesn't parse actual import statements
 * - It may include false positives (files that mention the name but don't import)
 * - It won't catch dynamic imports or require() calls with variables
 *
 * For more accurate results, consider using TypeScript's dependency graph.
 */
export function getApproximateReverseDeps(
  host: TypeScriptHost,
  files: Set<string>
): Set<string> {
  const result = new Set<string>();
  const allFiles = host.getFileNames();
  const vfs = host.getVFS();

  // Build a set of base names to search for (without extension)
  const baseNames = new Set<string>();
  for (const modifiedFile of files) {
    const baseName = path.basename(modifiedFile, path.extname(modifiedFile));
    baseNames.add(baseName);
  }

  for (const fileName of allFiles) {
    // Skip files that are themselves modified
    if (files.has(fileName)) continue;

    const content = vfs.read(fileName);
    if (!content) continue;

    // Check if file imports any modified file
    // Look for import statements or require calls containing the base name
    for (const baseName of baseNames) {
      // Match patterns like:
      // - import ... from './baseName'
      // - import ... from '../path/baseName'
      // - require('./baseName')
      // - require('../path/baseName')
      if (
        content.includes(`'${baseName}'`) ||
        content.includes(`"${baseName}"`) ||
        content.includes(`/${baseName}'`) ||
        content.includes(`/${baseName}"`)
      ) {
        result.add(fileName);
        break;
      }
    }
  }

  return result;
}

/**
 * Create a reverse dependency lookup function bound to a specific host.
 * This is useful for passing to buildCone().
 */
export function createReverseDepsLookup(
  host: TypeScriptHost
): (files: Set<string>) => Set<string> {
  return (files) => getApproximateReverseDeps(host, files);
}
