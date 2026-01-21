/**
 * Verification Cone
 *
 * Constructs and manages the "cone of attention" for verification.
 * The cone determines which files are checked after applying a candidate fix.
 */

import type ts from "typescript";
import type { VerificationPolicy, VerificationScopeHint, CacheStats } from "../output/types.js";
import path from "path";

/**
 * Cache for "before" diagnostics keyed by cone signature.
 * Uses LRU eviction to bound memory usage and tracks hit/miss statistics.
 */
export class ConeCache {
  private cache = new Map<string, ts.Diagnostic[]>();
  private iteration = 0;
  private hits = 0;
  private misses = 0;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Compute a signature for a cone (set of files).
   * Includes iteration number if using "cone+iteration" strategy.
   */
  getConeSignature(files: Set<string>, includeIteration: boolean): string {
    const sorted = [...files].sort();
    const filesHash = sorted.join(",");
    if (includeIteration) {
      return `${this.iteration}:${filesHash}`;
    }
    return filesHash;
  }

  /**
   * Get cached diagnostics for a cone.
   * Tracks hits and misses for statistics.
   */
  get(files: Set<string>, includeIteration: boolean): ts.Diagnostic[] | undefined {
    const key = this.getConeSignature(files, includeIteration);
    const result = this.cache.get(key);
    if (result !== undefined) {
      this.hits++;
      // Move to end for LRU (delete and re-add)
      this.cache.delete(key);
      this.cache.set(key, result);
      return result;
    }
    this.misses++;
    return undefined;
  }

  /**
   * Cache diagnostics for a cone.
   * Uses LRU eviction when cache is at capacity.
   */
  set(files: Set<string>, diagnostics: ts.Diagnostic[], includeIteration: boolean): void {
    const key = this.getConeSignature(files, includeIteration);

    // If key already exists, delete it first (will be re-added at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // LRU eviction: remove oldest entry when at capacity
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, diagnostics);
  }

  /**
   * Check if cone diagnostics are cached.
   * Note: Does not affect hit/miss stats (use get() for that).
   */
  has(files: Set<string>, includeIteration: boolean): boolean {
    const key = this.getConeSignature(files, includeIteration);
    return this.cache.has(key);
  }

  /**
   * Advance to the next iteration.
   * Clears the cache since file contents may have changed.
   * Preserves hit/miss statistics.
   */
  nextIteration(): void {
    this.iteration++;
    this.cache.clear();
  }

  /**
   * Get the current iteration number.
   */
  getIteration(): number {
    return this.iteration;
  }

  /**
   * Clear the cache without advancing iteration.
   * Preserves hit/miss statistics.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entries.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics including hits, misses, and hit rate.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
    };
  }

  /**
   * Reset hit/miss statistics without clearing the cache.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get the maximum cache size.
   */
  getMaxSize(): number {
    return this.maxSize;
  }

  /**
   * Set the maximum cache size.
   * If new size is smaller, evicts oldest entries.
   */
  setMaxSize(newSize: number): void {
    this.maxSize = newSize;
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }
}

// ============================================================================
// Error File Ranking
// ============================================================================

/**
 * Score information for an error file.
 * Higher score = more likely to detect regressions from a change.
 */
export interface FileScore {
  file: string;
  score: number;
  reason: string;
}

/**
 * Score an error file for inclusion in verification cone.
 * Higher score = more likely to detect regressions from the change.
 */
function scoreErrorFile(
  file: string,
  modifiedFiles: Set<string>,
  reverseDeps: Map<string, Set<string>>
): FileScore {
  let score = 0;
  let reason = "";

  // Direct import from modified file: high score
  const deps = reverseDeps.get(file);
  if (deps) {
    for (const mod of modifiedFiles) {
      if (deps.has(mod)) {
        score += 10;
        reason = "imports-modified";
        break;
      }
    }
  }

  // Same directory as modified: medium score
  for (const mod of modifiedFiles) {
    if (path.dirname(file) === path.dirname(mod)) {
      score += 5;
      if (!reason) reason = "same-directory";
      break;
    }
  }

  // Baseline score for any error file
  if (score === 0) {
    score = 1;
    reason = "error-file";
  }

  return { file, score, reason };
}

/**
 * Rank error files and return Top-K for cone inclusion.
 * Files are scored based on their relationship to modified files:
 * - Files that import modified files score highest
 * - Files in the same directory score medium
 * - All other error files get baseline score
 *
 * @param errorFiles Set of files containing errors
 * @param modifiedFiles Set of files being modified
 * @param reverseDeps Map from file to set of files that import it
 * @param maxFiles Maximum files to return
 * @returns Ranked list of files (highest score first)
 */
export function rankErrorFiles(
  errorFiles: Set<string>,
  modifiedFiles: Set<string>,
  reverseDeps: Map<string, Set<string>>,
  maxFiles: number = 20
): FileScore[] {
  const scored = Array.from(errorFiles)
    .filter(f => !modifiedFiles.has(f)) // Exclude already-modified files
    .map(f => scoreErrorFile(f, modifiedFiles, reverseDeps))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxFiles);
}

// ============================================================================
// Cone Building
// ============================================================================

/**
 * Build a verification cone based on modified files, error files, and policy.
 *
 * The cone starts with modified files and expands based on:
 * - scopeHint: The candidate's preferred scope
 * - policy: Configuration for cone expansion
 * - reverseDepsLookup: Optional function to find reverse dependencies
 * - reverseDepsMap: Optional map for ranked expansion (from file to files that import it)
 */
export function buildCone(
  modifiedFiles: Set<string>,
  filesWithErrors: Set<string>,
  scopeHint: VerificationScopeHint,
  policy: VerificationPolicy,
  reverseDepsLookup?: (files: Set<string>) => Set<string>,
  reverseDepsMap?: Map<string, Set<string>>
): Set<string> {
  const cone = new Set(modifiedFiles);

  // For "modified" scope without includeErrors, just return modified files
  if (scopeHint === "modified" && !policy.coneExpansion.includeErrors) {
    return capConeSize(cone, modifiedFiles, filesWithErrors, policy, reverseDepsMap);
  }

  // For "errors" scope or when includeErrors is enabled, add error files
  if (scopeHint === "errors" || policy.coneExpansion.includeErrors) {
    for (const f of filesWithErrors) {
      cone.add(f);
    }
  }

  // For "wide" scope with reverse deps, add reverse dependencies
  if (scopeHint === "wide" && policy.coneExpansion.includeReverseDeps && reverseDepsLookup) {
    const deps = reverseDepsLookup(modifiedFiles);
    for (const f of deps) {
      cone.add(f);
    }
  }

  return capConeSize(cone, modifiedFiles, filesWithErrors, policy, reverseDepsMap);
}

/**
 * Cap the cone size to stay within policy limits.
 * Uses ranked error files for smarter selection.
 *
 * Priority:
 * 1. Modified files (always included)
 * 2. Ranked error files (based on relationship to modified files)
 */
function capConeSize(
  cone: Set<string>,
  modifiedFiles: Set<string>,
  filesWithErrors: Set<string>,
  policy: VerificationPolicy,
  reverseDepsMap?: Map<string, Set<string>>
): Set<string> {
  if (cone.size <= policy.maxConeFiles) {
    return cone;
  }

  // Start with modified files (always included)
  const result = new Set(modifiedFiles);

  // Use ranked error files for smarter selection
  const ranked = rankErrorFiles(
    filesWithErrors,
    modifiedFiles,
    reverseDepsMap ?? new Map(),
    policy.coneExpansion.topKErrorFiles
  );

  // Add ranked error files up to limit
  for (const { file } of ranked) {
    if (result.size >= policy.maxConeFiles) break;
    if (!result.has(file)) {
      result.add(file);
    }
  }

  return result;
}

/**
 * Determine the effective scope hint for a candidate.
 * Uses the candidate's scopeHint if specified, otherwise falls back to policy default.
 */
export function getEffectiveScope(
  candidateScopeHint: VerificationScopeHint | undefined,
  policy: VerificationPolicy
): VerificationScopeHint {
  return candidateScopeHint ?? policy.defaultScope;
}

/**
 * Check if a cone is valid (not empty and within limits).
 */
export function isConeValid(cone: Set<string>, policy: VerificationPolicy): boolean {
  return cone.size > 0 && cone.size <= policy.maxConeFiles;
}

/**
 * Get statistics about a cone for logging/debugging.
 */
export function getConeStats(
  cone: Set<string>,
  modifiedFiles: Set<string>,
  filesWithErrors: Set<string>
): {
  total: number;
  modified: number;
  errors: number;
  other: number;
} {
  let modified = 0;
  let errors = 0;
  let other = 0;

  for (const f of cone) {
    if (modifiedFiles.has(f)) {
      modified++;
    } else if (filesWithErrors.has(f)) {
      errors++;
    } else {
      other++;
    }
  }

  return { total: cone.size, modified, errors, other };
}
