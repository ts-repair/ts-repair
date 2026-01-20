/**
 * Verification Module
 *
 * Handles verification cone construction, diagnostic caching, and verification
 * policy for the vNext repair framework. The "cone of attention" determines
 * which files are checked when verifying a candidate fix.
 */

import ts from "typescript";
import type { CandidateFix, VerificationScopeHint } from "./candidate.js";
import { getModifiedFiles, getScopeHint } from "./candidate.js";

// ============================================================================
// Verification Scope
// ============================================================================

/**
 * Verification scope determines how wide the cone of attention is.
 *
 * - "modified": Only files touched by the candidate (fast path, default)
 * - "errors": Modified files + all files with existing errors
 * - "wide": Modified + errors + reverse dependencies or topK error files
 */
export type VerificationScope = VerificationScopeHint;

// ============================================================================
// Verification Policy
// ============================================================================

/**
 * Policy controlling verification behavior.
 *
 * The policy makes scope and invalidation configurable so structural fixes
 * can widen scope while keeping fast paths for lexical changes.
 */
export interface VerificationPolicy {
  /** Default scope for candidates without scopeHint */
  defaultScope: VerificationScope;

  /** Allow candidates that introduce regressions (new errors) */
  allowRegressions: boolean;

  /** Maximum files in a verification cone (0 = unlimited) */
  maxConeFiles: number;

  /** Maximum errors to track in a cone (0 = unlimited) */
  maxConeErrors: number;

  /** Cone expansion settings */
  coneExpansion: {
    /** Include files with existing errors in the cone */
    includeErrors: boolean;
    /** Include reverse dependencies of modified files (expensive) */
    includeReverseDeps: boolean;
    /** Limit error files to top K by error count */
    topKErrorFiles: number;
  };

  /** Cache before-diagnostics per cone signature */
  cacheBeforeDiagnostics: boolean;

  /** Cache key strategy */
  cacheKeyStrategy: "cone" | "cone+iteration";

  /** Host invalidation strategy after verification */
  hostInvalidation: "modified" | "cone" | "full";
}

/**
 * Default verification policy (fast path for lexical fixes).
 */
export const DEFAULT_VERIFICATION_POLICY: VerificationPolicy = {
  defaultScope: "modified",
  allowRegressions: false,
  maxConeFiles: 100,
  maxConeErrors: 500,
  coneExpansion: {
    includeErrors: false, // Only expand for structural edits with scopeHint
    includeReverseDeps: false,
    topKErrorFiles: 50,
  },
  cacheBeforeDiagnostics: true,
  cacheKeyStrategy: "cone+iteration",
  hostInvalidation: "modified",
};

/**
 * Policy preset for structural fixes (wider verification).
 */
export const STRUCTURAL_VERIFICATION_POLICY: VerificationPolicy = {
  ...DEFAULT_VERIFICATION_POLICY,
  defaultScope: "errors",
  coneExpansion: {
    includeErrors: true,
    includeReverseDeps: false,
    topKErrorFiles: 50,
  },
  hostInvalidation: "cone",
};

/**
 * Merge a partial policy with defaults.
 */
export function mergePolicy(
  partial?: Partial<VerificationPolicy>
): VerificationPolicy {
  if (!partial) return DEFAULT_VERIFICATION_POLICY;

  return {
    ...DEFAULT_VERIFICATION_POLICY,
    ...partial,
    coneExpansion: {
      ...DEFAULT_VERIFICATION_POLICY.coneExpansion,
      ...partial.coneExpansion,
    },
  };
}

// ============================================================================
// Cone Specification
// ============================================================================

/**
 * A verification cone specifies which files to check.
 */
export interface ConeSpec {
  /** The scope that determined this cone */
  scope: VerificationScope;

  /** Files included in the cone */
  files: Set<string>;

  /** Signature for caching (deterministic string from sorted files) */
  signature: string;

  /** Whether the cone was capped due to policy limits */
  capped: boolean;
}

/**
 * Context for building a cone.
 */
export interface ConeContext {
  /** Files that currently have errors */
  filesWithErrors: Set<string>;

  /** Error count per file (for topK selection) */
  errorCountByFile?: Map<string, number>;

  /** Reverse dependency map (file -> files that depend on it) */
  reverseDeps?: Map<string, Set<string>>;

  /** Current planning iteration (for cache key) */
  iteration?: number;
}

/**
 * Build a verification cone for a candidate.
 *
 * The cone determines which files will be type-checked to verify the fix.
 * Larger cones catch more cascading effects but are slower.
 */
export function buildCone(
  candidate: CandidateFix,
  context: ConeContext,
  policy: VerificationPolicy
): ConeSpec {
  const modifiedFiles = getModifiedFiles(candidate);
  const candidateScopeHint = getScopeHint(candidate);

  // Determine effective scope: candidate hint overrides policy default
  const effectiveScope =
    candidateScopeHint !== "modified" ? candidateScopeHint : policy.defaultScope;

  // Start with modified files
  const files = new Set(modifiedFiles);
  let capped = false;

  // Expand based on scope
  if (effectiveScope === "errors" || effectiveScope === "wide") {
    if (policy.coneExpansion.includeErrors) {
      // Add files with errors (possibly limited to topK)
      const errorFiles = selectTopKErrorFiles(
        context.filesWithErrors,
        context.errorCountByFile,
        policy.coneExpansion.topKErrorFiles
      );
      for (const file of errorFiles) {
        files.add(file);
      }
    }
  }

  if (effectiveScope === "wide") {
    if (policy.coneExpansion.includeReverseDeps && context.reverseDeps) {
      // Add reverse dependencies of modified files
      for (const modifiedFile of modifiedFiles) {
        const deps = context.reverseDeps.get(modifiedFile);
        if (deps) {
          for (const dep of deps) {
            files.add(dep);
          }
        }
      }
    }
  }

  // Apply cone size cap
  if (policy.maxConeFiles > 0 && files.size > policy.maxConeFiles) {
    capped = true;
    // Prioritize: modified files first, then error files by error count
    const prioritized = prioritizeFiles(
      files,
      modifiedFiles,
      context.errorCountByFile,
      policy.maxConeFiles
    );
    files.clear();
    for (const file of prioritized) {
      files.add(file);
    }
  }

  // Compute signature for caching
  const signature = computeConeSignature(files, context.iteration, policy);

  return {
    scope: effectiveScope,
    files,
    signature,
    capped,
  };
}

/**
 * Select top K files by error count.
 */
function selectTopKErrorFiles(
  filesWithErrors: Set<string>,
  errorCountByFile: Map<string, number> | undefined,
  topK: number
): Set<string> {
  if (topK <= 0 || !errorCountByFile || filesWithErrors.size <= topK) {
    return filesWithErrors;
  }

  // Sort by error count descending
  const sorted = Array.from(filesWithErrors).sort((a, b) => {
    const countA = errorCountByFile.get(a) ?? 0;
    const countB = errorCountByFile.get(b) ?? 0;
    return countB - countA;
  });

  return new Set(sorted.slice(0, topK));
}

/**
 * Prioritize files when cone exceeds size limit.
 * Modified files always included, then by error count.
 */
function prioritizeFiles(
  allFiles: Set<string>,
  modifiedFiles: Set<string>,
  errorCountByFile: Map<string, number> | undefined,
  limit: number
): string[] {
  const result: string[] = [];

  // Always include modified files first
  for (const file of modifiedFiles) {
    if (result.length >= limit) break;
    result.push(file);
  }

  if (result.length >= limit) return result;

  // Sort remaining by error count
  const remaining = Array.from(allFiles)
    .filter((f) => !modifiedFiles.has(f))
    .sort((a, b) => {
      const countA = errorCountByFile?.get(a) ?? 0;
      const countB = errorCountByFile?.get(b) ?? 0;
      return countB - countA;
    });

  for (const file of remaining) {
    if (result.length >= limit) break;
    result.push(file);
  }

  return result;
}

/**
 * Compute a deterministic cache signature for a cone.
 */
function computeConeSignature(
  files: Set<string>,
  iteration: number | undefined,
  policy: VerificationPolicy
): string {
  // Sort files for deterministic signature
  const sortedFiles = Array.from(files).sort();
  const filesHash = sortedFiles.join("\0");

  if (policy.cacheKeyStrategy === "cone+iteration" && iteration !== undefined) {
    return `${iteration}:${filesHash}`;
  }

  return filesHash;
}

/**
 * Compute a simple cone signature from files only (for external use).
 */
export function coneSignature(files: Set<string>, iteration?: number): string {
  const sortedFiles = Array.from(files).sort();
  const filesHash = sortedFiles.join("\0");
  return iteration !== undefined ? `${iteration}:${filesHash}` : filesHash;
}

// ============================================================================
// Diagnostic Cache
// ============================================================================

/**
 * Cache statistics.
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Current cache size (number of entries) */
  size: number;
  /** Total diagnostics cached */
  totalDiagnostics: number;
}

/**
 * Cache for "before" diagnostics per cone signature.
 *
 * This avoids redundant type-checking when multiple candidates share the same
 * verification cone within an iteration.
 */
export interface DiagnosticCache {
  /** Get cached diagnostics for a cone signature */
  get(signature: string): ts.Diagnostic[] | undefined;

  /** Store diagnostics for a cone signature */
  set(signature: string, diagnostics: ts.Diagnostic[]): void;

  /** Check if a signature is cached */
  has(signature: string): boolean;

  /** Clear cache (e.g., for new iteration) */
  clear(): void;

  /** Clear entries for a specific iteration prefix */
  clearIteration(iteration: number): void;

  /** Get cache statistics */
  stats(): CacheStats;
}

/**
 * Create a diagnostic cache.
 */
export function createDiagnosticCache(maxSize?: number): DiagnosticCache {
  const cache = new Map<string, ts.Diagnostic[]>();
  let hits = 0;
  let misses = 0;
  const limit = maxSize ?? 1000;

  return {
    get(signature: string): ts.Diagnostic[] | undefined {
      const result = cache.get(signature);
      if (result !== undefined) {
        hits++;
      } else {
        misses++;
      }
      return result;
    },

    set(signature: string, diagnostics: ts.Diagnostic[]): void {
      // Simple LRU: if at limit, clear oldest half
      if (cache.size >= limit) {
        const keys = Array.from(cache.keys());
        const toDelete = keys.slice(0, Math.floor(limit / 2));
        for (const key of toDelete) {
          cache.delete(key);
        }
      }
      cache.set(signature, diagnostics);
    },

    has(signature: string): boolean {
      return cache.has(signature);
    },

    clear(): void {
      cache.clear();
      // Don't reset stats - they're cumulative
    },

    clearIteration(iteration: number): void {
      const prefix = `${iteration}:`;
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
          cache.delete(key);
        }
      }
    },

    stats(): CacheStats {
      let totalDiagnostics = 0;
      for (const diags of cache.values()) {
        totalDiagnostics += diags.length;
      }
      return {
        hits,
        misses,
        size: cache.size,
        totalDiagnostics,
      };
    },
  };
}

// ============================================================================
// Verification Result
// ============================================================================

/**
 * Result of verifying a candidate fix.
 */
export interface VerificationResult {
  /** Did the fix eliminate the target diagnostic? */
  targetFixed: boolean;

  /** Error count before the fix (in cone) */
  errorsBefore: number;

  /** Error count after the fix (in cone) */
  errorsAfter: number;

  /** Net change (positive = good) */
  delta: number;

  /** New diagnostics introduced by this fix */
  newDiagnostics: ts.Diagnostic[];

  /** Diagnostics that were resolved */
  resolvedDiagnostics: ts.Diagnostic[];

  /** Weighted sum of resolved diagnostics (for weighted scoring) */
  resolvedWeight: number;

  /** Weighted sum of introduced diagnostics (for weighted scoring) */
  introducedWeight: number;

  /** Total edit size for the fix */
  editSize: number;

  /** The cone used for verification */
  cone: ConeSpec;

  /** Whether before-diagnostics came from cache */
  cacheHit: boolean;
}

/**
 * Compute diagnostic weight by category.
 */
export function diagnosticWeight(diagnostic: ts.Diagnostic): number {
  switch (diagnostic.category) {
    case ts.DiagnosticCategory.Warning:
      return 0.5;
    case ts.DiagnosticCategory.Suggestion:
      return 0.25;
    case ts.DiagnosticCategory.Message:
      return 0.1;
    case ts.DiagnosticCategory.Error:
    default:
      return 1;
  }
}

/**
 * Create a unique key for a diagnostic (for set operations).
 */
export function diagnosticKey(diagnostic: ts.Diagnostic): string {
  const file = diagnostic.file?.fileName ?? "<unknown>";
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return `${file}::${diagnostic.code}::${message}`;
}

// ============================================================================
// Error Count Helpers
// ============================================================================

/**
 * Build a map of error counts per file from diagnostics.
 */
export function buildErrorCountByFile(
  diagnostics: ts.Diagnostic[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diag of diagnostics) {
    if (diag.file) {
      const current = counts.get(diag.file.fileName) ?? 0;
      counts.set(diag.file.fileName, current + 1);
    }
  }
  return counts;
}

/**
 * Build a set of files that have errors.
 */
export function buildFilesWithErrors(diagnostics: ts.Diagnostic[]): Set<string> {
  const files = new Set<string>();
  for (const diag of diagnostics) {
    if (diag.file) {
      files.add(diag.file.fileName);
    }
  }
  return files;
}
