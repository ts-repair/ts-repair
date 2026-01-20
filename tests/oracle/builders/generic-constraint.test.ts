/**
 * GenericConstraintBuilder Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import {
  BuilderRegistry,
  createBuilderContext,
  defaultRegistry,
} from "../../../src/oracle/builder.js";
import { createTypeScriptHost } from "../../../src/oracle/typescript.js";
import { GenericConstraintBuilder } from "../../../src/oracle/builders/generic-constraint.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");

describe("GenericConstraintBuilder", () => {
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
      expect(GenericConstraintBuilder.name).toBe("GenericConstraintBuilder");
    });

    it("has correct description", () => {
      expect(GenericConstraintBuilder.description).toBe(
        "Repairs generic constraint violations by adding missing members"
      );
    });

    it("targets TS2344", () => {
      expect(GenericConstraintBuilder.diagnosticCodes).toContain(2344);
    });
  });

  describe("matches()", () => {
    it("matches TS2344 errors", () => {
      registry.register(GenericConstraintBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);

      expect(GenericConstraintBuilder.matches(ctx)).toBe(true);
    });

    it("does not match other error codes", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "type-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      for (const diag of diagnostics) {
        if (diag.code === 2344) continue;

        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);

        expect(GenericConstraintBuilder.matches(ctx)).toBe(false);
      }
    });

    it("does not match TS2344 when failing type cannot be found", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      // Create a mock diagnostic with unparseable message
      const mockDiagnostic = {
        category: 1,
        code: 2344,
        file: undefined,
        start: 0,
        length: 10,
        messageText: "Some other error message",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      expect(GenericConstraintBuilder.matches(ctx)).toBe(false);
    });

    it("returns false when constraint cannot be found", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      const mockDiagnostic = {
        category: 1,
        code: 2344,
        file: undefined,
        start: 0,
        length: 10,
        messageText:
          "Type 'Foo' does not satisfy the constraint 'NonExistentConstraint'",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      expect(GenericConstraintBuilder.matches(ctx)).toBe(false);
    });
  });

  describe("generate()", () => {
    it("generates candidates for constraint violation", () => {
      registry.register(GenericConstraintBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);

      const candidates = GenericConstraintBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].kind).toBe("synthetic");
      expect(candidates[0].scopeHint).toBe("errors");
      expect(candidates[0].riskHint).toBe("medium");
    });

    it("generates FileChanges with correct structure", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);

      const candidates = GenericConstraintBuilder.generate(ctx);

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

    it("generates fix that adds missing id property", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);

      const candidates = GenericConstraintBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        // The fix should add the missing 'id' property
        const newText = candidate.changes[0].newText;
        expect(newText).toContain("id");
        expect(newText).toContain("string");
      }
    });

    it("includes metadata about the constraint violation", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);

      const candidates = GenericConstraintBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        expect(candidate.metadata).toBeDefined();
        expect(candidate.metadata?.failingType).toBe("User");
        expect(candidate.metadata?.constraintType).toBe("HasId");
        expect(candidate.metadata?.missingMembers).toContain("id");
      }
    });

    it("includes correct tags", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);

      const candidates = GenericConstraintBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.tags).toContain("generic-constraint");
      expect(candidate.tags).toContain("add-member");
    });

    it("targets the correct file for the fix", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);

      const candidates = GenericConstraintBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        // The fix should target consumer.ts where User interface is defined
        expect(candidate.changes[0].file).toContain("consumer.ts");
      }
    });
  });

  describe("integration with BuilderRegistry", () => {
    it("is routed correctly by diagnostic code", () => {
      registry.register(GenericConstraintBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const candidates = registry.getCandidateBuilders(ts2344!);
      expect(candidates).toContain(GenericConstraintBuilder);
    });

    it("generates candidates via registry", () => {
      registry.register(GenericConstraintBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);
      const candidates = registry.generateCandidates(ctx);

      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when message cannot be parsed", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      const mockDiagnostic = {
        category: 1,
        code: 2344,
        file: undefined,
        start: undefined,
        length: 10,
        messageText: "Unparseable error message",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      const candidates = GenericConstraintBuilder.generate(ctx);
      expect(candidates).toHaveLength(0);
    });
  });
});
