/**
 * InstantiationDepthBuilder Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import {
  BuilderRegistry,
  createBuilderContext,
  defaultRegistry,
} from "../../../src/oracle/builder.js";
import { createTypeScriptHost } from "../../../src/oracle/typescript.js";
import { InstantiationDepthBuilder } from "../../../src/oracle/builders/instantiation-depth.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");

describe("InstantiationDepthBuilder", () => {
  let registry: BuilderRegistry;

  beforeEach(() => {
    registry = new BuilderRegistry();
    defaultRegistry.clear();
  });

  afterEach(() => {
    defaultRegistry.clear();
  });

  describe("metadata", () => {
    it("has correct name", () => {
      expect(InstantiationDepthBuilder.name).toBe("InstantiationDepthBuilder");
    });

    it("has correct description", () => {
      expect(InstantiationDepthBuilder.description).toBe(
        "Repairs excessive type instantiation depth errors (TS2589)"
      );
    });

    it("targets TS2589", () => {
      expect(InstantiationDepthBuilder.diagnosticCodes).toContain(2589);
    });
  });

  describe("matches()", () => {
    it("matches TS2589 errors", () => {
      registry.register(InstantiationDepthBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      expect(InstantiationDepthBuilder.matches(ctx)).toBe(true);
    });

    it("does not match other error codes", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "type-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      for (const diag of diagnostics) {
        if (diag.code === 2589) continue;

        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);

        expect(InstantiationDepthBuilder.matches(ctx)).toBe(false);
      }
    });

    it("returns false when no recursive type alias is found", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      // Create a mock TS2589 diagnostic at a position with no recursive type
      const mockDiagnostic = {
        category: 1,
        code: 2589,
        file: undefined,
        start: undefined,
        length: 10,
        messageText: "Type instantiation is excessively deep and possibly infinite.",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      expect(InstantiationDepthBuilder.matches(ctx)).toBe(false);
    });
  });

  describe("generate()", () => {
    it("generates candidates for instantiation depth errors", () => {
      registry.register(InstantiationDepthBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].kind).toBe("synthetic");
    });

    it("generates candidates with scopeHint: wide", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      expect(candidates[0].scopeHint).toBe("wide");
    });

    it("generates candidates with riskHint: high", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      expect(candidates[0].riskHint).toBe("high");
    });

    it("generates FileChanges with correct structure", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);

      for (const candidate of candidates) {
        if (candidate.kind !== "synthetic") continue;

        expect(candidate.changes.length).toBeGreaterThan(0);
        for (const change of candidate.changes) {
          expect(change.file).toBeDefined();
          expect(typeof change.start).toBe("number");
          expect(typeof change.end).toBe("number");
          expect(typeof change.newText).toBe("string");
        }
      }
    });

    it("generates change with intersection reset pattern", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        // The fix should add `& {}` intersection
        const hasIntersectionReset = candidate.changes.some((change) =>
          change.newText.includes("& {}")
        );
        expect(hasIntersectionReset).toBe(true);
      }
    });

    it("includes metadata about the recursive type", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        expect(candidate.metadata).toBeDefined();
        expect(candidate.metadata?.typeName).toBeDefined();
        expect(candidate.metadata?.pattern).toBe("intersection-reset");
      }
    });

    it("includes correct tags", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.tags).toContain("recursive-type");
      expect(candidate.tags).toContain("instantiation-depth");
      expect(candidate.tags).toContain("intersection-reset");
    });

    it("targets the type definition file, not the usage file", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        // The fix should target types.ts where the recursive type is defined
        expect(candidate.changes[0].file).toContain("types.ts");
      }
    });

    it("limits candidates to 4 or fewer", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates.length).toBeLessThanOrEqual(4);
    });
  });

  describe("integration with BuilderRegistry", () => {
    it("is routed correctly by diagnostic code", () => {
      registry.register(InstantiationDepthBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const candidates = registry.getCandidateBuilders(ts2589!);
      expect(candidates).toContain(InstantiationDepthBuilder);
    });

    it("generates candidates via registry", () => {
      registry.register(InstantiationDepthBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);
      const candidates = registry.generateCandidates(ctx);

      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when node cannot be found", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      const mockDiagnostic = {
        category: 1,
        code: 2589,
        file: undefined,
        start: undefined,
        length: 10,
        messageText: "Type instantiation is excessively deep and possibly infinite.",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      const candidates = InstantiationDepthBuilder.generate(ctx);
      expect(candidates).toHaveLength(0);
    });
  });

  describe("indirect detection (tiered strategy)", () => {
    it("detects recursive types when error is at call site", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth-indirect/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find a TS2589 error in consumer.ts (not types.ts)
      const consumerError = diagnostics.find(
        (d) => d.code === 2589 && d.file?.fileName.includes("consumer.ts")
      );
      expect(consumerError).toBeDefined();

      const ctx = createBuilderContext(consumerError!, host, new Set(), diagnostics);

      // Should still match even though error is in consumer.ts
      expect(InstantiationDepthBuilder.matches(ctx)).toBe(true);
    });

    it("generates fix targeting types.ts when error is in consumer.ts", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth-indirect/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find a TS2589 error in consumer.ts
      const consumerError = diagnostics.find(
        (d) => d.code === 2589 && d.file?.fileName.includes("consumer.ts")
      );
      expect(consumerError).toBeDefined();

      const ctx = createBuilderContext(consumerError!, host, new Set(), diagnostics);
      const candidates = InstantiationDepthBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);

      // At least one fix should target types.ts where Deep<T> is defined
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        expect(candidate.changes[0].file).toContain("types.ts");
      }
    });

    it("uses enclosing type context to find recursive types", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth-indirect/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // All TS2589 errors should be matchable
      const ts2589Errors = diagnostics.filter((d) => d.code === 2589);
      expect(ts2589Errors.length).toBeGreaterThan(0);

      for (const error of ts2589Errors) {
        const ctx = createBuilderContext(error, host, new Set(), diagnostics);
        const matched = InstantiationDepthBuilder.matches(ctx);
        expect(matched).toBe(true);
      }
    });

    it("finds recursive type through function return type analysis", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth-indirect/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);
      const candidates = InstantiationDepthBuilder.generate(ctx);

      // Should find a recursive type (UnwrapPromise or DeepFlatten) and generate fix
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        // The type should be one of the recursive types from types.ts
        expect(["UnwrapPromise", "DeepFlatten"]).toContain(candidate.metadata?.typeName);
      }
    });

    it("correlates multiple TS2589 diagnostics to find recursive types", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth-indirect/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Multiple TS2589 errors should all point to recursive types
      const ts2589Errors = diagnostics.filter((d) => d.code === 2589);
      expect(ts2589Errors.length).toBeGreaterThan(1);

      const typeNames = new Set<string>();

      for (const error of ts2589Errors) {
        const ctx = createBuilderContext(error, host, new Set(), diagnostics);
        const candidates = InstantiationDepthBuilder.generate(ctx);

        for (const candidate of candidates) {
          if (candidate.kind === "synthetic" && candidate.metadata?.typeName) {
            typeNames.add(candidate.metadata.typeName as string);
          }
        }
      }

      // Errors should be related to the recursive types UnwrapPromise and/or DeepFlatten
      const hasRecursiveType = typeNames.has("UnwrapPromise") || typeNames.has("DeepFlatten");
      expect(hasRecursiveType).toBe(true);
    });

    it("limits results to MAX_CANDIDATES", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "instantiation-depth-indirect/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2589 = diagnostics.find((d) => d.code === 2589);
      expect(ts2589).toBeDefined();

      const ctx = createBuilderContext(ts2589!, host, new Set(), diagnostics);
      const candidates = InstantiationDepthBuilder.generate(ctx);

      // Should not exceed 4 candidates
      expect(candidates.length).toBeLessThanOrEqual(4);
    });
  });
});
