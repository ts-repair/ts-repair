/**
 * OverloadRepairBuilder Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import {
  BuilderRegistry,
  createBuilderContext,
  defaultRegistry,
} from "../../../src/oracle/builder.js";
import { createTypeScriptHost } from "../../../src/oracle/typescript.js";
import { OverloadRepairBuilder } from "../../../src/oracle/builders/overload.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");

describe("OverloadRepairBuilder", () => {
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
      expect(OverloadRepairBuilder.name).toBe("OverloadRepairBuilder");
    });

    it("has correct description", () => {
      expect(OverloadRepairBuilder.description).toBe(
        "Repairs overload signature mismatches"
      );
    });

    it("targets TS2769", () => {
      expect(OverloadRepairBuilder.diagnosticCodes).toContain(2769);
    });
  });

  describe("matches()", () => {
    it("matches TS2769 errors", () => {
      registry.register(OverloadRepairBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      expect(OverloadRepairBuilder.matches(ctx)).toBe(true);
    });

    it("does not match other error codes", () => {
      // Use a fixture with a different error type
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "type-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      for (const diag of diagnostics) {
        if (diag.code === 2769) continue;

        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);

        expect(OverloadRepairBuilder.matches(ctx)).toBe(false);
      }
    });
  });

  describe("generate()", () => {
    it("generates candidates for overload mismatch", () => {
      registry.register(OverloadRepairBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      const candidates = OverloadRepairBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].kind).toBe("synthetic");
      expect(candidates[0].scopeHint).toBe("wide");
      expect(candidates[0].riskHint).toBe("high");
    });

    it("generates FileChanges with correct structure", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      const candidates = OverloadRepairBuilder.generate(ctx);

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

    it("generates overload with compatible parameter signature", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      const candidates = OverloadRepairBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        // The overload should use the implementation's parameter signature
        // (data: unknown[]) for compatibility
        const newText = candidate.changes[0].newText;
        expect(newText).toContain("data");
        expect(newText).toContain("unknown[]");
      }
    });

    it("includes metadata about the function", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      const candidates = OverloadRepairBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        expect(candidate.metadata).toBeDefined();
        expect(candidate.metadata?.funcName).toBe("process");
        expect(candidate.metadata?.argCount).toBe(1);
      }
    });

    it("includes correct tags", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      const candidates = OverloadRepairBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.tags).toContain("overload");
      expect(candidate.tags).toContain("structural");
    });

    it("targets the correct file for the fix", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      const candidates = OverloadRepairBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        // The fix should target api.ts where the function is declared
        expect(candidate.changes[0].file).toContain("api.ts");
      }
    });
  });

  describe("integration with BuilderRegistry", () => {
    it("is routed correctly by diagnostic code", () => {
      registry.register(OverloadRepairBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const candidates = registry.getCandidateBuilders(ts2769!);
      expect(candidates).toContain(OverloadRepairBuilder);
    });

    it("generates candidates via registry", () => {
      registry.register(OverloadRepairBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2769 = diagnostics.find((d) => d.code === 2769);
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);
      const candidates = registry.generateCandidates(ctx);

      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when node cannot be found", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      // Create a mock diagnostic without a valid position
      const mockDiagnostic = {
        category: 1,
        code: 2769,
        file: undefined,
        start: undefined,
        length: 10,
        messageText: "No overload matches this call",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      const candidates = OverloadRepairBuilder.generate(ctx);
      expect(candidates).toHaveLength(0);
    });

    it("returns false for matches() when not a call expression", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "type-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Use a type mismatch diagnostic (not a call expression)
      const typeMismatch = diagnostics.find((d) => d.code !== 2769);
      if (typeMismatch) {
        const ctx = createBuilderContext(
          typeMismatch,
          host,
          new Set(),
          diagnostics
        );
        expect(OverloadRepairBuilder.matches(ctx)).toBe(false);
      }
    });
  });
});
