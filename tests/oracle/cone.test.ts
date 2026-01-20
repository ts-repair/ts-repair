/**
 * Verification Cone Unit Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  ConeCache,
  buildCone,
  getEffectiveScope,
  isConeValid,
  getConeStats,
} from "../../src/oracle/cone.js";
import { DEFAULT_POLICY, mergePolicy } from "../../src/oracle/policy.js";
import type { VerificationPolicy, VerificationScopeHint } from "../../src/output/types.js";
import type ts from "typescript";

describe("ConeCache", () => {
  let cache: ConeCache;

  beforeEach(() => {
    cache = new ConeCache();
  });

  describe("getConeSignature", () => {
    it("generates consistent signature for same files", () => {
      const files1 = new Set(["/a.ts", "/b.ts"]);
      const files2 = new Set(["/b.ts", "/a.ts"]); // Different order

      const sig1 = cache.getConeSignature(files1, false);
      const sig2 = cache.getConeSignature(files2, false);

      expect(sig1).toBe(sig2);
    });

    it("generates different signatures for different files", () => {
      const files1 = new Set(["/a.ts"]);
      const files2 = new Set(["/b.ts"]);

      expect(cache.getConeSignature(files1, false)).not.toBe(
        cache.getConeSignature(files2, false)
      );
    });

    it("includes iteration in signature when requested", () => {
      const files = new Set(["/a.ts"]);

      const sigWithoutIter = cache.getConeSignature(files, false);
      const sigWithIter = cache.getConeSignature(files, true);

      expect(sigWithIter).toContain("0:"); // Iteration 0
      expect(sigWithoutIter).not.toContain("0:");
    });

    it("changes signature after nextIteration", () => {
      const files = new Set(["/a.ts"]);

      const sig1 = cache.getConeSignature(files, true);
      cache.nextIteration();
      const sig2 = cache.getConeSignature(files, true);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe("get/set", () => {
    it("caches and retrieves diagnostics", () => {
      const files = new Set(["/a.ts"]);
      const diagnostics = [{ code: 2345 }] as unknown as ts.Diagnostic[];

      cache.set(files, diagnostics, false);
      const retrieved = cache.get(files, false);

      expect(retrieved).toBe(diagnostics);
    });

    it("returns undefined for uncached cone", () => {
      const files = new Set(["/a.ts"]);
      expect(cache.get(files, false)).toBeUndefined();
    });

    it("separates caches by iteration flag", () => {
      const files = new Set(["/a.ts"]);
      const diag1 = [{ code: 1 }] as unknown as ts.Diagnostic[];
      const diag2 = [{ code: 2 }] as unknown as ts.Diagnostic[];

      cache.set(files, diag1, false);
      cache.set(files, diag2, true);

      expect(cache.get(files, false)).toBe(diag1);
      expect(cache.get(files, true)).toBe(diag2);
    });
  });

  describe("has", () => {
    it("returns true for cached cone", () => {
      const files = new Set(["/a.ts"]);
      cache.set(files, [], false);

      expect(cache.has(files, false)).toBe(true);
    });

    it("returns false for uncached cone", () => {
      const files = new Set(["/a.ts"]);
      expect(cache.has(files, false)).toBe(false);
    });
  });

  describe("nextIteration", () => {
    it("advances iteration counter", () => {
      expect(cache.getIteration()).toBe(0);
      cache.nextIteration();
      expect(cache.getIteration()).toBe(1);
      cache.nextIteration();
      expect(cache.getIteration()).toBe(2);
    });

    it("clears the cache", () => {
      const files = new Set(["/a.ts"]);
      cache.set(files, [], false);
      expect(cache.size()).toBe(1);

      cache.nextIteration();

      expect(cache.size()).toBe(0);
      expect(cache.get(files, false)).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("clears cache without advancing iteration", () => {
      const files = new Set(["/a.ts"]);
      cache.set(files, [], false);

      const iterBefore = cache.getIteration();
      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.getIteration()).toBe(iterBefore);
    });
  });

  describe("size", () => {
    it("returns number of cached entries", () => {
      expect(cache.size()).toBe(0);

      cache.set(new Set(["/a.ts"]), [], false);
      expect(cache.size()).toBe(1);

      cache.set(new Set(["/b.ts"]), [], false);
      expect(cache.size()).toBe(2);
    });
  });
});

describe("buildCone", () => {
  const modifiedFiles = new Set(["/modified.ts"]);
  const filesWithErrors = new Set(["/error1.ts", "/error2.ts", "/error3.ts"]);

  describe("with modified scope", () => {
    it("returns only modified files when includeErrors is false", () => {
      const policy = mergePolicy({
        coneExpansion: { includeErrors: false },
      });

      const cone = buildCone(modifiedFiles, filesWithErrors, "modified", policy);

      expect(cone.size).toBe(1);
      expect(cone.has("/modified.ts")).toBe(true);
    });

    it("includes error files when includeErrors is true", () => {
      const policy = mergePolicy({
        coneExpansion: { includeErrors: true },
      });

      const cone = buildCone(modifiedFiles, filesWithErrors, "modified", policy);

      expect(cone.size).toBe(4); // 1 modified + 3 error files
      expect(cone.has("/modified.ts")).toBe(true);
      expect(cone.has("/error1.ts")).toBe(true);
    });
  });

  describe("with errors scope", () => {
    it("includes error files", () => {
      const policy = mergePolicy();

      const cone = buildCone(modifiedFiles, filesWithErrors, "errors", policy);

      expect(cone.size).toBe(4);
      expect(cone.has("/modified.ts")).toBe(true);
      for (const f of filesWithErrors) {
        expect(cone.has(f)).toBe(true);
      }
    });
  });

  describe("with wide scope", () => {
    it("includes reverse deps when enabled", () => {
      const policy = mergePolicy({
        coneExpansion: {
          includeErrors: true,
          includeReverseDeps: true,
        },
      });

      const reverseDepsLookup = (_files: Set<string>) =>
        new Set(["/dep1.ts", "/dep2.ts"]);

      const cone = buildCone(
        modifiedFiles,
        filesWithErrors,
        "wide",
        policy,
        reverseDepsLookup
      );

      expect(cone.has("/dep1.ts")).toBe(true);
      expect(cone.has("/dep2.ts")).toBe(true);
    });

    it("works without reverseDepsLookup", () => {
      const policy = mergePolicy({
        coneExpansion: {
          includeErrors: true,
          includeReverseDeps: true,
        },
      });

      const cone = buildCone(modifiedFiles, filesWithErrors, "wide", policy);

      // Should still include modified and error files
      expect(cone.has("/modified.ts")).toBe(true);
      for (const f of filesWithErrors) {
        expect(cone.has(f)).toBe(true);
      }
    });
  });

  describe("cone size capping", () => {
    it("caps cone to maxConeFiles", () => {
      const manyErrors = new Set<string>();
      for (let i = 0; i < 100; i++) {
        manyErrors.add(`/error${i}.ts`);
      }

      const policy = mergePolicy({
        maxConeFiles: 10,
        coneExpansion: {
          includeErrors: true,
          topKErrorFiles: 5,
        },
      });

      const cone = buildCone(modifiedFiles, manyErrors, "errors", policy);

      expect(cone.size).toBeLessThanOrEqual(10);
      // Modified files should always be included
      expect(cone.has("/modified.ts")).toBe(true);
    });

    it("prioritizes modified files over error files", () => {
      const manyModified = new Set<string>();
      for (let i = 0; i < 10; i++) {
        manyModified.add(`/mod${i}.ts`);
      }

      const policy = mergePolicy({
        maxConeFiles: 5,
        coneExpansion: { includeErrors: true, topKErrorFiles: 3 },
      });

      const cone = buildCone(manyModified, filesWithErrors, "errors", policy);

      // All modified files should be included even if cone is capped
      for (const f of manyModified) {
        expect(cone.has(f)).toBe(true);
      }
    });
  });
});

describe("getEffectiveScope", () => {
  it("returns candidate scope when specified", () => {
    const policy = mergePolicy({ defaultScope: "modified" });

    expect(getEffectiveScope("errors", policy)).toBe("errors");
    expect(getEffectiveScope("wide", policy)).toBe("wide");
  });

  it("falls back to policy default when not specified", () => {
    const policy = mergePolicy({ defaultScope: "errors" });

    expect(getEffectiveScope(undefined, policy)).toBe("errors");
  });
});

describe("isConeValid", () => {
  it("returns true for valid cone", () => {
    const policy = mergePolicy({ maxConeFiles: 50 });
    const cone = new Set(["/a.ts", "/b.ts"]);

    expect(isConeValid(cone, policy)).toBe(true);
  });

  it("returns false for empty cone", () => {
    const policy = mergePolicy();
    const cone = new Set<string>();

    expect(isConeValid(cone, policy)).toBe(false);
  });

  it("returns false for oversized cone", () => {
    const policy = mergePolicy({ maxConeFiles: 2 });
    const cone = new Set(["/a.ts", "/b.ts", "/c.ts"]);

    expect(isConeValid(cone, policy)).toBe(false);
  });
});

describe("getConeStats", () => {
  it("categorizes files correctly", () => {
    const modifiedFiles = new Set(["/mod1.ts", "/mod2.ts"]);
    const filesWithErrors = new Set(["/err1.ts", "/err2.ts", "/mod1.ts"]);
    const cone = new Set(["/mod1.ts", "/mod2.ts", "/err1.ts", "/err2.ts", "/other.ts"]);

    const stats = getConeStats(cone, modifiedFiles, filesWithErrors);

    expect(stats.total).toBe(5);
    expect(stats.modified).toBe(2);
    expect(stats.errors).toBe(2); // err1 and err2 (mod1 is counted as modified)
    expect(stats.other).toBe(1);
  });

  it("handles empty cone", () => {
    const stats = getConeStats(new Set(), new Set(), new Set());

    expect(stats.total).toBe(0);
    expect(stats.modified).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.other).toBe(0);
  });

  it("handles overlapping modified and error files", () => {
    const modifiedFiles = new Set(["/both.ts"]);
    const filesWithErrors = new Set(["/both.ts"]);
    const cone = new Set(["/both.ts"]);

    const stats = getConeStats(cone, modifiedFiles, filesWithErrors);

    // File in both should count as modified (prioritized)
    expect(stats.total).toBe(1);
    expect(stats.modified).toBe(1);
    expect(stats.errors).toBe(0);
  });
});
