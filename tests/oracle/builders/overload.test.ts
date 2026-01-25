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
import {
  OverloadRepairBuilder,
  extractModifiers,
  getImplementationReturnType,
} from "../../../src/oracle/builders/overload.js";
import ts from "typescript";

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

  describe("modifier and return type handling", () => {
    // Helper to find diagnostic by function name on the same line
    function findDiagnosticForFunc(
      diagnostics: import("typescript").Diagnostic[],
      funcName: string
    ) {
      return diagnostics.find((d) => {
        if (d.code !== 2769 || !d.file || d.start === undefined) return false;
        // Get the line containing the diagnostic
        const startOfLine = d.file.text.lastIndexOf("\n", d.start) + 1;
        const endOfLine = d.file.text.indexOf("\n", d.start);
        const line = d.file.text.slice(startOfLine, endOfLine);
        return line.includes(funcName);
      });
    }

    it("generates non-exported overload for non-exported function", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-modifiers/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the TS2769 for processInternal (non-exported function)
      const ts2769 = findDiagnosticForFunc(diagnostics, "processInternal");
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);
      const candidates = OverloadRepairBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        const newText = candidate.changes[0].newText;
        // Should NOT have 'export' modifier for non-exported function
        expect(newText).not.toMatch(/^export\s/);
        expect(newText).toMatch(/^function\s+processInternal/);
      }
    });

    it("generates async overload for async function", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-modifiers/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the TS2769 for fetchData (async exported function)
      const ts2769 = findDiagnosticForFunc(diagnostics, "fetchData");
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);
      const candidates = OverloadRepairBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        const newText = candidate.changes[0].newText;
        // Should have 'export async' modifiers
        expect(newText).toMatch(/^export\s+async\s+function\s+fetchData/);
      }
    });

    it("uses actual return type instead of hardcoded void", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-modifiers/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the TS2769 for compute (has explicit return type)
      const ts2769 = findDiagnosticForFunc(diagnostics, "compute");
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);
      const candidates = OverloadRepairBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        const newText = candidate.changes[0].newText;
        // Should use the actual return type from implementation
        expect(newText).toContain("number | string");
        expect(newText).not.toContain(": void;");
      }
    });

    it("uses Promise return type for async function", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-modifiers/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the TS2769 for fetchData
      const ts2769 = findDiagnosticForFunc(diagnostics, "fetchData");
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);
      const candidates = OverloadRepairBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      const candidate = candidates[0];
      expect(candidate.kind).toBe("synthetic");

      if (candidate.kind === "synthetic") {
        const newText = candidate.changes[0].newText;
        // Should use Promise<string> return type
        expect(newText).toContain("Promise<string>");
      }
    });
  });

  describe("unsupported cases", () => {
    it("matches TS2769 for class method calls but generates no candidates", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "overload-unsupported/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();

      // Find the TS2769 for class method call (processor.process)
      const ts2769 = diagnostics.find((d) => {
        if (d.code !== 2769 || !d.file || d.start === undefined) return false;
        // Get the line containing the diagnostic
        const startOfLine = d.file.text.lastIndexOf("\n", d.start) + 1;
        const endOfLine = d.file.text.indexOf("\n", d.start);
        const line = d.file.text.slice(startOfLine, endOfLine);
        return line.includes("processor.process");
      });
      expect(ts2769).toBeDefined();

      const ctx = createBuilderContext(ts2769!, host, new Set(), diagnostics);

      // matches() returns true for TS2769 call expressions
      expect(OverloadRepairBuilder.matches(ctx)).toBe(true);
      // But generate() returns no candidates because no function declaration is found
      const candidates = OverloadRepairBuilder.generate(ctx);
      expect(candidates).toHaveLength(0);
    });
  });

  describe("extractModifiers()", () => {
    // Helper to parse a function declaration from source
    function parseFuncDecl(source: string): ts.FunctionDeclaration {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        source,
        ts.ScriptTarget.Latest,
        true
      );
      let funcDecl: ts.FunctionDeclaration | undefined;
      ts.forEachChild(sourceFile, (node) => {
        if (ts.isFunctionDeclaration(node)) {
          funcDecl = node;
        }
      });
      if (!funcDecl) throw new Error("No function declaration found");
      return funcDecl;
    }

    it("extracts export modifier", () => {
      const decl = parseFuncDecl("export function foo() {}");
      expect(extractModifiers(decl)).toBe("export ");
    });

    it("extracts async modifier", () => {
      const decl = parseFuncDecl("async function foo() {}");
      expect(extractModifiers(decl)).toBe("async ");
    });

    it("extracts export async modifiers together", () => {
      const decl = parseFuncDecl("export async function foo() {}");
      expect(extractModifiers(decl)).toBe("export async ");
    });

    it("extracts default modifier", () => {
      const decl = parseFuncDecl("export default function foo() {}");
      expect(extractModifiers(decl)).toBe("export default ");
    });

    it("extracts declare modifier", () => {
      const decl = parseFuncDecl("declare function foo(): void;");
      expect(extractModifiers(decl)).toBe("declare ");
    });

    it("returns empty string when no modifiers", () => {
      const decl = parseFuncDecl("function foo() {}");
      expect(extractModifiers(decl)).toBe("");
    });
  });

  describe("getImplementationReturnType()", () => {
    // Helper to parse function declarations from source
    function parseFuncDecls(source: string): {
      decls: ts.FunctionDeclaration[];
      sourceFile: ts.SourceFile;
    } {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        source,
        ts.ScriptTarget.Latest,
        true
      );
      const decls: ts.FunctionDeclaration[] = [];
      ts.forEachChild(sourceFile, (node) => {
        if (ts.isFunctionDeclaration(node)) {
          decls.push(node);
        }
      });
      return { decls, sourceFile };
    }

    it("finds correct return type from implementation", () => {
      const { decls, sourceFile } = parseFuncDecls(`
        function foo(x: string): string;
        function foo(x: number): number;
        function foo(x: unknown): string | number {
          return x as string | number;
        }
      `);
      expect(getImplementationReturnType(decls, sourceFile)).toBe(
        "string | number"
      );
    });

    it("returns void when no explicit return type specified", () => {
      const { decls, sourceFile } = parseFuncDecls(`
        function bar() {
          console.log("hello");
        }
      `);
      expect(getImplementationReturnType(decls, sourceFile)).toBe("void");
    });

    it("returns void when no implementation found", () => {
      const { decls, sourceFile } = parseFuncDecls(`
        declare function baz(x: string): string;
      `);
      // Declared functions have no body, so no implementation
      expect(getImplementationReturnType(decls, sourceFile)).toBe("void");
    });

    it("finds Promise return type for async function", () => {
      const { decls, sourceFile } = parseFuncDecls(`
        async function fetchData(): Promise<string> {
          return "data";
        }
      `);
      expect(getImplementationReturnType(decls, sourceFile)).toBe(
        "Promise<string>"
      );
    });
  });
});
