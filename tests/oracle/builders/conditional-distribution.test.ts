/**
 * ConditionalTypeDistributionBuilder Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import {
  BuilderRegistry,
  createBuilderContext,
  defaultRegistry,
} from "../../../src/oracle/builder.js";
import { createTypeScriptHost } from "../../../src/oracle/typescript.js";
import { ConditionalTypeDistributionBuilder } from "../../../src/oracle/builders/conditional-distribution.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");

describe("ConditionalTypeDistributionBuilder", () => {
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
      expect(ConditionalTypeDistributionBuilder.name).toBe(
        "ConditionalTypeDistributionBuilder"
      );
    });

    it("has correct description", () => {
      expect(ConditionalTypeDistributionBuilder.description).toBe(
        "Repairs distributive conditional type errors by tuple-wrapping"
      );
    });

    it("targets TS2322, TS2345, TS2536", () => {
      expect(ConditionalTypeDistributionBuilder.diagnosticCodes).toContain(2322);
      expect(ConditionalTypeDistributionBuilder.diagnosticCodes).toContain(2345);
      expect(ConditionalTypeDistributionBuilder.diagnosticCodes).toContain(2536);
    });
  });

  describe("matches()", () => {
    it("matches TS2322 errors with conditional types", () => {
      registry.register(ConditionalTypeDistributionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);

      expect(ConditionalTypeDistributionBuilder.matches(ctx)).toBe(true);
    });

    it("does not match errors without conditional types", () => {
      // Use a fixture that has errors but no conditional types
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "type-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      for (const diag of diagnostics) {
        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);
        // Should not match because no conditional types in type-mismatch fixture
        expect(ConditionalTypeDistributionBuilder.matches(ctx)).toBe(false);
      }
    });

    it("does not match non-target error codes", () => {
      // Use module-extension fixture which has TS2835
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      if (ts2835) {
        const ctx = createBuilderContext(ts2835, host, new Set(), diagnostics);
        expect(ConditionalTypeDistributionBuilder.matches(ctx)).toBe(false);
      }
    });
  });

  describe("generate()", () => {
    it("generates candidates for conditional type distribution errors", () => {
      registry.register(ConditionalTypeDistributionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);

      const candidates = ConditionalTypeDistributionBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].kind).toBe("synthetic");
      expect(candidates[0].scopeHint).toBe("wide");
      expect(candidates[0].riskHint).toBe("high");
    });

    it("generates FileChanges with correct structure", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);

      const candidates = ConditionalTypeDistributionBuilder.generate(ctx);

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

    it("generates tuple-wrapped replacement text", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);

      const candidates = ConditionalTypeDistributionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        // Should have changes that wrap in tuples
        const hasWrapper = candidate.changes.some(
          (c) => c.newText.startsWith("[") && c.newText.endsWith("]")
        );
        expect(hasWrapper).toBe(true);
      }
    });

    it("includes correct metadata", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);

      const candidates = ConditionalTypeDistributionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        expect(candidate.metadata).toBeDefined();
        expect(candidate.metadata?.typeAliasName).toBeDefined();
      }
    });

    it("includes correct tags", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);

      const candidates = ConditionalTypeDistributionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.tags).toContain("conditional-type");
      expect(candidate.tags).toContain("distribution");
      expect(candidate.tags).toContain("structural");
    });

    it("targets the correct file for the fix", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);

      const candidates = ConditionalTypeDistributionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        // The fix should target types.ts where the conditional type is defined
        expect(candidate.changes[0].file).toContain("types.ts");
      }
    });
  });

  describe("integration with BuilderRegistry", () => {
    it("is routed correctly by diagnostic code", () => {
      registry.register(ConditionalTypeDistributionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const candidates = registry.getCandidateBuilders(ts2322!);
      expect(candidates).toContain(ConditionalTypeDistributionBuilder);
    });

    it("generates candidates via registry", () => {
      registry.register(ConditionalTypeDistributionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "conditional-distribution/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2322 = diagnostics.find((d) => d.code === 2322);
      expect(ts2322).toBeDefined();

      const ctx = createBuilderContext(ts2322!, host, new Set(), diagnostics);
      const candidates = registry.generateCandidates(ctx);

      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when no conditional types found", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      // Create a mock TS2322 diagnostic
      const mockDiagnostic = {
        category: 1,
        code: 2322,
        file: undefined,
        start: undefined,
        length: 10,
        messageText: "Type mismatch",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      const candidates = ConditionalTypeDistributionBuilder.generate(ctx);
      expect(candidates).toHaveLength(0);
    });
  });
});
