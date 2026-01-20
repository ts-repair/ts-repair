/**
 * Verification Policy Unit Tests
 */

import { describe, it, expect } from "bun:test";
import {
  DEFAULT_POLICY,
  STRUCTURAL_POLICY,
  WIDE_POLICY,
  mergePolicy,
  selectHostInvalidation,
  getPolicyForScope,
  validatePolicy,
} from "../../src/oracle/policy.js";
import type { VerificationPolicy } from "../../src/output/types.js";

describe("DEFAULT_POLICY", () => {
  it("has expected default values", () => {
    expect(DEFAULT_POLICY.defaultScope).toBe("modified");
    expect(DEFAULT_POLICY.allowRegressions).toBe(false);
    expect(DEFAULT_POLICY.maxConeFiles).toBe(50);
    expect(DEFAULT_POLICY.maxConeErrors).toBe(100);
    expect(DEFAULT_POLICY.coneExpansion.includeErrors).toBe(false);
    expect(DEFAULT_POLICY.coneExpansion.includeReverseDeps).toBe(false);
    expect(DEFAULT_POLICY.coneExpansion.topKErrorFiles).toBe(10);
    expect(DEFAULT_POLICY.cacheBeforeDiagnostics).toBe(true);
    expect(DEFAULT_POLICY.cacheKeyStrategy).toBe("cone+iteration");
    expect(DEFAULT_POLICY.hostInvalidation).toBe("modified");
  });

  it("is a valid policy", () => {
    expect(validatePolicy(DEFAULT_POLICY)).toHaveLength(0);
  });
});

describe("STRUCTURAL_POLICY", () => {
  it("has wider scope than default", () => {
    expect(STRUCTURAL_POLICY.defaultScope).toBe("errors");
    expect(STRUCTURAL_POLICY.maxConeFiles).toBeGreaterThan(DEFAULT_POLICY.maxConeFiles);
    expect(STRUCTURAL_POLICY.coneExpansion.includeErrors).toBe(true);
  });

  it("is a valid policy", () => {
    expect(validatePolicy(STRUCTURAL_POLICY)).toHaveLength(0);
  });
});

describe("WIDE_POLICY", () => {
  it("has widest scope", () => {
    expect(WIDE_POLICY.defaultScope).toBe("wide");
    expect(WIDE_POLICY.coneExpansion.includeErrors).toBe(true);
    expect(WIDE_POLICY.coneExpansion.includeReverseDeps).toBe(true);
    expect(WIDE_POLICY.maxConeFiles).toBeGreaterThan(STRUCTURAL_POLICY.maxConeFiles);
  });

  it("is a valid policy", () => {
    expect(validatePolicy(WIDE_POLICY)).toHaveLength(0);
  });
});

describe("mergePolicy", () => {
  it("returns default policy when no options provided", () => {
    const policy = mergePolicy();

    expect(policy.defaultScope).toBe(DEFAULT_POLICY.defaultScope);
    expect(policy.maxConeFiles).toBe(DEFAULT_POLICY.maxConeFiles);
    expect(policy.coneExpansion.includeErrors).toBe(
      DEFAULT_POLICY.coneExpansion.includeErrors
    );
  });

  it("overrides top-level properties", () => {
    const policy = mergePolicy({
      defaultScope: "wide",
      maxConeFiles: 200,
      allowRegressions: true,
    });

    expect(policy.defaultScope).toBe("wide");
    expect(policy.maxConeFiles).toBe(200);
    expect(policy.allowRegressions).toBe(true);
    // Unchanged properties should have defaults
    expect(policy.maxConeErrors).toBe(DEFAULT_POLICY.maxConeErrors);
  });

  it("deep merges coneExpansion", () => {
    const policy = mergePolicy({
      coneExpansion: {
        includeErrors: true,
      },
    });

    expect(policy.coneExpansion.includeErrors).toBe(true);
    // Other coneExpansion properties should have defaults
    expect(policy.coneExpansion.includeReverseDeps).toBe(
      DEFAULT_POLICY.coneExpansion.includeReverseDeps
    );
    expect(policy.coneExpansion.topKErrorFiles).toBe(
      DEFAULT_POLICY.coneExpansion.topKErrorFiles
    );
  });

  it("handles empty partial", () => {
    const policy = mergePolicy({});
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it("handles undefined partial", () => {
    const policy = mergePolicy(undefined);
    expect(policy).toEqual(DEFAULT_POLICY);
  });
});

describe("selectHostInvalidation", () => {
  it("uses policy setting when not modified", () => {
    const policy = mergePolicy({ hostInvalidation: "cone" });
    const modifiedFiles = new Set(["/a.ts"]);
    const cone = new Set(["/a.ts", "/b.ts"]);

    expect(selectHostInvalidation(modifiedFiles, cone, policy)).toBe("cone");
  });

  it("uses policy setting for full invalidation", () => {
    const policy = mergePolicy({ hostInvalidation: "full" });
    const modifiedFiles = new Set(["/a.ts"]);
    const cone = new Set(["/a.ts"]);

    expect(selectHostInvalidation(modifiedFiles, cone, policy)).toBe("full");
  });

  it("returns modified when cone equals modified files", () => {
    const policy = mergePolicy({ hostInvalidation: "modified" });
    const modifiedFiles = new Set(["/a.ts", "/b.ts"]);
    const cone = new Set(["/a.ts", "/b.ts"]);

    expect(selectHostInvalidation(modifiedFiles, cone, policy)).toBe("modified");
  });

  it("returns cone when cone has additional files", () => {
    const policy = mergePolicy({ hostInvalidation: "modified" });
    const modifiedFiles = new Set(["/a.ts"]);
    const cone = new Set(["/a.ts", "/b.ts", "/c.ts"]);

    expect(selectHostInvalidation(modifiedFiles, cone, policy)).toBe("cone");
  });

  it("returns cone when sizes match but files differ", () => {
    const policy = mergePolicy({ hostInvalidation: "modified" });
    const modifiedFiles = new Set(["/a.ts", "/b.ts"]);
    const cone = new Set(["/a.ts", "/c.ts"]); // Same size, different content

    expect(selectHostInvalidation(modifiedFiles, cone, policy)).toBe("cone");
  });
});

describe("getPolicyForScope", () => {
  it("returns DEFAULT_POLICY for modified scope", () => {
    expect(getPolicyForScope("modified")).toBe(DEFAULT_POLICY);
  });

  it("returns STRUCTURAL_POLICY for errors scope", () => {
    expect(getPolicyForScope("errors")).toBe(STRUCTURAL_POLICY);
  });

  it("returns WIDE_POLICY for wide scope", () => {
    expect(getPolicyForScope("wide")).toBe(WIDE_POLICY);
  });
});

describe("validatePolicy", () => {
  it("returns empty array for valid policy", () => {
    const errors = validatePolicy(DEFAULT_POLICY);
    expect(errors).toHaveLength(0);
  });

  it("detects non-positive maxConeFiles", () => {
    const policy: VerificationPolicy = {
      ...DEFAULT_POLICY,
      maxConeFiles: 0,
    };

    const errors = validatePolicy(policy);
    expect(errors).toContain("maxConeFiles must be positive");
  });

  it("detects negative maxConeFiles", () => {
    const policy: VerificationPolicy = {
      ...DEFAULT_POLICY,
      maxConeFiles: -10,
    };

    const errors = validatePolicy(policy);
    expect(errors).toContain("maxConeFiles must be positive");
  });

  it("detects non-positive maxConeErrors", () => {
    const policy: VerificationPolicy = {
      ...DEFAULT_POLICY,
      maxConeErrors: 0,
    };

    const errors = validatePolicy(policy);
    expect(errors).toContain("maxConeErrors must be positive");
  });

  it("detects negative topKErrorFiles", () => {
    const policy: VerificationPolicy = {
      ...DEFAULT_POLICY,
      coneExpansion: {
        ...DEFAULT_POLICY.coneExpansion,
        topKErrorFiles: -1,
      },
    };

    const errors = validatePolicy(policy);
    expect(errors).toContain("topKErrorFiles cannot be negative");
  });

  it("detects topKErrorFiles exceeding maxConeFiles", () => {
    const policy: VerificationPolicy = {
      ...DEFAULT_POLICY,
      maxConeFiles: 10,
      coneExpansion: {
        ...DEFAULT_POLICY.coneExpansion,
        topKErrorFiles: 20,
      },
    };

    const errors = validatePolicy(policy);
    expect(errors).toContain("topKErrorFiles should not exceed maxConeFiles");
  });

  it("detects multiple validation errors", () => {
    const policy: VerificationPolicy = {
      ...DEFAULT_POLICY,
      maxConeFiles: 0,
      maxConeErrors: 0,
    };

    const errors = validatePolicy(policy);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("validates valid boundary values", () => {
    const policy: VerificationPolicy = {
      ...DEFAULT_POLICY,
      maxConeFiles: 1,
      maxConeErrors: 1,
      coneExpansion: {
        ...DEFAULT_POLICY.coneExpansion,
        topKErrorFiles: 0,
      },
    };

    const errors = validatePolicy(policy);
    expect(errors).toHaveLength(0);
  });
});
