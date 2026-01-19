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

/** Instrumentation stats for performance monitoring */
export interface TypeScriptHostStats {
  /** Number of times getDiagnostics() was called */
  getDiagnosticsCalls: number;
  /** Number of times getCodeFixes() was called */
  getCodeFixesCalls: number;
  /** Number of times applyFix() was called */
  applyFixCalls: number;
}

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

  /**
   * Get instrumentation stats for performance monitoring.
   * Returns counts of how many times each method was called.
   */
  getStats(): TypeScriptHostStats;

  /**
   * Reset instrumentation stats to zero.
   * Useful for measuring specific operations.
   */
  resetStats(): void;
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

  // Instrumentation stats
  const stats: TypeScriptHostStats = {
    getDiagnosticsCalls: 0,
    getCodeFixesCalls: 0,
    applyFixCalls: 0,
  };

  return {
    getDiagnostics(): ts.Diagnostic[] {
      stats.getDiagnosticsCalls++;
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
      stats.getCodeFixesCalls++;
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
      stats.applyFixCalls++;
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

    getStats(): TypeScriptHostStats {
      return { ...stats };
    },

    resetStats(): void {
      stats.getDiagnosticsCalls = 0;
      stats.getCodeFixesCalls = 0;
      stats.applyFixCalls = 0;
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

  // Set for O(1) file membership checks (instead of array.includes which is O(n))
  const fileNamesSet = new Set(fileNames);

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

  // Per-file diagnostic cache - allows incremental updates while returning full diagnostics
  // Key: fileName, Value: array of diagnostics from that file
  const diagnosticsPerFile = new Map<string, ts.Diagnostic[]>();

  // Set of files that need rechecking (superset of changedFiles - includes dependents)
  let filesToRecheck = new Set<string>();

  // Whether we've done the initial full check
  let initialCheckDone = false;

  // Cached merged diagnostics (for returning same array when nothing changed)
  let cachedMergedDiagnostics: ts.Diagnostic[] | null = null;

  /**
   * Rebuild the builder program incrementally.
   * Only re-checks files that changed and their dependents.
   */
  function rebuildProgram(): void {
    if (changedFiles.size === 0 && initialCheckDone) {
      return; // No changes, use cached diagnostics
    }

    // Invalidate merged cache since files are changing
    cachedMergedDiagnostics = null;

    // Clear source file cache for changed files
    for (const fileName of changedFiles) {
      // Remove old versions from cache
      for (const key of sourceFileCache.keys()) {
        if (key.startsWith(fileName + ":")) {
          sourceFileCache.delete(key);
        }
      }
    }

    // Remember which files were changed so we can track affected files
    filesToRecheck = new Set(changedFiles);

    // Create new builder program from old (incremental)
    builderProgram = ts.createSemanticDiagnosticsBuilderProgram(
      fileNames,
      options,
      compilerHost,
      builderProgram // Pass old builder for incremental state
    );

    changedFiles.clear();
  }

  // Instrumentation stats
  const stats: TypeScriptHostStats = {
    getDiagnosticsCalls: 0,
    getCodeFixesCalls: 0,
    applyFixCalls: 0,
  };

  return {
    getDiagnostics(): ts.Diagnostic[] {
      stats.getDiagnosticsCalls++;
      rebuildProgram();

      // If no files need rechecking and we have cached data, return cached merged diagnostics
      if (filesToRecheck.size === 0 && initialCheckDone && cachedMergedDiagnostics !== null) {
        return cachedMergedDiagnostics;
      }

      const program = builderProgram.getProgram();

      // Track which files were updated in this check
      const updatedFiles = new Set<string>();

      // On first call, we need to process ALL files
      // On subsequent calls, getSemanticDiagnosticsOfNextAffectedFile returns only affected files
      if (!initialCheckDone) {
        // First time: get diagnostics for all project files
        for (const sourceFile of program.getSourceFiles()) {
          if (fileNamesSet.has(sourceFile.fileName)) {
            const syntactic = program.getSyntacticDiagnostics(sourceFile);
            const semantic = program.getSemanticDiagnostics(sourceFile);
            const fileDiags = [...syntactic, ...semantic].filter(
              (d) => d.category === ts.DiagnosticCategory.Error
            );
            diagnosticsPerFile.set(sourceFile.fileName, fileDiags);
            updatedFiles.add(sourceFile.fileName);
          }
        }

        // Drain the builder's affected files iterator to sync its state
        while (builderProgram.getSemanticDiagnosticsOfNextAffectedFile() !== undefined) {
          // Just drain it
        }

        initialCheckDone = true;
      } else {
        // Subsequent calls: only process affected files via the incremental API
        let result: ts.AffectedFileResult<readonly ts.Diagnostic[]> | undefined;
        while ((result = builderProgram.getSemanticDiagnosticsOfNextAffectedFile()) !== undefined) {
          // result.affected can be a SourceFile or Program
          const affected = result.affected;
          let affectedFileName: string | undefined;

          if ("fileName" in affected && typeof affected.fileName === "string") {
            affectedFileName = affected.fileName;
          }

          if (affectedFileName && fileNamesSet.has(affectedFileName)) {
            // Get fresh diagnostics for this file
            const sourceFile = program.getSourceFile(affectedFileName);
            if (sourceFile) {
              const syntactic = program.getSyntacticDiagnostics(sourceFile);
              // result.result contains the semantic diagnostics
              const semantic = result.result ?? [];
              const fileDiags = [...syntactic, ...semantic].filter(
                (d) => d.category === ts.DiagnosticCategory.Error
              );
              diagnosticsPerFile.set(affectedFileName, fileDiags);
              updatedFiles.add(affectedFileName);
            }
          }
        }
      }

      // Clear the recheck set
      filesToRecheck.clear();

      // Merge and cache all diagnostics
      const allDiags: ts.Diagnostic[] = [];
      for (const diags of diagnosticsPerFile.values()) {
        allDiags.push(...diags);
      }
      cachedMergedDiagnostics = allDiags;

      return cachedMergedDiagnostics;
    },

    getCodeFixes(diagnostic: ts.Diagnostic): readonly ts.CodeFixAction[] {
      stats.getCodeFixesCalls++;
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
      stats.applyFixCalls++;
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
      // Clear per-file diagnostics cache
      diagnosticsPerFile.clear();
      cachedMergedDiagnostics = null;
      initialCheckDone = false;
      filesToRecheck.clear();
      // Force full rebuild on next getDiagnostics
      builderProgram = ts.createSemanticDiagnosticsBuilderProgram(
        fileNames,
        options,
        compilerHost,
        undefined
      );
    },

    getStats(): TypeScriptHostStats {
      return { ...stats };
    },

    resetStats(): void {
      stats.getDiagnosticsCalls = 0;
      stats.getCodeFixesCalls = 0;
      stats.applyFixCalls = 0;
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
