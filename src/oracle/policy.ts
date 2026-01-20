/**
 * Verification Policy
 *
 * Configuration for verification behavior including cone construction,
 * caching, and host invalidation strategies.
 */

import type { VerificationPolicy, VerificationScopeHint } from "../output/types.js";

/**
 * Default verification policy optimized for fast verification.
 *
 * - Only checks modified files by default (fast path)
 * - No regressions allowed
 * - Conservative cone size limits
 * - Caches "before" diagnostics per cone+iteration
 */
export const DEFAULT_POLICY: VerificationPolicy = {
  defaultScope: "modified",
  allowRegressions: false,
  maxConeFiles: 50,
  maxConeErrors: 100,
  coneExpansion: {
    includeErrors: false, // Fast path: modified files only
    includeReverseDeps: false,
    topKErrorFiles: 10,
  },
  cacheBeforeDiagnostics: true,
  cacheKeyStrategy: "cone+iteration",
  hostInvalidation: "modified",
};

/**
 * Verification policy for structural edits that may affect many files.
 * Uses wider cone and includes error files.
 */
export const STRUCTURAL_POLICY: VerificationPolicy = {
  defaultScope: "errors",
  allowRegressions: false,
  maxConeFiles: 100,
  maxConeErrors: 200,
  coneExpansion: {
    includeErrors: true,
    includeReverseDeps: false,
    topKErrorFiles: 20,
  },
  cacheBeforeDiagnostics: true,
  cacheKeyStrategy: "cone+iteration",
  hostInvalidation: "cone",
};

/**
 * Verification policy for wide-impact changes.
 * Includes reverse dependencies and allows larger cones.
 */
export const WIDE_POLICY: VerificationPolicy = {
  defaultScope: "wide",
  allowRegressions: false,
  maxConeFiles: 200,
  maxConeErrors: 500,
  coneExpansion: {
    includeErrors: true,
    includeReverseDeps: true,
    topKErrorFiles: 50,
  },
  cacheBeforeDiagnostics: true,
  cacheKeyStrategy: "cone+iteration",
  hostInvalidation: "full",
};

/**
 * Merge a partial policy with the default policy.
 * Performs deep merge for nested coneExpansion object.
 */
export function mergePolicy(
  partial: Partial<VerificationPolicy> = {}
): VerificationPolicy {
  return {
    ...DEFAULT_POLICY,
    ...partial,
    coneExpansion: {
      ...DEFAULT_POLICY.coneExpansion,
      ...partial.coneExpansion,
    },
  };
}

/**
 * Select the appropriate host invalidation strategy based on the cone.
 *
 * - If cone only contains modified files: use "modified"
 * - If cone includes error files: use "cone"
 * - If cone includes reverse deps (wide): use "full"
 */
export function selectHostInvalidation(
  modifiedFiles: Set<string>,
  cone: Set<string>,
  policy: VerificationPolicy
): "modified" | "cone" | "full" {
  // If policy explicitly specifies, use that
  if (policy.hostInvalidation !== "modified") {
    return policy.hostInvalidation;
  }

  // Otherwise, derive from cone contents
  if (cone.size === modifiedFiles.size) {
    // Cone is exactly modified files
    let allModified = true;
    for (const f of cone) {
      if (!modifiedFiles.has(f)) {
        allModified = false;
        break;
      }
    }
    if (allModified) {
      return "modified";
    }
  }

  // Cone has additional files, use cone-level invalidation
  return "cone";
}

/**
 * Get a policy based on scope hint.
 * Useful for selecting appropriate policy based on candidate characteristics.
 */
export function getPolicyForScope(scope: VerificationScopeHint): VerificationPolicy {
  switch (scope) {
    case "modified":
      return DEFAULT_POLICY;
    case "errors":
      return STRUCTURAL_POLICY;
    case "wide":
      return WIDE_POLICY;
  }
}

/**
 * Validate a policy configuration.
 * Returns an array of validation errors (empty if valid).
 */
export function validatePolicy(policy: VerificationPolicy): string[] {
  const errors: string[] = [];

  if (policy.maxConeFiles <= 0) {
    errors.push("maxConeFiles must be positive");
  }

  if (policy.maxConeErrors <= 0) {
    errors.push("maxConeErrors must be positive");
  }

  if (policy.coneExpansion.topKErrorFiles < 0) {
    errors.push("topKErrorFiles cannot be negative");
  }

  if (policy.coneExpansion.topKErrorFiles > policy.maxConeFiles) {
    errors.push("topKErrorFiles should not exceed maxConeFiles");
  }

  const validScopes: VerificationScopeHint[] = ["modified", "errors", "wide"];
  if (!validScopes.includes(policy.defaultScope)) {
    errors.push(`Invalid defaultScope: ${policy.defaultScope}`);
  }

  const validStrategies = ["cone", "cone+iteration"];
  if (!validStrategies.includes(policy.cacheKeyStrategy)) {
    errors.push(`Invalid cacheKeyStrategy: ${policy.cacheKeyStrategy}`);
  }

  const validInvalidation = ["modified", "cone", "full"];
  if (!validInvalidation.includes(policy.hostInvalidation)) {
    errors.push(`Invalid hostInvalidation: ${policy.hostInvalidation}`);
  }

  return errors;
}
