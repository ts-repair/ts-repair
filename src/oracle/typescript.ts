/**
 * TypeScript Integration
 *
 * Provides two implementations:
 * 1. createTypeScriptHost - Original LanguageService-based (for compatibility)
 * 2. createIncrementalTypeScriptHost - BuilderProgram-based for incremental checking
 *
 * The incremental implementation uses TypeScript's SemanticDiagnosticsBuilderProgram
 * which tracks file dependencies and only re-checks affected files when changes occur.
 * This is much faster for large projects where each verification only touches 1-2 files.
 */

import ts from "typescript";
import path from "path";
import { VirtualFS } from "./vfs.js";
import type { DiagnosticRef, FileChange } from "../output/types.js";

export interface TypeScriptHost {
  /** Get all diagnostics from the project */
  getDiagnostics(): ts.Diagnostic[];

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
   * More efficient than notifyFilesChanged() for incremental hosts.
   */
  notifyFileChanged?(fileName: string): void;

  /**
   * Reset the host to its initial state (VFS reset + version bump).
   * Useful for test isolation when reusing hosts.
   */
  reset(): void;
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

  // Create the language service once and reuse it
  const documentRegistry = ts.createDocumentRegistry();
  const languageService = ts.createLanguageService(host, documentRegistry);

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
        // Skip files not in VFS (e.g., node_modules declaration files)
        if (vfs.getContent(fileChange.fileName) === undefined) {
          continue;
        }
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

    reset(): void {
      // Reset VFS to original state and notify LanguageService
      vfs.reset();
      for (const fileName of fileNames) {
        bumpFileVersion(fileName);
      }
    },
  };
}

/**
 * Create an incremental TypeScript host using BuilderProgram.
 *
 * This implementation uses TypeScript's SemanticDiagnosticsBuilderProgram which
 * tracks file dependencies and only re-checks affected files. This is much faster
 * for large projects where each verification typically modifies only 1-2 files.
 *
 * Architecture:
 * - BuilderProgram: Used for getDiagnostics() - provides incremental checking
 * - LanguageService: Used for getCodeFixes() - only API that provides code fixes
 * - VFS: Shared between both for file content
 *
 * Performance characteristics:
 * - Initial getDiagnostics(): O(all files) - must build full program
 * - Subsequent getDiagnostics() after file change: O(affected files)
 * - For typical verification (1-2 files changed), this is 10-100x faster
 */
export function createIncrementalTypeScriptHost(configPath: string): TypeScriptHost {
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

  // Track per-file versions for LanguageService
  const fileVersions = new Map<string, number>();
  for (const fileName of fileNames) {
    fileVersions.set(fileName, 1);
  }

  // Track which files have changed since last getDiagnostics
  const changedFiles = new Set<string>();

  function bumpFileVersion(fileName: string): void {
    const current = fileVersions.get(fileName) ?? 0;
    fileVersions.set(fileName, current + 1);
    changedFiles.add(fileName);
  }

  // Cache for source files with versions (required for BuilderProgram)
  const sourceFileCache = new Map<string, ts.SourceFile>();

  // Create compiler host for BuilderProgram (reads from VFS)
  const compilerHost = ts.createCompilerHost(options);
  compilerHost.readFile = (f) => vfs.read(f);
  compilerHost.fileExists = (f) => vfs.fileExists(f);
  compilerHost.getCurrentDirectory = () => basePath;
  compilerHost.getSourceFile = (fileName, languageVersion, _onError) => {
    const version = fileVersions.get(fileName) ?? 1;
    const cacheKey = `${fileName}:${version}`;

    // Check cache first
    const cached = sourceFileCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const content = vfs.read(fileName);
    if (content === undefined) {
      return undefined;
    }

    // Create source file with version for BuilderProgram
    const sourceFile = ts.createSourceFile(fileName, content, languageVersion);
    // Store version on the source file (TypeScript uses this internally)
    (sourceFile as { version?: string }).version = String(version);

    sourceFileCache.set(cacheKey, sourceFile);
    return sourceFile;
  };

  // Create language service host for code fixes (reads from VFS)
  const lsHost: ts.LanguageServiceHost = {
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

  // Create language service for code fixes
  const documentRegistry = ts.createDocumentRegistry();
  const languageService = ts.createLanguageService(lsHost, documentRegistry);

  // Create initial program and builder
  // Note: We use the rootNames overload which handles the host internally
  let builderProgram = ts.createSemanticDiagnosticsBuilderProgram(
    fileNames,
    options,
    compilerHost,
    undefined  // No old builder initially
  );

  // Cache for diagnostics - avoid recomputing when nothing changed
  let cachedDiagnostics: ts.Diagnostic[] | null = null;

  /**
   * Rebuild the builder program incrementally.
   * Only re-checks files that changed and their dependents.
   */
  function rebuildProgram(): void {
    if (changedFiles.size === 0 && cachedDiagnostics !== null) {
      return; // No changes, use cached diagnostics
    }

    // Clear source file cache for changed files
    for (const fileName of changedFiles) {
      // Remove old versions from cache
      for (const key of sourceFileCache.keys()) {
        if (key.startsWith(fileName + ":")) {
          sourceFileCache.delete(key);
        }
      }
    }

    // Create new builder program from old (incremental)
    builderProgram = ts.createSemanticDiagnosticsBuilderProgram(
      fileNames,
      options,
      compilerHost,
      builderProgram // Pass old builder for incremental state
    );

    changedFiles.clear();
    cachedDiagnostics = null;
  }

  return {
    getDiagnostics(): ts.Diagnostic[] {
      rebuildProgram();

      if (cachedDiagnostics !== null) {
        return cachedDiagnostics;
      }

      const diagnostics: ts.Diagnostic[] = [];

      // Get syntactic diagnostics (parsing errors)
      const program = builderProgram.getProgram();
      for (const sourceFile of program.getSourceFiles()) {
        if (fileNames.includes(sourceFile.fileName)) {
          diagnostics.push(...program.getSyntacticDiagnostics(sourceFile));
        }
      }

      // Drain semantic diagnostics from builder (only affected files)
      // This is the key optimization - it only checks files that need checking
      let result: ts.AffectedFileResult<readonly ts.Diagnostic[]> | undefined;
      while ((result = builderProgram.getSemanticDiagnosticsOfNextAffectedFile()) !== undefined) {
        if (result.result) {
          // Only include diagnostics from project files (not declaration files)
          for (const diag of result.result) {
            if (diag.file && fileNames.includes(diag.file.fileName)) {
              diagnostics.push(diag);
            }
          }
        }
      }

      // Filter to errors only
      cachedDiagnostics = diagnostics.filter(
        (d) => d.category === ts.DiagnosticCategory.Error
      );

      return cachedDiagnostics;
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
        // Skip files not in VFS (e.g., node_modules declaration files)
        if (vfs.getContent(fileChange.fileName) === undefined) {
          continue;
        }
        for (const textChange of fileChange.textChanges) {
          vfs.applyChange(
            fileChange.fileName,
            textChange.span.start,
            textChange.span.start + textChange.span.length,
            textChange.newText
          );
        }
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

    notifyFileChanged(fileName: string): void {
      bumpFileVersion(fileName);
    },

    notifyFilesChanged(): void {
      for (const fileName of fileNames) {
        bumpFileVersion(fileName);
      }
    },

    reset(): void {
      vfs.reset();
      for (const fileName of fileNames) {
        bumpFileVersion(fileName);
      }
      // Clear source file cache
      sourceFileCache.clear();
      // Force full rebuild on next getDiagnostics
      builderProgram = ts.createSemanticDiagnosticsBuilderProgram(
        fileNames,
        options,
        compilerHost,
        undefined
      );
      cachedDiagnostics = null;
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
