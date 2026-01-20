/**
 * Verification Cone
 *
 * Constructs and manages the "cone of attention" for verification.
 * The cone determines which files are checked after applying a candidate fix.
 */

import type ts from "typescript";
import type { VerificationPolicy, VerificationScopeHint } from "../output/types.js";

/**
 * Cache for "before" diagnostics keyed by cone signature.
 * Used to avoid recomputing diagnostics for the same set of files.
 */
export class ConeCache {
  private cache = new Map<string, ts.Diagnostic[]>();
  private iteration = 0;

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
   */
  get(files: Set<string>, includeIteration: boolean): ts.Diagnostic[] | undefined {
    const key = this.getConeSignature(files, includeIteration);
    return this.cache.get(key);
  }

  /**
   * Cache diagnostics for a cone.
   */
  set(files: Set<string>, diagnostics: ts.Diagnostic[], includeIteration: boolean): void {
    const key = this.getConeSignature(files, includeIteration);
    this.cache.set(key, diagnostics);
  }

  /**
   * Check if cone diagnostics are cached.
   */
  has(files: Set<string>, includeIteration: boolean): boolean {
    const key = this.getConeSignature(files, includeIteration);
    return this.cache.has(key);
  }

  /**
   * Advance to the next iteration.
   * Clears the cache since file contents may have changed.
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
}

/**
 * Build a verification cone based on modified files, error files, and policy.
 *
 * The cone starts with modified files and expands based on:
 * - scopeHint: The candidate's preferred scope
 * - policy: Configuration for cone expansion
 * - reverseDepsLookup: Optional function to find reverse dependencies
 */
export function buildCone(
  modifiedFiles: Set<string>,
  filesWithErrors: Set<string>,
  scopeHint: VerificationScopeHint,
  policy: VerificationPolicy,
  reverseDepsLookup?: (files: Set<string>) => Set<string>
): Set<string> {
  const cone = new Set(modifiedFiles);

  // For "modified" scope without includeErrors, just return modified files
  if (scopeHint === "modified" && !policy.coneExpansion.includeErrors) {
    return capConeSize(cone, modifiedFiles, filesWithErrors, policy);
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

  return capConeSize(cone, modifiedFiles, filesWithErrors, policy);
}

/**
 * Cap the cone size to stay within policy limits.
 * Prioritizes: modified files > error files (by frequency) > others
 */
function capConeSize(
  cone: Set<string>,
  modifiedFiles: Set<string>,
  filesWithErrors: Set<string>,
  policy: VerificationPolicy
): Set<string> {
  if (cone.size <= policy.maxConeFiles) {
    return cone;
  }

  // Start with modified files (always included)
  const result = new Set(modifiedFiles);

  // Add top-K error files
  let added = 0;
  for (const f of filesWithErrors) {
    if (added >= policy.coneExpansion.topKErrorFiles) break;
    if (!result.has(f)) {
      result.add(f);
      added++;
    }
    // Also check overall limit
    if (result.size >= policy.maxConeFiles) break;
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
