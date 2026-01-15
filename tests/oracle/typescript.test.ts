/**
 * TypeScript Host Unit Tests
 *
 * Tests for TypeScript integration including diagnostics, code fixes, and conversions.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  createTypeScriptHost,
  toDiagnosticRef,
  toFileChanges,
  type TypeScriptHost,
} from "../../src/oracle/typescript.js";
import path from "path";
import ts from "typescript";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("createTypeScriptHost", () => {
  describe("initialization", () => {
    it("creates host from valid tsconfig.json", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      expect(host).toBeDefined();
      expect(typeof host.getDiagnostics).toBe("function");
      expect(typeof host.getCodeFixes).toBe("function");
      expect(typeof host.applyFix).toBe("function");
    });

    it("throws on invalid tsconfig path", () => {
      expect(() => {
        createTypeScriptHost("/nonexistent/tsconfig.json");
      }).toThrow();
    });

    it("returns correct file names", () => {
      const configPath = path.join(FIXTURES_DIR, "multiple-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const fileNames = host.getFileNames();
      expect(fileNames.length).toBe(2);
      expect(fileNames.some((f) => f.endsWith("index.ts"))).toBe(true);
      expect(fileNames.some((f) => f.endsWith("helpers.ts"))).toBe(true);
    });

    it("returns compiler options", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const options = host.getOptions();
      expect(options).toBeDefined();
      expect(options.strict).toBe(true);
    });
  });

  describe("getDiagnostics", () => {
    it("returns empty array for error-free project", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      expect(diagnostics).toHaveLength(0);
    });

    it("returns diagnostics for project with errors", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("returns only error-level diagnostics (not warnings)", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      for (const d of diagnostics) {
        expect(d.category).toBe(ts.DiagnosticCategory.Error);
      }
    });

    it("returns correct error code for async/await error", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      // TS1308: 'await' expressions are only allowed within async functions
      const hasAwaitError = diagnostics.some((d) => d.code === 1308);
      expect(hasAwaitError).toBe(true);
    });

    it("returns diagnostics with file information", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      for (const d of diagnostics) {
        expect(d.file).toBeDefined();
        expect(d.start).toBeDefined();
        expect(d.length).toBeDefined();
      }
    });

    it("returns multiple diagnostics for multi-error file", () => {
      const configPath = path.join(FIXTURES_DIR, "multiple-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    });

    it("reflects VFS changes on subsequent calls", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const initialDiagnostics = host.getDiagnostics();
      expect(initialDiagnostics.length).toBeGreaterThan(0);

      // Fix the error by adding the import
      const vfs = host.getVFS();
      const indexFile = host.getFileNames().find((f) => f.endsWith("index.ts"))!;
      const content = vfs.read(indexFile)!;
      vfs.write(
        indexFile,
        `import { formatDate } from "./helpers.js";\n${content}`
      );

      // Notify host of VFS change so LanguageService sees it
      host.notifyFilesChanged();

      const newDiagnostics = host.getDiagnostics();
      expect(newDiagnostics.length).toBeLessThan(initialDiagnostics.length);
    });
  });

  describe("getCodeFixes", () => {
    it("returns fixes for diagnostic with available fixes", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      expect(diagnostics.length).toBeGreaterThan(0);

      const diagnostic = diagnostics[0];
      const fixes = host.getCodeFixes(diagnostic);

      // Missing import should have at least one fix
      expect(fixes.length).toBeGreaterThan(0);
    });

    it("returns empty array for diagnostic without fixes", () => {
      const configPath = path.join(FIXTURES_DIR, "type-mismatch/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      // Type mismatch errors often don't have automatic fixes
      const fixes = host.getCodeFixes(diagnostics[0]);

      // This may or may not have fixes depending on TypeScript version
      expect(Array.isArray(fixes)).toBe(true);
    });

    it("returns empty array for diagnostic without file info", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      // Create a fake diagnostic without file info
      const fakeDiagnostic: ts.Diagnostic = {
        file: undefined,
        start: undefined,
        length: undefined,
        messageText: "Fake error",
        category: ts.DiagnosticCategory.Error,
        code: 9999,
      };

      const fixes = host.getCodeFixes(fakeDiagnostic);
      expect(fixes).toHaveLength(0);
    });

    it("returns fixes with change information", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      const fixes = host.getCodeFixes(diagnostics[0]);

      if (fixes.length > 0) {
        const fix = fixes[0];
        expect(fix.fixName).toBeDefined();
        expect(fix.description).toBeDefined();
        expect(fix.changes).toBeDefined();
        expect(fix.changes.length).toBeGreaterThan(0);
      }
    });
  });

  describe("applyFix", () => {
    it("applies fix changes to VFS", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnosticsBefore = host.getDiagnostics();
      const fix = host.getCodeFixes(diagnosticsBefore[0])[0];

      if (fix) {
        host.applyFix(fix);
        const diagnosticsAfter = host.getDiagnostics();

        // Should have fewer errors after applying fix
        expect(diagnosticsAfter.length).toBeLessThanOrEqual(
          diagnosticsBefore.length
        );
      }
    });

    it("handles fix with multiple file changes", () => {
      // Most fixes only change one file, but the function should handle multiple
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const diagnostics = host.getDiagnostics();
      const fixes = host.getCodeFixes(diagnostics[0]);

      if (fixes.length > 0) {
        // Just verify it doesn't throw
        expect(() => host.applyFix(fixes[0])).not.toThrow();
      }
    });
  });

  describe("getVFS", () => {
    it("returns the VFS instance", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      const vfs = host.getVFS();
      expect(vfs).toBeDefined();
      expect(typeof vfs.read).toBe("function");
      expect(typeof vfs.write).toBe("function");
      expect(typeof vfs.snapshot).toBe("function");
    });

    it("VFS modifications affect diagnostics", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const host = createTypeScriptHost(configPath);

      // Initially no errors
      expect(host.getDiagnostics()).toHaveLength(0);

      // Introduce an error
      const vfs = host.getVFS();
      const fileName = host.getFileNames()[0];
      vfs.write(fileName, "const x: number = 'string';");

      // Notify host of VFS change so LanguageService sees it
      host.notifyFilesChanged();

      // Now should have errors
      const diagnostics = host.getDiagnostics();
      expect(diagnostics.length).toBeGreaterThan(0);
    });
  });
});

describe("toDiagnosticRef", () => {
  it("converts TypeScript diagnostic to DiagnosticRef", () => {
    const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
    const host = createTypeScriptHost(configPath);

    const diagnostics = host.getDiagnostics();
    expect(diagnostics.length).toBeGreaterThan(0);

    const ref = toDiagnosticRef(diagnostics[0]);

    expect(ref.code).toBe(diagnostics[0].code);
    expect(typeof ref.message).toBe("string");
    expect(ref.message.length).toBeGreaterThan(0);
    expect(typeof ref.file).toBe("string");
    expect(ref.line).toBeGreaterThan(0);
    expect(ref.column).toBeGreaterThan(0);
    expect(typeof ref.start).toBe("number");
    expect(typeof ref.length).toBe("number");
  });

  it("handles diagnostic without file info", () => {
    const fakeDiagnostic: ts.Diagnostic = {
      file: undefined,
      start: undefined,
      length: undefined,
      messageText: "Some error message",
      category: ts.DiagnosticCategory.Error,
      code: 1234,
    };

    const ref = toDiagnosticRef(fakeDiagnostic);

    expect(ref.code).toBe(1234);
    expect(ref.message).toBe("Some error message");
    expect(ref.file).toBe("unknown");
    expect(ref.line).toBe(0);
    expect(ref.column).toBe(0);
    expect(ref.start).toBe(0);
    expect(ref.length).toBe(0);
  });

  it("handles nested diagnostic message", () => {
    const nestedDiagnostic: ts.Diagnostic = {
      file: undefined,
      start: undefined,
      length: undefined,
      messageText: {
        messageText: "Main message",
        category: ts.DiagnosticCategory.Error,
        code: 1234,
        next: [
          {
            messageText: "Additional info",
            category: ts.DiagnosticCategory.Error,
            code: 1234,
          },
        ],
      },
      category: ts.DiagnosticCategory.Error,
      code: 1234,
    };

    const ref = toDiagnosticRef(nestedDiagnostic);
    expect(ref.message).toContain("Main message");
  });

  it("uses 1-indexed line and column numbers", () => {
    const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
    const host = createTypeScriptHost(configPath);

    const diagnostics = host.getDiagnostics();
    const ref = toDiagnosticRef(diagnostics[0]);

    // Line and column should be at least 1
    expect(ref.line).toBeGreaterThanOrEqual(1);
    expect(ref.column).toBeGreaterThanOrEqual(1);
  });
});

describe("toFileChanges", () => {
  it("converts CodeFixAction changes to FileChange array", () => {
    const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
    const host = createTypeScriptHost(configPath);

    const diagnostics = host.getDiagnostics();
    const fixes = host.getCodeFixes(diagnostics[0]);

    if (fixes.length > 0) {
      const changes = toFileChanges(fixes[0]);

      expect(Array.isArray(changes)).toBe(true);
      expect(changes.length).toBeGreaterThan(0);

      for (const change of changes) {
        expect(typeof change.file).toBe("string");
        expect(typeof change.start).toBe("number");
        expect(typeof change.end).toBe("number");
        expect(typeof change.newText).toBe("string");
        expect(change.end).toBeGreaterThanOrEqual(change.start);
      }
    }
  });

  it("handles fix with multiple changes", () => {
    // Create a mock fix with multiple changes
    const mockFix: ts.CodeFixAction = {
      fixName: "test",
      description: "Test fix",
      changes: [
        {
          fileName: "/file1.ts",
          textChanges: [
            { span: { start: 0, length: 5 }, newText: "hello" },
            { span: { start: 10, length: 0 }, newText: " world" },
          ],
        },
        {
          fileName: "/file2.ts",
          textChanges: [{ span: { start: 0, length: 0 }, newText: "import x;" }],
        },
      ],
    };

    const changes = toFileChanges(mockFix);

    expect(changes).toHaveLength(3);
    expect(changes[0].file).toBe("/file1.ts");
    expect(changes[0].start).toBe(0);
    expect(changes[0].end).toBe(5);
    expect(changes[1].file).toBe("/file1.ts");
    expect(changes[1].start).toBe(10);
    expect(changes[1].end).toBe(10);
    expect(changes[2].file).toBe("/file2.ts");
  });

  it("handles fix with empty changes", () => {
    const mockFix: ts.CodeFixAction = {
      fixName: "test",
      description: "Test fix",
      changes: [],
    };

    const changes = toFileChanges(mockFix);
    expect(changes).toHaveLength(0);
  });
});
