/**
 * Verification Cone of Attention
 *
 * Defines which files are included when measuring the effect of a candidate fix.
 * The cone should start narrow for performance but expand automatically when
 * a fix is likely to have broad downstream impact.
 *
 * The key insight: Instead of checking only modified files (too narrow) or the
 * entire project (too slow), we check a dynamically chosen set that approximates
 * the "cone of influence" of a candidate fix.
 */

import ts from "typescript";
import path from "path";
import type { TypeScriptHost } from "./typescript.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Verification cone level - controls how wide the scope is.
 *
 * - "narrow": Only files modified by the fix (fastest, but may miss propagating errors)
 * - "standard": Modified files + files with existing errors (default)
 * - "expanded": Standard + reverse dependencies of modified files (for structural fixes)
 * - "wide": All files in the project (slowest, most complete)
 */
export type ConeLevel = "narrow" | "standard" | "expanded" | "wide";

/**
 * Result of computing a verification cone
 */
export interface VerificationCone {
  /** The set of files to include in verification */
  files: Set<string>;

  /** The cone level that was computed */
  level: ConeLevel;

  /** Whether the cone was expanded from the default */
  wasExpanded: boolean;

  /** Reason for expansion (if any) */
  expansionReason?: string;
}

/**
 * Options for cone computation
 */
export interface ConeOptions {
  /** Maximum number of files to include in the cone (default: 50) */
  maxConeSize: number;

  /** Whether to enable adaptive expansion (default: true) */
  enableExpansion: boolean;

  /** Paths that indicate "core" or "shared" code (triggers expansion) */
  corePathPatterns: string[];

  /** File extensions that indicate type-heavy files (triggers expansion) */
  typeHeavyExtensions: string[];

  /** Minimum number of diagnostics referencing a symbol to trigger expansion */
  sharedSymbolThreshold: number;

  /** Maximum depth for reverse dependency traversal */
  maxReverseDependencyDepth: number;
}

/**
 * Context for cone computation
 */
export interface ConeContext {
  /** Files modified by the fix */
  modifiedFiles: Set<string>;

  /** Files that currently have errors */
  filesWithErrors: Set<string>;

  /** All diagnostics in the current iteration */
  currentDiagnostics: ts.Diagnostic[];

  /** The TypeScript host for project metadata */
  host: TypeScriptHost;

  /** Reverse dependency graph (if available) */
  reverseDeps?: Map<string, Set<string>>;
}

/**
 * Characteristics of a fix that may trigger cone expansion
 */
export interface FixCharacteristics {
  /** Does the fix modify a .d.ts file? */
  modifiesDeclarationFile: boolean;

  /** Does the fix modify a file in a "core" or "shared" path? */
  modifiesCoreFile: boolean;

  /** Does the fix modify type-heavy content (interfaces, type aliases, generics)? */
  modifiesTypeDefinitions: boolean;

  /** Number of current diagnostics in files modified by this fix */
  diagnosticsInModifiedFiles: number;

  /** Number of files that import the modified files */
  importedByCount: number;
}

// ============================================================================
// Default Options
// ============================================================================

export const DEFAULT_CONE_OPTIONS: ConeOptions = {
  maxConeSize: 50,
  enableExpansion: true,
  corePathPatterns: [
    "/types/",
    "/core/",
    "/shared/",
    "/common/",
    "/lib/",
    "/utils/",
    "/interfaces/",
    "/models/",
  ],
  typeHeavyExtensions: [".d.ts"],
  sharedSymbolThreshold: 3,
  maxReverseDependencyDepth: 1,
};

// ============================================================================
// Cone Computation
// ============================================================================

/**
 * Compute the verification cone for a candidate fix.
 *
 * The cone is the set of files that should be checked when measuring
 * the diagnostic delta for this fix.
 */
export function computeVerificationCone(
  context: ConeContext,
  options: Partial<ConeOptions> = {}
): VerificationCone {
  const opts = { ...DEFAULT_CONE_OPTIONS, ...options };
  const { modifiedFiles, filesWithErrors } = context;

  // Start with the standard cone: modifiedFiles ∪ filesWithErrors
  const standardCone = new Set<string>([...modifiedFiles, ...filesWithErrors]);

  // If expansion is disabled, return the standard cone
  if (!opts.enableExpansion) {
    return {
      files: capConeSize(standardCone, modifiedFiles, opts.maxConeSize),
      level: "standard",
      wasExpanded: false,
    };
  }

  // Analyze fix characteristics to determine if expansion is needed
  const characteristics = analyzeFixCharacteristics(context, opts);

  // Determine if we should expand the cone
  const shouldExpand = shouldExpandCone(characteristics, opts);

  if (!shouldExpand.expand) {
    return {
      files: capConeSize(standardCone, modifiedFiles, opts.maxConeSize),
      level: "standard",
      wasExpanded: false,
    };
  }

  // Expand the cone to include reverse dependencies
  const expandedCone = expandCone(context, standardCone, opts);

  return {
    files: capConeSize(expandedCone, modifiedFiles, opts.maxConeSize),
    level: "expanded",
    wasExpanded: true,
    expansionReason: shouldExpand.reason,
  };
}

/**
 * Analyze the structural characteristics of a fix.
 */
export function analyzeFixCharacteristics(
  context: ConeContext,
  options: ConeOptions
): FixCharacteristics {
  const { modifiedFiles, currentDiagnostics, reverseDeps } = context;

  let modifiesDeclarationFile = false;
  let modifiesCoreFile = false;

  for (const file of modifiedFiles) {
    // Check if it's a declaration file
    if (options.typeHeavyExtensions.some((ext) => file.endsWith(ext))) {
      modifiesDeclarationFile = true;
    }

    // Check if it's in a core/shared path
    const normalizedPath = file.replace(/\\/g, "/");
    if (options.corePathPatterns.some((pattern) => normalizedPath.includes(pattern))) {
      modifiesCoreFile = true;
    }
  }

  // Count diagnostics in modified files
  let diagnosticsInModifiedFiles = 0;
  for (const diag of currentDiagnostics) {
    if (diag.file && modifiedFiles.has(diag.file.fileName)) {
      diagnosticsInModifiedFiles++;
    }
  }

  // Count files that import the modified files (if reverse deps available)
  let importedByCount = 0;
  if (reverseDeps) {
    for (const file of modifiedFiles) {
      const importers = reverseDeps.get(file);
      if (importers) {
        importedByCount += importers.size;
      }
    }
  }

  // Check if the fix modifies type definitions
  // This is a heuristic based on file content analysis
  const modifiesTypeDefinitions = checkModifiesTypeDefinitions(context);

  return {
    modifiesDeclarationFile,
    modifiesCoreFile,
    modifiesTypeDefinitions,
    diagnosticsInModifiedFiles,
    importedByCount,
  };
}

/**
 * Check if the modified files contain type definitions that might propagate.
 *
 * This is a heuristic check that looks for patterns that indicate
 * type-level changes (interfaces, type aliases, generics, etc.)
 */
function checkModifiesTypeDefinitions(context: ConeContext): boolean {
  const { modifiedFiles, host } = context;
  const vfs = host.getVFS();

  const typePatterns = [
    /\binterface\s+\w+/,
    /\btype\s+\w+\s*=/,
    /\bclass\s+\w+.*?implements\b/,
    /\bextends\s+\w+/,
    /\bgeneric\s+/,
    /<[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*>/,
    /\bexport\s+(?:interface|type|class)\b/,
  ];

  for (const file of modifiedFiles) {
    const content = vfs.read(file);
    if (!content) continue;

    for (const pattern of typePatterns) {
      if (pattern.test(content)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Determine if the cone should be expanded based on fix characteristics.
 */
function shouldExpandCone(
  characteristics: FixCharacteristics,
  options: ConeOptions
): { expand: boolean; reason?: string } {
  // Declaration files affect many dependents
  if (characteristics.modifiesDeclarationFile) {
    return { expand: true, reason: "modifies declaration file (.d.ts)" };
  }

  // Core/shared files are imported widely
  if (characteristics.modifiesCoreFile) {
    return { expand: true, reason: "modifies file in core/shared path" };
  }

  // Files with many importers can propagate changes
  if (characteristics.importedByCount >= options.sharedSymbolThreshold) {
    return {
      expand: true,
      reason: `modified file is imported by ${characteristics.importedByCount} files`,
    };
  }

  // Type definitions can cause cascading errors
  if (characteristics.modifiesTypeDefinitions && characteristics.diagnosticsInModifiedFiles > 0) {
    return {
      expand: true,
      reason: "modifies type definitions with active diagnostics",
    };
  }

  return { expand: false };
}

/**
 * Expand the cone to include reverse dependencies.
 */
function expandCone(
  context: ConeContext,
  baseCone: Set<string>,
  _options: ConeOptions
): Set<string> {
  const { modifiedFiles, reverseDeps } = context;
  const expanded = new Set(baseCone);

  if (reverseDeps) {
    // Add direct importers of modified files
    for (const file of modifiedFiles) {
      const importers = reverseDeps.get(file);
      if (importers) {
        for (const importer of importers) {
          expanded.add(importer);
        }
      }
    }
  } else {
    // Fall back to a simple heuristic: add files with many current errors
    // This is cheaper than building a full dependency graph
    const errorCounts = new Map<string, number>();
    for (const diag of context.currentDiagnostics) {
      if (diag.file) {
        const file = diag.file.fileName;
        errorCounts.set(file, (errorCounts.get(file) || 0) + 1);
      }
    }

    // Sort by error count and add top files
    const sortedFiles = [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [file] of sortedFiles) {
      expanded.add(file);
    }
  }

  return expanded;
}

/**
 * Cap the cone size to prevent performance issues.
 *
 * When the cone is too large, prioritize:
 * 1. Files modified by the fix (always included)
 * 2. Files with the most errors
 */
function capConeSize(
  cone: Set<string>,
  modifiedFiles: Set<string>,
  maxSize: number
): Set<string> {
  if (cone.size <= maxSize) {
    return cone;
  }

  const capped = new Set<string>(modifiedFiles);
  const remaining = [...cone].filter((f) => !modifiedFiles.has(f));

  // Add remaining files up to the max
  for (const file of remaining) {
    if (capped.size >= maxSize) break;
    capped.add(file);
  }

  return capped;
}

// ============================================================================
// Reverse Dependency Graph
// ============================================================================

/**
 * Build a reverse dependency graph for the project.
 *
 * This maps each file to the set of files that import it.
 * Building this is expensive, so it should be done once and cached.
 */
export function buildReverseDependencyGraph(host: TypeScriptHost): Map<string, Set<string>> {
  const reverseDeps = new Map<string, Set<string>>();
  const fileNames = host.getFileNames();
  const options = host.getOptions();
  const vfs = host.getVFS();

  // Initialize all files
  for (const file of fileNames) {
    reverseDeps.set(file, new Set());
  }

  // Parse imports for each file
  for (const file of fileNames) {
    const content = vfs.read(file);
    if (!content) continue;

    const imports = extractImports(content, file, options);
    for (const importedFile of imports) {
      const normalized = normalizeImportPath(importedFile, file, fileNames, options);
      if (normalized && reverseDeps.has(normalized)) {
        reverseDeps.get(normalized)!.add(file);
      }
    }
  }

  return reverseDeps;
}

/**
 * Extract import paths from a file's content.
 */
function extractImports(
  content: string,
  _fileName: string,
  _options: ts.CompilerOptions
): string[] {
  const imports: string[] = [];

  // Match import statements
  const importRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Match require calls
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // Match export ... from statements
  const exportFromRegex = /export\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = exportFromRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Normalize an import path to a full file path.
 */
function normalizeImportPath(
  importPath: string,
  fromFile: string,
  projectFiles: string[],
  _options: ts.CompilerOptions
): string | null {
  // Skip external modules
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, importPath);

  // Try various extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".d.ts"];

  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (projectFiles.includes(withExt)) {
      return withExt;
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = path.join(resolved, `index${ext}`);
    if (projectFiles.includes(indexPath)) {
      return indexPath;
    }
  }

  // Return as-is if it matches a project file
  if (projectFiles.includes(resolved)) {
    return resolved;
  }

  return null;
}

// ============================================================================
// Scoped Diagnostics Cache
// ============================================================================

/**
 * Cache for scoped diagnostics to avoid redundant type-checking.
 *
 * The cache key is a sorted list of file names, and the value is the
 * diagnostics for those files.
 */
export class ScopedDiagnosticsCache {
  private cache = new Map<string, ts.Diagnostic[]>();
  private maxEntries: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(maxEntries: number = 100) {
    this.maxEntries = maxEntries;
  }

  /**
   * Create a cache key from a set of files.
   */
  private createKey(files: Set<string>): string {
    return [...files].sort().join("\n");
  }

  /**
   * Get cached diagnostics for a scope, or undefined if not cached.
   */
  get(files: Set<string>): ts.Diagnostic[] | undefined {
    const key = this.createKey(files);
    const result = this.cache.get(key);
    if (result !== undefined) {
      this.hitCount++;
    } else {
      this.missCount++;
    }
    return result;
  }

  /**
   * Store diagnostics for a scope.
   */
  set(files: Set<string>, diagnostics: ts.Diagnostic[]): void {
    const key = this.createKey(files);

    // Evict oldest entries if cache is full
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, diagnostics);
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hitCount + this.missCount;
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: this.cache.size,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }
}

// ============================================================================
// Cone-Scoped Verification
// ============================================================================

/**
 * Get diagnostics for a specific scope (cone).
 *
 * Uses the cache if available, otherwise computes and caches.
 */
export function getDiagnosticsForCone(
  host: TypeScriptHost,
  cone: VerificationCone,
  cache?: ScopedDiagnosticsCache
): ts.Diagnostic[] {
  // Check cache first
  if (cache) {
    const cached = cache.get(cone.files);
    if (cached !== undefined) {
      return cached;
    }
  }

  // Compute diagnostics for the cone
  const diagnostics = host.getDiagnosticsForFiles(cone.files);

  // Cache the result
  if (cache) {
    cache.set(cone.files, diagnostics);
  }

  return diagnostics;
}
