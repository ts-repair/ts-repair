/**
 * Candidate Fix Unit Tests
 *
 * Tests for the CandidateFix abstraction and helper functions.
 */

import { describe, it, expect } from "bun:test";
import ts from "typescript";
import {
  fromCodeFixAction,
  createSyntheticCandidate,
  getFixName,
  getDescription,
  getScopeHint,
  getRiskHint,
  getTags,
  candidateToChanges,
  getModifiedFiles,
  computeCandidateEditSize,
  candidatesConflict,
  type CandidateFix,
  type TsCodeFixCandidate,
  type SyntheticCandidate,
} from "../../src/oracle/candidate.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockCodeFixAction(
  fixName: string,
  description: string,
  changes: { fileName: string; start: number; length: number; newText: string }[]
): ts.CodeFixAction {
  return {
    fixName,
    description,
    changes: changes.map((c) => ({
      fileName: c.fileName,
      textChanges: [
        {
          span: { start: c.start, length: c.length },
          newText: c.newText,
        },
      ],
    })),
  } as ts.CodeFixAction;
}

// ============================================================================
// fromCodeFixAction
// ============================================================================

describe("fromCodeFixAction", () => {
  it("wraps a CodeFixAction as TsCodeFixCandidate", () => {
    const action = createMockCodeFixAction("import", "Add import", [
      { fileName: "/test.ts", start: 0, length: 0, newText: "import { foo } from './foo';\n" },
    ]);

    const candidate = fromCodeFixAction(action);

    expect(candidate.kind).toBe("tsCodeFix");
    expect(candidate.fixName).toBe("import");
    expect(candidate.description).toBe("Add import");
    expect(candidate.action).toBe(action);
    expect(candidate.scopeHint).toBeUndefined();
    expect(candidate.riskHint).toBeUndefined();
    expect(candidate.tags).toBeUndefined();
  });

  it("accepts optional scopeHint", () => {
    const action = createMockCodeFixAction("fixOverload", "Widen overload", [
      { fileName: "/types.ts", start: 100, length: 50, newText: "overload..." },
    ]);

    const candidate = fromCodeFixAction(action, { scopeHint: "errors" });

    expect(candidate.scopeHint).toBe("errors");
  });

  it("accepts optional riskHint", () => {
    const action = createMockCodeFixAction("addAssertion", "Add type assertion", [
      { fileName: "/test.ts", start: 50, length: 10, newText: "as Foo" },
    ]);

    const candidate = fromCodeFixAction(action, { riskHint: "high" });

    expect(candidate.riskHint).toBe("high");
  });

  it("accepts optional tags", () => {
    const action = createMockCodeFixAction("import", "Add import", [
      { fileName: "/test.ts", start: 0, length: 0, newText: "import..." },
    ]);

    const candidate = fromCodeFixAction(action, { tags: ["lexical", "import"] });

    expect(candidate.tags).toEqual(["lexical", "import"]);
  });
});

// ============================================================================
// createSyntheticCandidate
// ============================================================================

describe("createSyntheticCandidate", () => {
  it("creates a SyntheticCandidate with defaults", () => {
    const changes = [
      { file: "/types.ts", start: 100, end: 150, newText: "T extends string" },
    ];

    const candidate = createSyntheticCandidate(
      "widenConstraint",
      "Widen generic constraint",
      changes
    );

    expect(candidate.kind).toBe("synthetic");
    expect(candidate.fixName).toBe("widenConstraint");
    expect(candidate.description).toBe("Widen generic constraint");
    expect(candidate.changes).toBe(changes);
    expect(candidate.scopeHint).toBe("errors"); // default for synthetic
    expect(candidate.riskHint).toBe("high"); // default for synthetic
  });

  it("accepts custom options", () => {
    const changes = [
      { file: "/config.ts", start: 0, end: 20, newText: '"module": "ESNext"' },
    ];

    const candidate = createSyntheticCandidate(
      "fixModuleConfig",
      "Fix module config",
      changes,
      {
        scopeHint: "wide",
        riskHint: "medium",
        tags: ["config"],
        metadata: { originalValue: "CommonJS" },
      }
    );

    expect(candidate.scopeHint).toBe("wide");
    expect(candidate.riskHint).toBe("medium");
    expect(candidate.tags).toEqual(["config"]);
    expect(candidate.metadata).toEqual({ originalValue: "CommonJS" });
  });
});

// ============================================================================
// Candidate Accessors
// ============================================================================

describe("Candidate Accessors", () => {
  const tsCandidate: TsCodeFixCandidate = {
    kind: "tsCodeFix",
    fixName: "import",
    description: "Add import from foo",
    action: createMockCodeFixAction("import", "Add import from foo", [
      { fileName: "/test.ts", start: 0, length: 0, newText: "import { foo } from 'foo';\n" },
    ]),
    scopeHint: "modified",
    riskHint: "low",
    tags: ["import"],
  };

  const syntheticCandidate: SyntheticCandidate = {
    kind: "synthetic",
    fixName: "widenOverload",
    description: "Widen overload parameter",
    changes: [{ file: "/types.ts", start: 100, end: 150, newText: "param: unknown" }],
    scopeHint: "errors",
    riskHint: "high",
    tags: ["structural"],
  };

  describe("getFixName", () => {
    it("returns fixName for TsCodeFixCandidate", () => {
      expect(getFixName(tsCandidate)).toBe("import");
    });

    it("returns fixName for SyntheticCandidate", () => {
      expect(getFixName(syntheticCandidate)).toBe("widenOverload");
    });
  });

  describe("getDescription", () => {
    it("returns description for TsCodeFixCandidate", () => {
      expect(getDescription(tsCandidate)).toBe("Add import from foo");
    });

    it("returns description for SyntheticCandidate", () => {
      expect(getDescription(syntheticCandidate)).toBe("Widen overload parameter");
    });
  });

  describe("getScopeHint", () => {
    it("returns scopeHint for candidate with hint", () => {
      expect(getScopeHint(tsCandidate)).toBe("modified");
      expect(getScopeHint(syntheticCandidate)).toBe("errors");
    });

    it("returns 'modified' as default", () => {
      const candidate = fromCodeFixAction(
        createMockCodeFixAction("test", "test", [])
      );
      expect(getScopeHint(candidate)).toBe("modified");
    });
  });

  describe("getRiskHint", () => {
    it("returns riskHint for candidate with hint", () => {
      expect(getRiskHint(tsCandidate)).toBe("low");
      expect(getRiskHint(syntheticCandidate)).toBe("high");
    });

    it("returns undefined for candidate without hint", () => {
      const candidate = fromCodeFixAction(
        createMockCodeFixAction("test", "test", [])
      );
      expect(getRiskHint(candidate)).toBeUndefined();
    });
  });

  describe("getTags", () => {
    it("returns tags for candidate with tags", () => {
      expect(getTags(tsCandidate)).toEqual(["import"]);
      expect(getTags(syntheticCandidate)).toEqual(["structural"]);
    });

    it("returns empty array for candidate without tags", () => {
      const candidate = fromCodeFixAction(
        createMockCodeFixAction("test", "test", [])
      );
      expect(getTags(candidate)).toEqual([]);
    });
  });
});

// ============================================================================
// candidateToChanges
// ============================================================================

describe("candidateToChanges", () => {
  it("extracts FileChange[] from TsCodeFixCandidate", () => {
    const action = createMockCodeFixAction("import", "Add import", [
      { fileName: "/test.ts", start: 0, length: 0, newText: "import { foo } from 'foo';\n" },
      { fileName: "/test.ts", start: 100, length: 5, newText: "newValue" },
    ]);
    const candidate = fromCodeFixAction(action);

    const changes = candidateToChanges(candidate);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      file: "/test.ts",
      start: 0,
      end: 0,
      newText: "import { foo } from 'foo';\n",
    });
    expect(changes[1]).toEqual({
      file: "/test.ts",
      start: 100,
      end: 105,
      newText: "newValue",
    });
  });

  it("extracts FileChange[] from SyntheticCandidate", () => {
    const syntheticChanges = [
      { file: "/types.ts", start: 100, end: 150, newText: "T extends string" },
      { file: "/index.ts", start: 0, end: 10, newText: "// comment" },
    ];
    const candidate = createSyntheticCandidate("test", "test", syntheticChanges);

    const changes = candidateToChanges(candidate);

    expect(changes).toBe(syntheticChanges); // Same reference for synthetic
  });
});

// ============================================================================
// getModifiedFiles
// ============================================================================

describe("getModifiedFiles", () => {
  it("returns modified files for TsCodeFixCandidate", () => {
    const action = createMockCodeFixAction("import", "Add import", [
      { fileName: "/test.ts", start: 0, length: 0, newText: "import..." },
      { fileName: "/other.ts", start: 50, length: 10, newText: "foo" },
    ]);
    const candidate = fromCodeFixAction(action);

    const files = getModifiedFiles(candidate);

    expect(files.size).toBe(2);
    expect(files.has("/test.ts")).toBe(true);
    expect(files.has("/other.ts")).toBe(true);
  });

  it("returns modified files for SyntheticCandidate", () => {
    const candidate = createSyntheticCandidate("test", "test", [
      { file: "/a.ts", start: 0, end: 10, newText: "a" },
      { file: "/b.ts", start: 0, end: 10, newText: "b" },
      { file: "/a.ts", start: 20, end: 30, newText: "c" }, // duplicate file
    ]);

    const files = getModifiedFiles(candidate);

    expect(files.size).toBe(2);
    expect(files.has("/a.ts")).toBe(true);
    expect(files.has("/b.ts")).toBe(true);
  });

  it("returns empty set for empty changes", () => {
    const candidate = createSyntheticCandidate("test", "test", []);
    const files = getModifiedFiles(candidate);
    expect(files.size).toBe(0);
  });
});

// ============================================================================
// computeCandidateEditSize
// ============================================================================

describe("computeCandidateEditSize", () => {
  it("computes edit size for TsCodeFixCandidate", () => {
    const action = createMockCodeFixAction("test", "test", [
      { fileName: "/test.ts", start: 0, length: 5, newText: "hello" }, // 5 + 5 = 10
      { fileName: "/test.ts", start: 100, length: 3, newText: "world" }, // 3 + 5 = 8
    ]);
    const candidate = fromCodeFixAction(action);

    const size = computeCandidateEditSize(candidate);

    expect(size).toBe(18); // 10 + 8
  });

  it("computes edit size for SyntheticCandidate", () => {
    const candidate = createSyntheticCandidate("test", "test", [
      { file: "/a.ts", start: 0, end: 10, newText: "hello" }, // 10 + 5 = 15
      { file: "/b.ts", start: 5, end: 5, newText: "insert" }, // 0 + 6 = 6
    ]);

    const size = computeCandidateEditSize(candidate);

    expect(size).toBe(21); // 15 + 6
  });

  it("returns 0 for empty changes", () => {
    const candidate = createSyntheticCandidate("test", "test", []);
    expect(computeCandidateEditSize(candidate)).toBe(0);
  });
});

// ============================================================================
// candidatesConflict
// ============================================================================

describe("candidatesConflict", () => {
  it("returns true for overlapping ranges in same file", () => {
    const a = createSyntheticCandidate("a", "a", [
      { file: "/test.ts", start: 10, end: 20, newText: "aaa" },
    ]);
    const b = createSyntheticCandidate("b", "b", [
      { file: "/test.ts", start: 15, end: 25, newText: "bbb" },
    ]);

    expect(candidatesConflict(a, b)).toBe(true);
  });

  it("returns false for non-overlapping ranges in same file", () => {
    const a = createSyntheticCandidate("a", "a", [
      { file: "/test.ts", start: 10, end: 20, newText: "aaa" },
    ]);
    const b = createSyntheticCandidate("b", "b", [
      { file: "/test.ts", start: 30, end: 40, newText: "bbb" },
    ]);

    expect(candidatesConflict(a, b)).toBe(false);
  });

  it("returns false for ranges in different files", () => {
    const a = createSyntheticCandidate("a", "a", [
      { file: "/a.ts", start: 10, end: 20, newText: "aaa" },
    ]);
    const b = createSyntheticCandidate("b", "b", [
      { file: "/b.ts", start: 10, end: 20, newText: "bbb" },
    ]);

    expect(candidatesConflict(a, b)).toBe(false);
  });

  it("handles adjacent ranges (non-overlapping)", () => {
    const a = createSyntheticCandidate("a", "a", [
      { file: "/test.ts", start: 10, end: 20, newText: "aaa" },
    ]);
    const b = createSyntheticCandidate("b", "b", [
      { file: "/test.ts", start: 20, end: 30, newText: "bbb" },
    ]);

    expect(candidatesConflict(a, b)).toBe(false);
  });

  it("handles zero-length insertions at same position", () => {
    const a = createSyntheticCandidate("a", "a", [
      { file: "/test.ts", start: 10, end: 10, newText: "aaa" },
    ]);
    const b = createSyntheticCandidate("b", "b", [
      { file: "/test.ts", start: 10, end: 10, newText: "bbb" },
    ]);

    // Zero-length spans are normalized to length 1 for overlap detection
    expect(candidatesConflict(a, b)).toBe(true);
  });

  it("handles insertion inside existing range", () => {
    const a = createSyntheticCandidate("a", "a", [
      { file: "/test.ts", start: 10, end: 30, newText: "aaa" },
    ]);
    const b = createSyntheticCandidate("b", "b", [
      { file: "/test.ts", start: 15, end: 15, newText: "bbb" },
    ]);

    expect(candidatesConflict(a, b)).toBe(true);
  });

  it("returns false for empty candidates", () => {
    const a = createSyntheticCandidate("a", "a", []);
    const b = createSyntheticCandidate("b", "b", []);

    expect(candidatesConflict(a, b)).toBe(false);
  });

  it("handles multiple changes per candidate", () => {
    const a = createSyntheticCandidate("a", "a", [
      { file: "/test.ts", start: 10, end: 20, newText: "a1" },
      { file: "/test.ts", start: 100, end: 110, newText: "a2" },
    ]);
    const b = createSyntheticCandidate("b", "b", [
      { file: "/test.ts", start: 50, end: 60, newText: "b1" },
      { file: "/test.ts", start: 105, end: 115, newText: "b2" }, // overlaps with a2
    ]);

    expect(candidatesConflict(a, b)).toBe(true);
  });
});
