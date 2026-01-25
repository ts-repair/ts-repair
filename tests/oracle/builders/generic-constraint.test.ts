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

  describe("discriminated union constraints", () => {
    it("matches TS2344 errors with union constraints", () => {
      registry.register(GenericConstraintBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-union/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Should find TS2344 errors for MyAction and MyResult
      const ts2344Errors = diagnostics.filter((d) => d.code === 2344);
      expect(ts2344Errors.length).toBeGreaterThanOrEqual(2);

      for (const diag of ts2344Errors) {
        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);
        expect(GenericConstraintBuilder.matches(ctx)).toBe(true);
      }
    });

    it("generates candidates that include discriminator property", () => {
      registry.register(GenericConstraintBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-union/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344Errors = diagnostics.filter((d) => d.code === 2344);
      expect(ts2344Errors.length).toBeGreaterThanOrEqual(2);

      // Find the MyAction error (missing 'type' discriminator)
      const myActionError = ts2344Errors.find((d) => {
        const msg =
          typeof d.messageText === "string"
            ? d.messageText
            : d.messageText.messageText;
        return msg.includes("MyAction");
      });
      expect(myActionError).toBeDefined();

      const ctx = createBuilderContext(myActionError!, host, new Set(), diagnostics);
      const candidates = GenericConstraintBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        // The fix should add the discriminator 'type' property
        const newText = candidate.changes[0].newText;
        expect(newText).toContain("type");
      }
    });

    it("includes discriminated-union tag when discriminator is detected", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-union/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344Errors = diagnostics.filter((d) => d.code === 2344);

      // Check any of the union constraint errors
      for (const diag of ts2344Errors) {
        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);
        const candidates = GenericConstraintBuilder.generate(ctx);

        if (candidates.length > 0 && candidates[0].kind === "synthetic") {
          const metadata = candidates[0].metadata;
          if (metadata?.hasDiscriminator) {
            expect(candidates[0].tags).toContain("discriminated-union");
          }
        }
      }
    });

    it("includes confidence scoring in metadata", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-union/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344Errors = diagnostics.filter((d) => d.code === 2344);

      for (const diag of ts2344Errors) {
        const ctx = createBuilderContext(diag, host, new Set(), diagnostics);
        const candidates = GenericConstraintBuilder.generate(ctx);

        if (candidates.length > 0 && candidates[0].kind === "synthetic") {
          const metadata = candidates[0].metadata;
          expect(metadata?.memberMatches).toBeDefined();
          expect(Array.isArray(metadata?.memberMatches)).toBe(true);

          // Each member match should have confidence and source
          for (const match of metadata?.memberMatches as Array<{
            name: string;
            confidence: number;
            source: string;
          }>) {
            expect(typeof match.name).toBe("string");
            expect(typeof match.confidence).toBe("number");
            expect(match.confidence).toBeGreaterThanOrEqual(0);
            expect(match.confidence).toBeLessThanOrEqual(1);
            expect(["direct", "union-discriminator", "structural"]).toContain(
              match.source
            );
          }

          expect(metadata?.avgConfidence).toBeDefined();
          expect(typeof metadata?.avgConfidence).toBe("number");
        }
      }
    });

    it("generates fix for Result union constraint with success discriminator", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-union/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the MyResult error (missing 'success' discriminator)
      const myResultError = diagnostics.find((d) => {
        if (d.code !== 2344) return false;
        const msg =
          typeof d.messageText === "string"
            ? d.messageText
            : d.messageText.messageText;
        return msg.includes("MyResult");
      });
      expect(myResultError).toBeDefined();

      const ctx = createBuilderContext(myResultError!, host, new Set(), diagnostics);
      const candidates = GenericConstraintBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        // The fix should add the discriminator 'success' property
        const newText = candidate.changes[0].newText;
        expect(newText).toContain("success");
      }
    });
  });

  describe("type references in unions", () => {
    it("matches TS2344 even when union contains type references", () => {
      registry.register(GenericConstraintBuilder);

      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-type-refs/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);
      expect(GenericConstraintBuilder.matches(ctx)).toBe(true);
    });

    it("does not detect discriminator when union uses type references", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-type-refs/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const ts2344 = diagnostics.find((d) => d.code === 2344);
      expect(ts2344).toBeDefined();

      const ctx = createBuilderContext(ts2344!, host, new Set(), diagnostics);
      const candidates = GenericConstraintBuilder.generate(ctx);

      // Should still generate candidates, but without discriminator detection
      // The fix will not have the "discriminated-union" tag since we can't analyze type references
      if (candidates.length > 0 && candidates[0].kind === "synthetic") {
        // Either no candidates (if union can't be analyzed) or no discriminator tag
        const hasDiscriminatorTag = candidates[0].tags?.includes("discriminated-union");
        expect(hasDiscriminatorTag).toBe(false);
      }
    });
  });

  describe("boolean and numeric discriminators", () => {
    it("generates fix with boolean discriminator (not strings)", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-literal-types/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the MyBoolResult error
      const myBoolResultError = diagnostics.find((d) => {
        if (d.code !== 2344) return false;
        const msg =
          typeof d.messageText === "string"
            ? d.messageText
            : d.messageText.messageText;
        return msg.includes("MyBoolResult");
      });
      expect(myBoolResultError).toBeDefined();

      const ctx = createBuilderContext(myBoolResultError!, host, new Set(), diagnostics);
      const candidates = GenericConstraintBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        const newText = candidate.changes[0].newText;
        // Should contain boolean literals, not string literals
        // Expected: "success: true | false" NOT "success: \"true\" | \"false\""
        expect(newText).toContain("success");
        expect(newText).toMatch(/success:\s*(true|false)\s*\|\s*(true|false)/);
        expect(newText).not.toMatch(/success:\s*"true"|"false"/);
      }
    });

    it("generates fix with numeric discriminator (not strings)", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-literal-types/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the MyStatus error
      const myStatusError = diagnostics.find((d) => {
        if (d.code !== 2344) return false;
        const msg =
          typeof d.messageText === "string"
            ? d.messageText
            : d.messageText.messageText;
        return msg.includes("MyStatus");
      });
      expect(myStatusError).toBeDefined();

      const ctx = createBuilderContext(myStatusError!, host, new Set(), diagnostics);
      const candidates = GenericConstraintBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        const newText = candidate.changes[0].newText;
        // Should contain numeric literals, not string literals
        // Expected: "code: 200 | 404 | 500" NOT "code: \"200\" | \"404\" | \"500\""
        expect(newText).toContain("code");
        expect(newText).toMatch(/code:\s*\d+\s*\|\s*\d+\s*\|\s*\d+/);
        expect(newText).not.toMatch(/code:\s*"\d+"/);
      }
    });

    it("includes discriminated-union tag for boolean discriminators", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-literal-types/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const myBoolResultError = diagnostics.find((d) => {
        if (d.code !== 2344) return false;
        const msg =
          typeof d.messageText === "string"
            ? d.messageText
            : d.messageText.messageText;
        return msg.includes("MyBoolResult");
      });
      expect(myBoolResultError).toBeDefined();

      const ctx = createBuilderContext(myBoolResultError!, host, new Set(), diagnostics);
      const candidates = GenericConstraintBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].tags).toContain("discriminated-union");
    });

    it("includes discriminated-union tag for numeric discriminators", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "generic-constraint-literal-types/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      const myStatusError = diagnostics.find((d) => {
        if (d.code !== 2344) return false;
        const msg =
          typeof d.messageText === "string"
            ? d.messageText
            : d.messageText.messageText;
        return msg.includes("MyStatus");
      });
      expect(myStatusError).toBeDefined();

      const ctx = createBuilderContext(myStatusError!, host, new Set(), diagnostics);
      const candidates = GenericConstraintBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].tags).toContain("discriminated-union");
    });
  });
});
