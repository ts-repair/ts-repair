/**
 * ModuleExtensionBuilder Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import {
  BuilderRegistry,
  createBuilderContext,
  defaultRegistry,
} from "../../../src/oracle/builder.js";
import { createTypeScriptHost } from "../../../src/oracle/typescript.js";
import { ModuleExtensionBuilder } from "../../../src/oracle/builders/module-extension.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");

describe("ModuleExtensionBuilder", () => {
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
      expect(ModuleExtensionBuilder.name).toBe("ModuleExtensionBuilder");
    });

    it("has correct description", () => {
      expect(ModuleExtensionBuilder.description).toBe(
        "Repairs missing file extensions in ESM imports"
      );
    });

    it("targets TS2835", () => {
      expect(ModuleExtensionBuilder.diagnosticCodes).toContain(2835);
    });
  });

  describe("matches()", () => {
    it("matches TS2835 errors", () => {
      registry.register(ModuleExtensionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);

      expect(ModuleExtensionBuilder.matches(ctx)).toBe(true);
    });

    it("does not match other error codes", () => {
      // Use a fixture with a different error type
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "type-mismatch/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      for (const diag of diagnostics) {
        if (diag.code === 2835) continue;

        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);

        expect(ModuleExtensionBuilder.matches(ctx)).toBe(false);
      }
    });

    it("does not match TS2835 without suggested path in message", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      // Create a mock diagnostic without a suggestion
      const mockDiagnostic = {
        category: 1,
        code: 2835,
        file: undefined,
        start: 0,
        length: 10,
        messageText: "Relative import paths need explicit file extensions",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      expect(ModuleExtensionBuilder.matches(ctx)).toBe(false);
    });
  });

  describe("generate()", () => {
    it("generates candidates for module extension errors", () => {
      registry.register(ModuleExtensionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);

      const candidates = ModuleExtensionBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].kind).toBe("synthetic");
      expect(candidates[0].scopeHint).toBe("modified");
      expect(candidates[0].riskHint).toBe("low");
    });

    it("generates FileChanges with correct structure", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);

      const candidates = ModuleExtensionBuilder.generate(ctx);

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

    it("generates change with .js extension", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);

      const candidates = ModuleExtensionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        // The fix should add .js extension
        const newText = candidate.changes[0].newText;
        expect(newText).toContain("./utils.js");
      }
    });

    it("includes metadata about the path change", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);

      const candidates = ModuleExtensionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        expect(candidate.metadata).toBeDefined();
        expect(candidate.metadata?.originalPath).toBe("./utils");
        expect(candidate.metadata?.suggestedPath).toBe("./utils.js");
      }
    });

    it("includes correct tags", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);

      const candidates = ModuleExtensionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      expect(candidate.tags).toContain("import");
      expect(candidate.tags).toContain("module-extension");
    });

    it("targets the correct file for the fix", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);

      const candidates = ModuleExtensionBuilder.generate(ctx);
      expect(candidates.length).toBeGreaterThan(0);

      const candidate = candidates[0];
      if (candidate.kind === "synthetic") {
        // The fix should target index.ts where the import is
        expect(candidate.changes[0].file).toContain("index.ts");
      }
    });
  });

  describe("integration with BuilderRegistry", () => {
    it("is routed correctly by diagnostic code", () => {
      registry.register(ModuleExtensionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const candidates = registry.getCandidateBuilders(ts2835!);
      expect(candidates).toContain(ModuleExtensionBuilder);
    });

    it("generates candidates via registry", () => {
      registry.register(ModuleExtensionBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      const ctx = createBuilderContext(ts2835!, host, new Set(), diagnostics);
      const candidates = registry.generateCandidates(ctx);

      expect(candidates.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when file cannot be found", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );

      // Create a mock diagnostic without a valid file
      const mockDiagnostic = {
        category: 1,
        code: 2835,
        file: undefined,
        start: 0,
        length: 10,
        messageText: "Did you mean './utils.js'?",
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      const candidates = ModuleExtensionBuilder.generate(ctx);
      expect(candidates).toHaveLength(0);
    });

    it("returns empty array when start position is undefined", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "module-extension/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();
      const ts2835 = diagnostics.find((d) => d.code === 2835);
      expect(ts2835).toBeDefined();

      // Create a mock diagnostic with undefined start
      const mockDiagnostic = {
        ...ts2835!,
        start: undefined,
      } as unknown as import("typescript").Diagnostic;

      const ctx = createBuilderContext(mockDiagnostic, host, new Set(), []);

      const candidates = ModuleExtensionBuilder.generate(ctx);
      expect(candidates).toHaveLength(0);
    });
  });
});
