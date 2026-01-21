/**
 * Solution Builder Framework Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import ts from "typescript";
import path from "path";
import {
  BuilderRegistry,
  createBuilderContext,
  defaultRegistry,
  registerBuilder,
  findNodeAtPosition,
} from "../../src/oracle/builder.js";
import { createTypeScriptHost } from "../../src/oracle/typescript.js";
import { createSyntheticFix } from "../../src/oracle/candidate.js";
import type {
  SolutionBuilder,
  BuilderContext,
  CandidateFix,
} from "../../src/output/types.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

// Clear the default registry at module load to ensure test isolation
defaultRegistry.clear();

// Helper to create a mock diagnostic
function createMockDiagnostic(
  code: number,
  message: string,
  fileName?: string,
  start?: number
): ts.Diagnostic {
  const sourceFile = fileName
    ? ts.createSourceFile(fileName, "", ts.ScriptTarget.Latest, true)
    : undefined;

  return {
    category: ts.DiagnosticCategory.Error,
    code,
    file: sourceFile,
    start: start ?? 0,
    length: 10,
    messageText: message,
  };
}

// Helper to create a simple mock builder
function createMockBuilder(
  name: string,
  options: {
    diagnosticCodes?: number[];
    messagePatterns?: RegExp[];
    matches?: (ctx: BuilderContext) => boolean;
    generate?: (ctx: BuilderContext) => CandidateFix[];
  } = {}
): SolutionBuilder {
  return {
    name,
    description: `Mock builder: ${name}`,
    diagnosticCodes: options.diagnosticCodes,
    messagePatterns: options.messagePatterns,
    matches: options.matches ?? (() => true),
    generate:
      options.generate ??
      (() => [
        createSyntheticFix(`${name}-fix`, `Fix from ${name}`, [
          { file: "/test.ts", start: 0, end: 0, newText: "// fix" },
        ]),
      ]),
  };
}

describe("BuilderRegistry", () => {
  let registry: BuilderRegistry;

  beforeEach(() => {
    registry = new BuilderRegistry();
  });

  describe("register()", () => {
    it("adds builder to the registry", () => {
      const builder = createMockBuilder("test");
      registry.register(builder);

      expect(registry.getAll()).toHaveLength(1);
      expect(registry.getAll()[0]).toBe(builder);
    });

    it("indexes builder by diagnostic codes", () => {
      const builder = createMockBuilder("ts2322", {
        diagnosticCodes: [2322, 2345],
      });
      registry.register(builder);

      const diagnostic2322 = createMockDiagnostic(2322, "Type error");
      const diagnostic2345 = createMockDiagnostic(2345, "Argument error");
      const diagnostic9999 = createMockDiagnostic(9999, "Other error");

      expect(registry.getCandidateBuilders(diagnostic2322)).toContain(builder);
      expect(registry.getCandidateBuilders(diagnostic2345)).toContain(builder);
      expect(registry.getCandidateBuilders(diagnostic9999)).not.toContain(
        builder
      );
    });

    it("registers multiple builders", () => {
      const builder1 = createMockBuilder("builder1");
      const builder2 = createMockBuilder("builder2");

      registry.register(builder1);
      registry.register(builder2);

      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe("getCandidateBuilders()", () => {
    it("returns builders matching diagnostic code", () => {
      const builder1 = createMockBuilder("for-2322", {
        diagnosticCodes: [2322],
      });
      const builder2 = createMockBuilder("for-2345", {
        diagnosticCodes: [2345],
      });

      registry.register(builder1);
      registry.register(builder2);

      const diagnostic = createMockDiagnostic(2322, "Type error");
      const candidates = registry.getCandidateBuilders(diagnostic);

      expect(candidates).toContain(builder1);
      expect(candidates).not.toContain(builder2);
    });

    it("returns builders matching message pattern", () => {
      const builder = createMockBuilder("overload-builder", {
        messagePatterns: [/overload/i, /signature/i],
      });
      registry.register(builder);

      const matching = createMockDiagnostic(
        2769,
        "No overload matches this call"
      );
      const notMatching = createMockDiagnostic(2322, "Type error");

      expect(registry.getCandidateBuilders(matching)).toContain(builder);
      expect(registry.getCandidateBuilders(notMatching)).not.toContain(builder);
    });

    it("returns catch-all builders for any diagnostic", () => {
      const catchAll = createMockBuilder("catch-all");
      const specific = createMockBuilder("specific", {
        diagnosticCodes: [2322],
      });

      registry.register(catchAll);
      registry.register(specific);

      const anyDiagnostic = createMockDiagnostic(9999, "Any error");

      expect(registry.getCandidateBuilders(anyDiagnostic)).toContain(catchAll);
    });

    it("combines code-matched and pattern-matched builders", () => {
      const codeBuilder = createMockBuilder("code-builder", {
        diagnosticCodes: [2322],
      });
      const patternBuilder = createMockBuilder("pattern-builder", {
        messagePatterns: [/type.*is not assignable/i],
      });

      registry.register(codeBuilder);
      registry.register(patternBuilder);

      const diagnostic = createMockDiagnostic(
        2322,
        "Type 'string' is not assignable to type 'number'"
      );
      const candidates = registry.getCandidateBuilders(diagnostic);

      expect(candidates).toContain(codeBuilder);
      expect(candidates).toContain(patternBuilder);
    });

    it("avoids duplicates when builder matches both code and pattern", () => {
      const builder = createMockBuilder("dual-builder", {
        diagnosticCodes: [2322],
        messagePatterns: [/type/i],
      });
      registry.register(builder);

      const diagnostic = createMockDiagnostic(2322, "Type error");
      const candidates = registry.getCandidateBuilders(diagnostic);

      // Should only appear once
      expect(candidates.filter((b) => b === builder)).toHaveLength(1);
    });
  });

  describe("getMatchingBuilders()", () => {
    it("filters by matches() result", () => {
      const matchingBuilder = createMockBuilder("matching", {
        matches: () => true,
      });
      const nonMatchingBuilder = createMockBuilder("non-matching", {
        matches: () => false,
      });

      registry.register(matchingBuilder);
      registry.register(nonMatchingBuilder);

      const diagnostic = createMockDiagnostic(1, "Error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(diagnostic, host, new Set(), [
        diagnostic,
      ]);

      const matching = registry.getMatchingBuilders(ctx);

      expect(matching).toContain(matchingBuilder);
      expect(matching).not.toContain(nonMatchingBuilder);
    });

    it("only considers candidate builders", () => {
      const specificBuilder = createMockBuilder("specific", {
        diagnosticCodes: [2322],
        matches: () => true,
      });
      registry.register(specificBuilder);

      const differentDiagnostic = createMockDiagnostic(9999, "Different error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(differentDiagnostic, host, new Set(), [
        differentDiagnostic,
      ]);

      const matching = registry.getMatchingBuilders(ctx);

      expect(matching).not.toContain(specificBuilder);
    });
  });

  describe("generateCandidates()", () => {
    it("collects candidates from all matching builders", () => {
      const builder1 = createMockBuilder("builder1", {
        generate: () => [
          createSyntheticFix("fix1", "Fix 1", [
            { file: "/a.ts", start: 0, end: 0, newText: "1" },
          ]),
        ],
      });
      const builder2 = createMockBuilder("builder2", {
        generate: () => [
          createSyntheticFix("fix2", "Fix 2", [
            { file: "/b.ts", start: 0, end: 0, newText: "2" },
          ]),
        ],
      });

      registry.register(builder1);
      registry.register(builder2);

      const diagnostic = createMockDiagnostic(1, "Error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(diagnostic, host, new Set(), [
        diagnostic,
      ]);

      const candidates = registry.generateCandidates(ctx);

      expect(candidates).toHaveLength(2);
      expect(candidates.map((c) => c.fixName)).toContain("fix1");
      expect(candidates.map((c) => c.fixName)).toContain("fix2");
    });

    it("handles builders that return multiple candidates", () => {
      const builder = createMockBuilder("multi-builder", {
        generate: () => [
          createSyntheticFix("fix-a", "Fix A", []),
          createSyntheticFix("fix-b", "Fix B", []),
          createSyntheticFix("fix-c", "Fix C", []),
        ],
      });
      registry.register(builder);

      const diagnostic = createMockDiagnostic(1, "Error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(diagnostic, host, new Set(), [
        diagnostic,
      ]);

      const candidates = registry.generateCandidates(ctx);

      expect(candidates).toHaveLength(3);
    });

    it("skips builders that throw errors", () => {
      const goodBuilder = createMockBuilder("good", {
        generate: () => [createSyntheticFix("good-fix", "Good fix", [])],
      });
      const badBuilder = createMockBuilder("bad", {
        generate: () => {
          throw new Error("Builder failed");
        },
      });

      registry.register(goodBuilder);
      registry.register(badBuilder);

      const diagnostic = createMockDiagnostic(1, "Error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(diagnostic, host, new Set(), [
        diagnostic,
      ]);

      // Should not throw, should return candidates from good builder
      const candidates = registry.generateCandidates(ctx);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].fixName).toBe("good-fix");
    });

    it("returns empty array when no builders match", () => {
      const specificBuilder = createMockBuilder("specific", {
        diagnosticCodes: [2322],
      });
      registry.register(specificBuilder);

      const differentDiagnostic = createMockDiagnostic(9999, "Different error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(differentDiagnostic, host, new Set(), [
        differentDiagnostic,
      ]);

      const candidates = registry.generateCandidates(ctx);

      expect(candidates).toHaveLength(0);
    });
  });

  describe("clear()", () => {
    it("removes all builders", () => {
      registry.register(createMockBuilder("builder1"));
      registry.register(createMockBuilder("builder2"));

      expect(registry.getAll()).toHaveLength(2);

      registry.clear();

      expect(registry.getAll()).toHaveLength(0);
    });

    it("clears all indexes", () => {
      const builder = createMockBuilder("indexed", {
        diagnosticCodes: [2322],
      });
      registry.register(builder);

      registry.clear();

      const diagnostic = createMockDiagnostic(2322, "Error");
      expect(registry.getCandidateBuilders(diagnostic)).toHaveLength(0);
    });
  });

  describe("getMatchResults()", () => {
    it("returns match results for debugging", () => {
      const matching = createMockBuilder("matching", { matches: () => true });
      const nonMatching = createMockBuilder("non-matching", {
        matches: () => false,
      });

      registry.register(matching);
      registry.register(nonMatching);

      const diagnostic = createMockDiagnostic(1, "Error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(diagnostic, host, new Set(), [
        diagnostic,
      ]);

      const results = registry.getMatchResults(ctx);

      expect(results).toHaveLength(2);
      expect(results.find((r) => r.builder === "matching")?.matched).toBe(true);
      expect(results.find((r) => r.builder === "non-matching")?.matched).toBe(
        false
      );
    });

    it("captures errors in match results", () => {
      const errorBuilder = createMockBuilder("error", {
        matches: () => {
          throw new Error("Match failed");
        },
      });
      registry.register(errorBuilder);

      const diagnostic = createMockDiagnostic(1, "Error");
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "no-errors/tsconfig.json")
      );
      const ctx = createBuilderContext(diagnostic, host, new Set(), [
        diagnostic,
      ]);

      const results = registry.getMatchResults(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].matched).toBe(false);
      expect(results[0].reason).toContain("Error");
    });
  });
});

describe("createBuilderContext", () => {
  const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
  let host: ReturnType<typeof createTypeScriptHost>;

  beforeEach(() => {
    host = createTypeScriptHost(configPath);
  });

  it("creates a valid context with all required properties", () => {
    const diagnostic = createMockDiagnostic(2304, "Cannot find name 'lodash'");
    const filesWithErrors = new Set(["/test.ts"]);
    const currentDiagnostics = [diagnostic];

    const ctx = createBuilderContext(
      diagnostic,
      host,
      filesWithErrors,
      currentDiagnostics
    );

    expect(ctx.diagnostic).toBe(diagnostic);
    expect(ctx.host).toBe(host);
    expect(ctx.filesWithErrors).toBe(filesWithErrors);
    expect(ctx.currentDiagnostics).toBe(currentDiagnostics);
    expect(ctx.compilerOptions).toBeDefined();
    expect(typeof ctx.getNodeAtPosition).toBe("function");
    expect(typeof ctx.getSourceFile).toBe("function");
  });

  describe("getSourceFile()", () => {
    it("returns source file for valid path", () => {
      const diagnostic = createMockDiagnostic(2304, "Error");
      const ctx = createBuilderContext(diagnostic, host, new Set(), []);

      const fileNames = host.getFileNames();
      const firstFile = fileNames[0];
      const sourceFile = ctx.getSourceFile(firstFile);

      expect(sourceFile).toBeDefined();
      expect(sourceFile?.fileName).toBe(firstFile);
    });

    it("returns undefined for non-existent path", () => {
      const diagnostic = createMockDiagnostic(2304, "Error");
      const ctx = createBuilderContext(diagnostic, host, new Set(), []);

      const sourceFile = ctx.getSourceFile("/non/existent/file.ts");

      expect(sourceFile).toBeUndefined();
    });

    it("caches source files", () => {
      const diagnostic = createMockDiagnostic(2304, "Error");
      const ctx = createBuilderContext(diagnostic, host, new Set(), []);

      const fileNames = host.getFileNames();
      const firstFile = fileNames[0];

      const sourceFile1 = ctx.getSourceFile(firstFile);
      const sourceFile2 = ctx.getSourceFile(firstFile);

      expect(sourceFile1).toBe(sourceFile2);
    });
  });

  describe("getNodeAtPosition()", () => {
    it("returns undefined when diagnostic has no file", () => {
      const diagnostic = createMockDiagnostic(2304, "Error"); // No file
      const ctx = createBuilderContext(diagnostic, host, new Set(), []);

      const node = ctx.getNodeAtPosition();

      expect(node).toBeUndefined();
    });

    it("caches the node lookup", () => {
      const fileNames = host.getFileNames();
      const firstFile = fileNames[0];
      const content = host.getVFS().read(firstFile) ?? "";
      const sourceFile = ts.createSourceFile(
        firstFile,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      const diagnostic: ts.Diagnostic = {
        category: ts.DiagnosticCategory.Error,
        code: 2304,
        file: sourceFile,
        start: 10,
        length: 5,
        messageText: "Error",
      };

      const ctx = createBuilderContext(diagnostic, host, new Set(), []);

      const node1 = ctx.getNodeAtPosition();
      const node2 = ctx.getNodeAtPosition();

      // Should be the same reference (cached)
      expect(node1).toBe(node2);
    });
  });
});

describe("findNodeAtPosition", () => {
  it("finds the deepest node at a position", () => {
    const code = "const x = 1 + 2;";
    const sourceFile = ts.createSourceFile(
      "/test.ts",
      code,
      ts.ScriptTarget.Latest,
      true
    );

    // Position 10 is inside the "1" literal
    const node = findNodeAtPosition(sourceFile, 10);

    expect(node).toBeDefined();
    expect(node?.kind).toBe(ts.SyntaxKind.NumericLiteral);
  });

  it("returns undefined for position outside file", () => {
    const code = "const x = 1;";
    const sourceFile = ts.createSourceFile(
      "/test.ts",
      code,
      ts.ScriptTarget.Latest,
      true
    );

    const node = findNodeAtPosition(sourceFile, 1000);

    expect(node).toBeUndefined();
  });

  it("finds identifier nodes", () => {
    const code = "const myVariable = 42;";
    const sourceFile = ts.createSourceFile(
      "/test.ts",
      code,
      ts.ScriptTarget.Latest,
      true
    );

    // Position 6 is inside "myVariable"
    const node = findNodeAtPosition(sourceFile, 6);

    expect(node).toBeDefined();
    expect(node?.kind).toBe(ts.SyntaxKind.Identifier);
    expect((node as ts.Identifier).text).toBe("myVariable");
  });
});

describe("defaultRegistry and registerBuilder", () => {
  beforeEach(() => {
    defaultRegistry.clear();
  });

  afterEach(() => {
    defaultRegistry.clear();
  });

  afterAll(() => {
    // Ensure cleanup after all tests in this file
    defaultRegistry.clear();
  });

  it("registerBuilder adds to default registry", () => {
    const builder = createMockBuilder("global-builder");
    registerBuilder(builder);

    expect(defaultRegistry.getAll()).toContain(builder);
  });

  it("default registry is shared globally", () => {
    const builder = createMockBuilder("shared-builder");
    registerBuilder(builder);

    // Should be accessible from the same defaultRegistry
    expect(defaultRegistry.getAll()).toHaveLength(1);
  });
});

describe("builder integration scenarios", () => {
  let registry: BuilderRegistry;
  let host: ReturnType<typeof createTypeScriptHost>;

  beforeEach(() => {
    registry = new BuilderRegistry();
    host = createTypeScriptHost(
      path.join(FIXTURES_DIR, "missing-import/tsconfig.json")
    );
    // Ensure default registry is clean
    defaultRegistry.clear();
  });

  afterEach(() => {
    defaultRegistry.clear();
  });

  it("builder can access diagnostic information", () => {
    let receivedCode: number | undefined;
    let receivedMessage: string | undefined;

    const inspectingBuilder = createMockBuilder("inspector", {
      matches: (ctx) => {
        receivedCode = ctx.diagnostic.code;
        receivedMessage = ts.flattenDiagnosticMessageText(
          ctx.diagnostic.messageText,
          " "
        );
        return true;
      },
    });
    registry.register(inspectingBuilder);

    const diagnostic = createMockDiagnostic(2304, "Cannot find name 'foo'");
    const ctx = createBuilderContext(diagnostic, host, new Set(), [diagnostic]);
    registry.getMatchingBuilders(ctx);

    expect(receivedCode).toBe(2304);
    expect(receivedMessage).toBe("Cannot find name 'foo'");
  });

  it("builder can access files with errors", () => {
    let receivedFiles: Set<string> | undefined;

    const filesBuilder = createMockBuilder("files-checker", {
      matches: (ctx) => {
        receivedFiles = ctx.filesWithErrors;
        return true;
      },
    });
    registry.register(filesBuilder);

    const filesWithErrors = new Set(["/a.ts", "/b.ts"]);
    const diagnostic = createMockDiagnostic(2304, "Error");
    const ctx = createBuilderContext(diagnostic, host, filesWithErrors, [
      diagnostic,
    ]);
    registry.getMatchingBuilders(ctx);

    expect(receivedFiles).toBe(filesWithErrors);
    expect(receivedFiles?.has("/a.ts")).toBe(true);
    expect(receivedFiles?.has("/b.ts")).toBe(true);
  });

  it("builder can generate candidates with risk hints", () => {
    const riskyBuilder = createMockBuilder("risky", {
      generate: () => [
        createSyntheticFix(
          "risky-fix",
          "A risky fix",
          [{ file: "/test.ts", start: 0, end: 0, newText: "// fix" }],
          { riskHint: "high" }
        ),
      ],
    });
    registry.register(riskyBuilder);

    const diagnostic = createMockDiagnostic(1, "Error");
    const ctx = createBuilderContext(diagnostic, host, new Set(), [diagnostic]);
    const candidates = registry.generateCandidates(ctx);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].riskHint).toBe("high");
  });

  it("builder can generate candidates with scope hints", () => {
    const wideBuilder = createMockBuilder("wide", {
      generate: () => [
        createSyntheticFix(
          "wide-fix",
          "A structural fix",
          [{ file: "/test.ts", start: 0, end: 0, newText: "// fix" }],
          { scopeHint: "wide" }
        ),
      ],
    });
    registry.register(wideBuilder);

    const diagnostic = createMockDiagnostic(1, "Error");
    const ctx = createBuilderContext(diagnostic, host, new Set(), [diagnostic]);
    const candidates = registry.generateCandidates(ctx);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].scopeHint).toBe("wide");
  });

  it("builder can access compiler options", () => {
    let receivedOptions: ts.CompilerOptions | undefined;

    const optionsBuilder = createMockBuilder("options-checker", {
      matches: (ctx) => {
        receivedOptions = ctx.compilerOptions;
        return true;
      },
    });
    registry.register(optionsBuilder);

    const diagnostic = createMockDiagnostic(2304, "Error");
    const ctx = createBuilderContext(diagnostic, host, new Set(), [diagnostic]);
    registry.getMatchingBuilders(ctx);

    expect(receivedOptions).toBeDefined();
    // The fixture should have strict mode enabled
    expect(receivedOptions?.strict).toBe(true);
  });
});
