/**
 * Verification Module Unit Tests
 *
 * Tests for verification cone building, diagnostic caching, and policy handling.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import ts from "typescript";
import {
  buildCone,
  coneSignature,
  createDiagnosticCache,
  mergePolicy,
  diagnosticKey,
  diagnosticWeight,
  buildErrorCountByFile,
  buildFilesWithErrors,
  DEFAULT_VERIFICATION_POLICY,
  STRUCTURAL_VERIFICATION_POLICY,
  type VerificationPolicy,
  type ConeContext,
  type DiagnosticCache,
} from "../../src/oracle/verification.js";
import { createSyntheticCandidate, fromCodeFixAction } from "../../src/oracle/candidate.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockCodeFixAction(
  fixName: string,
  changes: { fileName: string; start: number; length: number; newText: string }[]
): import("typescript").CodeFixAction {
  return {
    fixName,
    description: fixName,
    changes: changes.map((c) => ({
      fileName: c.fileName,
      textChanges: [
        {
          span: { start: c.start, length: c.length },
          newText: c.newText,
        },
      ],
    })),
  } as import("typescript").CodeFixAction;
}

function createMockDiagnostic(
  fileName: string,
  code: number,
  message: string,
  category: ts.DiagnosticCategory = ts.DiagnosticCategory.Error
): ts.Diagnostic {
  return {
    file: { fileName } as ts.SourceFile,
    start: 0,
    length: 10,
    messageText: message,
    category,
    code,
  } as ts.Diagnostic;
}

// ============================================================================
// mergePolicy
// ============================================================================

describe("mergePolicy", () => {
  it("returns defaults when no partial provided", () => {
    const policy = mergePolicy();
    expect(policy).toEqual(DEFAULT_VERIFICATION_POLICY);
  });

  it("returns defaults when undefined provided", () => {
    const policy = mergePolicy(undefined);
    expect(policy).toEqual(DEFAULT_VERIFICATION_POLICY);
  });

  it("merges top-level properties", () => {
    const policy = mergePolicy({
      defaultScope: "errors",
      allowRegressions: true,
    });

    expect(policy.defaultScope).toBe("errors");
    expect(policy.allowRegressions).toBe(true);
    expect(policy.maxConeFiles).toBe(DEFAULT_VERIFICATION_POLICY.maxConeFiles);
  });

  it("merges nested coneExpansion properties", () => {
    const policy = mergePolicy({
      coneExpansion: {
        includeErrors: true,
        topKErrorFiles: 25,
      },
    });

    expect(policy.coneExpansion.includeErrors).toBe(true);
    expect(policy.coneExpansion.topKErrorFiles).toBe(25);
    expect(policy.coneExpansion.includeReverseDeps).toBe(
      DEFAULT_VERIFICATION_POLICY.coneExpansion.includeReverseDeps
    );
  });
});

// ============================================================================
// buildCone
// ============================================================================

describe("buildCone", () => {
  const baseContext: ConeContext = {
    filesWithErrors: new Set(["/a.ts", "/b.ts", "/c.ts"]),
    errorCountByFile: new Map([
      ["/a.ts", 5],
      ["/b.ts", 3],
      ["/c.ts", 1],
    ]),
    iteration: 1,
  };

  describe("modified scope", () => {
    it("includes only modified files", () => {
      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "modified" },
      ], { scopeHint: "modified" }); // explicit modified scope

      const cone = buildCone(candidate, baseContext, DEFAULT_VERIFICATION_POLICY);

      expect(cone.scope).toBe("modified");
      expect(cone.files.size).toBe(1);
      expect(cone.files.has("/x.ts")).toBe(true);
      expect(cone.capped).toBe(false);
    });

    it("includes multiple modified files", () => {
      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "a" },
        { file: "/y.ts", start: 0, end: 10, newText: "b" },
      ], { scopeHint: "modified" }); // explicit modified scope

      const cone = buildCone(candidate, baseContext, DEFAULT_VERIFICATION_POLICY);

      expect(cone.files.size).toBe(2);
      expect(cone.files.has("/x.ts")).toBe(true);
      expect(cone.files.has("/y.ts")).toBe(true);
    });
  });

  describe("errors scope", () => {
    it("includes modified files + files with errors when includeErrors is true", () => {
      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "modified" },
      ], { scopeHint: "errors" });

      const policy = mergePolicy({
        coneExpansion: { includeErrors: true },
      });

      const cone = buildCone(candidate, baseContext, policy);

      expect(cone.scope).toBe("errors");
      expect(cone.files.has("/x.ts")).toBe(true); // modified
      expect(cone.files.has("/a.ts")).toBe(true); // error file
      expect(cone.files.has("/b.ts")).toBe(true); // error file
      expect(cone.files.has("/c.ts")).toBe(true); // error file
    });

    it("respects topKErrorFiles limit", () => {
      const context: ConeContext = {
        filesWithErrors: new Set(["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/e.ts"]),
        errorCountByFile: new Map([
          ["/a.ts", 10],
          ["/b.ts", 8],
          ["/c.ts", 6],
          ["/d.ts", 4],
          ["/e.ts", 2],
        ]),
        iteration: 1,
      };

      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "modified" },
      ], { scopeHint: "errors" });

      const policy = mergePolicy({
        coneExpansion: { includeErrors: true, topKErrorFiles: 2 },
      });

      const cone = buildCone(candidate, context, policy);

      // Should include modified + top 2 error files
      expect(cone.files.has("/x.ts")).toBe(true); // modified
      expect(cone.files.has("/a.ts")).toBe(true); // highest errors
      expect(cone.files.has("/b.ts")).toBe(true); // second highest
      expect(cone.files.has("/c.ts")).toBe(false); // not in top 2
    });
  });

  describe("wide scope", () => {
    it("includes reverse deps when available and enabled", () => {
      const context: ConeContext = {
        filesWithErrors: new Set(["/a.ts"]),
        reverseDeps: new Map([
          ["/x.ts", new Set(["/dep1.ts", "/dep2.ts"])],
        ]),
        iteration: 1,
      };

      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "modified" },
      ], { scopeHint: "wide" });

      const policy = mergePolicy({
        coneExpansion: {
          includeErrors: true,
          includeReverseDeps: true,
        },
      });

      const cone = buildCone(candidate, context, policy);

      expect(cone.scope).toBe("wide");
      expect(cone.files.has("/x.ts")).toBe(true); // modified
      expect(cone.files.has("/a.ts")).toBe(true); // error file
      expect(cone.files.has("/dep1.ts")).toBe(true); // reverse dep
      expect(cone.files.has("/dep2.ts")).toBe(true); // reverse dep
    });
  });

  describe("scope hint override", () => {
    it("candidate scopeHint overrides policy defaultScope", () => {
      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "modified" },
      ], { scopeHint: "errors" });

      const policy = mergePolicy({
        defaultScope: "modified",
        coneExpansion: { includeErrors: true },
      });

      const cone = buildCone(candidate, baseContext, policy);

      expect(cone.scope).toBe("errors");
      expect(cone.files.size).toBeGreaterThan(1);
    });

    it("uses policy defaultScope when candidate has modified hint", () => {
      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "modified" },
      ], { scopeHint: "modified" });

      const policy = mergePolicy({
        defaultScope: "errors",
        coneExpansion: { includeErrors: true },
      });

      const cone = buildCone(candidate, baseContext, policy);

      // modified hint should still result in errors scope due to policy default
      expect(cone.scope).toBe("errors");
    });
  });

  describe("cone size capping", () => {
    it("caps cone size and prioritizes modified files", () => {
      const context: ConeContext = {
        filesWithErrors: new Set(["/a.ts", "/b.ts", "/c.ts", "/d.ts"]),
        errorCountByFile: new Map([
          ["/a.ts", 10],
          ["/b.ts", 8],
          ["/c.ts", 6],
          ["/d.ts", 4],
        ]),
        iteration: 1,
      };

      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "a" },
        { file: "/y.ts", start: 0, end: 10, newText: "b" },
      ], { scopeHint: "errors" });

      const policy = mergePolicy({
        maxConeFiles: 3,
        coneExpansion: { includeErrors: true },
      });

      const cone = buildCone(candidate, context, policy);

      expect(cone.capped).toBe(true);
      expect(cone.files.size).toBe(3);
      // Modified files must be included
      expect(cone.files.has("/x.ts")).toBe(true);
      expect(cone.files.has("/y.ts")).toBe(true);
      // Only highest error count file fits
      expect(cone.files.has("/a.ts")).toBe(true);
    });
  });

  describe("signature computation", () => {
    it("produces deterministic signature for same files", () => {
      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/b.ts", start: 0, end: 10, newText: "b" },
        { file: "/a.ts", start: 0, end: 10, newText: "a" },
      ]);

      const cone1 = buildCone(candidate, baseContext, DEFAULT_VERIFICATION_POLICY);
      const cone2 = buildCone(candidate, baseContext, DEFAULT_VERIFICATION_POLICY);

      expect(cone1.signature).toBe(cone2.signature);
    });

    it("includes iteration in signature when policy requires", () => {
      const context1 = { ...baseContext, iteration: 1 };
      const context2 = { ...baseContext, iteration: 2 };

      const candidate = createSyntheticCandidate("test", "test", [
        { file: "/x.ts", start: 0, end: 10, newText: "x" },
      ]);

      const cone1 = buildCone(candidate, context1, DEFAULT_VERIFICATION_POLICY);
      const cone2 = buildCone(candidate, context2, DEFAULT_VERIFICATION_POLICY);

      expect(cone1.signature).not.toBe(cone2.signature);
      expect(cone1.signature).toContain("1:");
      expect(cone2.signature).toContain("2:");
    });
  });
});

// ============================================================================
// coneSignature
// ============================================================================

describe("coneSignature", () => {
  it("produces deterministic signature from files", () => {
    const files1 = new Set(["/a.ts", "/b.ts"]);
    const files2 = new Set(["/b.ts", "/a.ts"]); // different order

    const sig1 = coneSignature(files1);
    const sig2 = coneSignature(files2);

    expect(sig1).toBe(sig2);
  });

  it("includes iteration when provided", () => {
    const files = new Set(["/a.ts"]);

    const sig1 = coneSignature(files, 1);
    const sig2 = coneSignature(files, 2);

    expect(sig1).not.toBe(sig2);
    expect(sig1).toContain("1:");
    expect(sig2).toContain("2:");
  });

  it("excludes iteration prefix when not provided", () => {
    const files = new Set(["/a.ts"]);
    const sig = coneSignature(files);

    expect(sig).not.toContain(":");
  });
});

// ============================================================================
// createDiagnosticCache
// ============================================================================

describe("createDiagnosticCache", () => {
  let cache: DiagnosticCache;

  beforeEach(() => {
    cache = createDiagnosticCache();
  });

  describe("get/set", () => {
    it("stores and retrieves diagnostics", () => {
      const diagnostics = [
        createMockDiagnostic("/a.ts", 2304, "Cannot find name 'foo'"),
      ];

      cache.set("sig1", diagnostics);
      const result = cache.get("sig1");

      expect(result).toBe(diagnostics);
    });

    it("returns undefined for missing signatures", () => {
      const result = cache.get("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("has", () => {
    it("returns true for cached signatures", () => {
      cache.set("sig1", []);
      expect(cache.has("sig1")).toBe(true);
    });

    it("returns false for missing signatures", () => {
      expect(cache.has("sig1")).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all cached entries", () => {
      cache.set("sig1", []);
      cache.set("sig2", []);

      cache.clear();

      expect(cache.has("sig1")).toBe(false);
      expect(cache.has("sig2")).toBe(false);
    });
  });

  describe("clearIteration", () => {
    it("removes entries for specific iteration", () => {
      cache.set("1:/a.ts", []);
      cache.set("1:/b.ts", []);
      cache.set("2:/a.ts", []);

      cache.clearIteration(1);

      expect(cache.has("1:/a.ts")).toBe(false);
      expect(cache.has("1:/b.ts")).toBe(false);
      expect(cache.has("2:/a.ts")).toBe(true);
    });
  });

  describe("stats", () => {
    it("tracks hits and misses", () => {
      cache.set("sig1", [createMockDiagnostic("/a.ts", 2304, "error")]);

      cache.get("sig1"); // hit
      cache.get("sig1"); // hit
      cache.get("sig2"); // miss

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it("tracks cache size", () => {
      cache.set("sig1", []);
      cache.set("sig2", []);
      cache.set("sig3", []);

      const stats = cache.stats();
      expect(stats.size).toBe(3);
    });

    it("counts total diagnostics cached", () => {
      cache.set("sig1", [
        createMockDiagnostic("/a.ts", 2304, "err1"),
        createMockDiagnostic("/a.ts", 2304, "err2"),
      ]);
      cache.set("sig2", [
        createMockDiagnostic("/b.ts", 2304, "err3"),
      ]);

      const stats = cache.stats();
      expect(stats.totalDiagnostics).toBe(3);
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entries when limit reached", () => {
      const smallCache = createDiagnosticCache(4);

      smallCache.set("sig1", []);
      smallCache.set("sig2", []);
      smallCache.set("sig3", []);
      smallCache.set("sig4", []);
      smallCache.set("sig5", []); // triggers eviction

      const stats = smallCache.stats();
      expect(stats.size).toBeLessThanOrEqual(4);
    });
  });
});

// ============================================================================
// diagnosticKey
// ============================================================================

describe("diagnosticKey", () => {
  it("creates unique key from file, code, and message", () => {
    const diag = createMockDiagnostic("/test.ts", 2304, "Cannot find name 'foo'");
    const key = diagnosticKey(diag);

    expect(key).toBe("/test.ts::2304::Cannot find name 'foo'");
  });

  it("handles diagnostics without file", () => {
    const diag: ts.Diagnostic = {
      start: 0,
      length: 10,
      messageText: "Some error",
      category: ts.DiagnosticCategory.Error,
      code: 1234,
    } as ts.Diagnostic;

    const key = diagnosticKey(diag);
    expect(key).toBe("<unknown>::1234::Some error");
  });
});

// ============================================================================
// diagnosticWeight
// ============================================================================

describe("diagnosticWeight", () => {
  it("returns 1 for errors", () => {
    const diag = createMockDiagnostic("/a.ts", 2304, "error", ts.DiagnosticCategory.Error);
    expect(diagnosticWeight(diag)).toBe(1);
  });

  it("returns 0.5 for warnings", () => {
    const diag = createMockDiagnostic("/a.ts", 2304, "warning", ts.DiagnosticCategory.Warning);
    expect(diagnosticWeight(diag)).toBe(0.5);
  });

  it("returns 0.25 for suggestions", () => {
    const diag = createMockDiagnostic("/a.ts", 2304, "suggestion", ts.DiagnosticCategory.Suggestion);
    expect(diagnosticWeight(diag)).toBe(0.25);
  });

  it("returns 0.1 for messages", () => {
    const diag = createMockDiagnostic("/a.ts", 2304, "message", ts.DiagnosticCategory.Message);
    expect(diagnosticWeight(diag)).toBe(0.1);
  });
});

// ============================================================================
// buildErrorCountByFile
// ============================================================================

describe("buildErrorCountByFile", () => {
  it("counts errors per file", () => {
    const diagnostics = [
      createMockDiagnostic("/a.ts", 2304, "err1"),
      createMockDiagnostic("/a.ts", 2304, "err2"),
      createMockDiagnostic("/b.ts", 2304, "err3"),
    ];

    const counts = buildErrorCountByFile(diagnostics);

    expect(counts.get("/a.ts")).toBe(2);
    expect(counts.get("/b.ts")).toBe(1);
  });

  it("handles diagnostics without file", () => {
    const diag: ts.Diagnostic = {
      messageText: "error",
      category: ts.DiagnosticCategory.Error,
      code: 2304,
    } as ts.Diagnostic;

    const counts = buildErrorCountByFile([diag]);

    expect(counts.size).toBe(0);
  });

  it("returns empty map for empty input", () => {
    const counts = buildErrorCountByFile([]);
    expect(counts.size).toBe(0);
  });
});

// ============================================================================
// buildFilesWithErrors
// ============================================================================

describe("buildFilesWithErrors", () => {
  it("collects unique files with errors", () => {
    const diagnostics = [
      createMockDiagnostic("/a.ts", 2304, "err1"),
      createMockDiagnostic("/a.ts", 2304, "err2"),
      createMockDiagnostic("/b.ts", 2304, "err3"),
    ];

    const files = buildFilesWithErrors(diagnostics);

    expect(files.size).toBe(2);
    expect(files.has("/a.ts")).toBe(true);
    expect(files.has("/b.ts")).toBe(true);
  });

  it("returns empty set for empty input", () => {
    const files = buildFilesWithErrors([]);
    expect(files.size).toBe(0);
  });
});

// ============================================================================
// Policy Presets
// ============================================================================

describe("Policy Presets", () => {
  describe("DEFAULT_VERIFICATION_POLICY", () => {
    it("has modified as default scope", () => {
      expect(DEFAULT_VERIFICATION_POLICY.defaultScope).toBe("modified");
    });

    it("does not include errors by default", () => {
      expect(DEFAULT_VERIFICATION_POLICY.coneExpansion.includeErrors).toBe(false);
    });

    it("enables caching", () => {
      expect(DEFAULT_VERIFICATION_POLICY.cacheBeforeDiagnostics).toBe(true);
    });
  });

  describe("STRUCTURAL_VERIFICATION_POLICY", () => {
    it("has errors as default scope", () => {
      expect(STRUCTURAL_VERIFICATION_POLICY.defaultScope).toBe("errors");
    });

    it("includes errors in cone", () => {
      expect(STRUCTURAL_VERIFICATION_POLICY.coneExpansion.includeErrors).toBe(true);
    });

    it("uses cone-based host invalidation", () => {
      expect(STRUCTURAL_VERIFICATION_POLICY.hostInvalidation).toBe("cone");
    });
  });
});
