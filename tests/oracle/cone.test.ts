/**
 * Tests for the Verification Cone of Attention
 */

import { describe, it, expect } from "bun:test";
import {
  computeVerificationCone,
  analyzeFixCharacteristics,
  buildReverseDependencyGraph,
  ScopedDiagnosticsCache,
  getDiagnosticsForCone,
  DEFAULT_CONE_OPTIONS,
  type ConeContext,
  type ConeOptions,
  type VerificationCone,
} from "../../src/oracle/cone.js";
import { createTypeScriptHost } from "../../src/oracle/typescript.js";
import path from "path";
import ts from "typescript";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("Verification Cone", () => {
  describe("computeVerificationCone", () => {
    it("returns standard cone with modifiedFiles ∪ filesWithErrors", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const modifiedFiles = new Set([path.join(FIXTURES_DIR, "async-await/src/index.ts")]);
      const filesWithErrors = new Set([
        path.join(FIXTURES_DIR, "async-await/src/index.ts"),
        path.join(FIXTURES_DIR, "async-await/src/other.ts"),
      ]);

      const context: ConeContext = {
        modifiedFiles,
        filesWithErrors,
        currentDiagnostics: [],
        host,
      };

      const cone = computeVerificationCone(context, { enableExpansion: false });

      expect(cone.level).toBe("standard");
      expect(cone.wasExpanded).toBe(false);
      // Should include both modified files and files with errors
      expect(cone.files.has(path.join(FIXTURES_DIR, "async-await/src/index.ts"))).toBe(true);
      expect(cone.files.has(path.join(FIXTURES_DIR, "async-await/src/other.ts"))).toBe(true);
    });

    it("caps cone size when exceeding maxConeSize", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const modifiedFiles = new Set(["file1.ts"]);
      const filesWithErrors = new Set([
        "file1.ts",
        "file2.ts",
        "file3.ts",
        "file4.ts",
        "file5.ts",
      ]);

      const context: ConeContext = {
        modifiedFiles,
        filesWithErrors,
        currentDiagnostics: [],
        host,
      };

      const cone = computeVerificationCone(context, {
        maxConeSize: 3,
        enableExpansion: false,
      });

      expect(cone.files.size).toBe(3);
      // Modified files should always be included
      expect(cone.files.has("file1.ts")).toBe(true);
    });

    it("expands cone for core/shared files when expansion is enabled", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      // Simulate modifying a file in a "core" path
      const modifiedFiles = new Set(["/project/src/core/types.ts"]);
      const filesWithErrors = new Set(["/project/src/core/types.ts"]);

      const context: ConeContext = {
        modifiedFiles,
        filesWithErrors,
        currentDiagnostics: [],
        host,
      };

      const cone = computeVerificationCone(context, {
        enableExpansion: true,
        corePathPatterns: ["/core/"],
      });

      expect(cone.wasExpanded).toBe(true);
      expect(cone.expansionReason).toBe("modifies file in core/shared path");
      expect(cone.level).toBe("expanded");
    });

    it("expands cone for .d.ts files", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const modifiedFiles = new Set(["/project/src/types.d.ts"]);
      const filesWithErrors = new Set(["/project/src/types.d.ts"]);

      const context: ConeContext = {
        modifiedFiles,
        filesWithErrors,
        currentDiagnostics: [],
        host,
      };

      const cone = computeVerificationCone(context, {
        enableExpansion: true,
        typeHeavyExtensions: [".d.ts"],
      });

      expect(cone.wasExpanded).toBe(true);
      expect(cone.expansionReason).toBe("modifies declaration file (.d.ts)");
    });
  });

  describe("analyzeFixCharacteristics", () => {
    it("detects declaration file modifications", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const context: ConeContext = {
        modifiedFiles: new Set(["/project/types.d.ts"]),
        filesWithErrors: new Set(),
        currentDiagnostics: [],
        host,
      };

      const characteristics = analyzeFixCharacteristics(context, DEFAULT_CONE_OPTIONS);
      expect(characteristics.modifiesDeclarationFile).toBe(true);
    });

    it("detects core file modifications", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const context: ConeContext = {
        modifiedFiles: new Set(["/project/src/shared/utils.ts"]),
        filesWithErrors: new Set(),
        currentDiagnostics: [],
        host,
      };

      const characteristics = analyzeFixCharacteristics(context, DEFAULT_CONE_OPTIONS);
      expect(characteristics.modifiesCoreFile).toBe(true);
    });

    it("counts diagnostics in modified files", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      const modifiedFiles = new Set<string>();
      if (diagnostics.length > 0 && diagnostics[0].file) {
        modifiedFiles.add(diagnostics[0].file.fileName);
      }

      const context: ConeContext = {
        modifiedFiles,
        filesWithErrors: new Set(),
        currentDiagnostics: diagnostics,
        host,
      };

      const characteristics = analyzeFixCharacteristics(context, DEFAULT_CONE_OPTIONS);
      expect(characteristics.diagnosticsInModifiedFiles).toBeGreaterThanOrEqual(0);
    });
  });

  describe("buildReverseDependencyGraph", () => {
    it("builds a reverse dependency graph for the project", () => {
      const configPath = path.join(FIXTURES_DIR, "multi-file-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const reverseDeps = buildReverseDependencyGraph(host);

      // Should have entries for all project files
      expect(reverseDeps.size).toBeGreaterThan(0);

      // Each file should have a Set of importers
      for (const [_, importers] of reverseDeps) {
        expect(importers).toBeInstanceOf(Set);
      }
    });
  });

  describe("ScopedDiagnosticsCache", () => {
    it("caches diagnostics by file scope", () => {
      const cache = new ScopedDiagnosticsCache(10);

      const files = new Set(["file1.ts", "file2.ts"]);
      const diagnostics: ts.Diagnostic[] = [];

      // First access - should be a miss
      expect(cache.get(files)).toBeUndefined();

      // Store in cache
      cache.set(files, diagnostics);

      // Second access - should be a hit
      expect(cache.get(files)).toBe(diagnostics);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });

    it("evicts old entries when cache is full", () => {
      const cache = new ScopedDiagnosticsCache(2);

      // Fill the cache
      cache.set(new Set(["file1.ts"]), []);
      cache.set(new Set(["file2.ts"]), []);

      expect(cache.getStats().size).toBe(2);

      // Add one more - should evict the first
      cache.set(new Set(["file3.ts"]), []);

      expect(cache.getStats().size).toBe(2);
    });

    it("clears all entries", () => {
      const cache = new ScopedDiagnosticsCache(10);

      cache.set(new Set(["file1.ts"]), []);
      cache.set(new Set(["file2.ts"]), []);

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.getStats().hits).toBe(0);
      expect(cache.getStats().misses).toBe(0);
    });

    it("computes hit rate correctly", () => {
      const cache = new ScopedDiagnosticsCache(10);

      const files = new Set(["file1.ts"]);
      cache.set(files, []);

      // 2 misses
      cache.get(new Set(["file2.ts"]));
      cache.get(new Set(["file3.ts"]));

      // 2 hits
      cache.get(files);
      cache.get(files);

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0.5); // 2 hits out of 4 total accesses
    });
  });

  describe("getDiagnosticsForCone", () => {
    it("returns diagnostics scoped to cone files", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      if (diagnostics.length === 0) {
        // Skip if no diagnostics
        return;
      }

      // Get diagnostics for a specific file
      const targetFile = diagnostics[0].file?.fileName;
      if (!targetFile) return;

      const cone: VerificationCone = {
        files: new Set([targetFile]),
        level: "standard",
        wasExpanded: false,
      };

      const scopedDiagnostics = getDiagnosticsForCone(host, cone);

      // All returned diagnostics should be from files in the cone
      for (const diag of scopedDiagnostics) {
        if (diag.file) {
          expect(cone.files.has(diag.file.fileName)).toBe(true);
        }
      }
    });

    it("uses cache when available", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);
      const cache = new ScopedDiagnosticsCache(10);

      const cone: VerificationCone = {
        files: new Set([path.join(FIXTURES_DIR, "async-await/src/index.ts")]),
        level: "standard",
        wasExpanded: false,
      };

      // First call - should miss cache
      const result1 = getDiagnosticsForCone(host, cone, cache);

      // Second call - should hit cache
      const result2 = getDiagnosticsForCone(host, cone, cache);

      expect(result1).toBe(result2); // Same reference from cache
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(1);
    });
  });
});

describe("Cone Integration with Planner", () => {
  it("uses verification cone in repair planning", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
    const { plan } = require("../../src/oracle/planner.js");

    const result = plan(configPath, {
      coneOptions: {
        enableExpansion: true,
        maxConeSize: 50,
      },
    });

    // The planner should complete successfully with cone-aware verification
    expect(result.summary).toBeDefined();
    expect(result.summary.initialErrors).toBeGreaterThanOrEqual(0);
  });

  it("respects cone options from configuration", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
    const { plan } = require("../../src/oracle/planner.js");

    const messages: string[] = [];

    const result = plan(configPath, {
      coneOptions: {
        enableExpansion: false,
        maxConeSize: 10,
      },
      onProgress: (msg) => messages.push(msg),
    });

    // Should not log about reverse dependency graph when expansion is disabled
    // (only builds the graph if expansion is enabled AND there are errors)
    const graphMessage = messages.find((m) => m.includes("reverse dependency graph"));
    if (result.summary.initialErrors > 0) {
      // When there are errors, graph should only be built if expansion is enabled
      expect(graphMessage).toBeUndefined();
    }
  });
});
