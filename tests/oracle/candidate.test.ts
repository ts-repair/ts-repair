/**
 * Candidate Abstraction Unit Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  wrapTsCodeFix,
  createSyntheticFix,
  getFilesModified,
  getChanges,
  applyCandidate,
  normalizeEdits,
  computeCandidateEditSize,
  getCandidateKey,
  candidatesEqual,
  deduplicateCandidates,
} from "../../src/oracle/candidate.js";
import { VirtualFS } from "../../src/oracle/vfs.js";
import type { CandidateFix, FileChange } from "../../src/output/types.js";
import type ts from "typescript";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("candidate abstraction", () => {
  describe("wrapTsCodeFix", () => {
    it("creates correct structure for a TypeScript code fix", () => {
      const mockAction = {
        fixName: "import",
        description: "Add import from 'lodash'",
        changes: [
          {
            fileName: "/test/file.ts",
            textChanges: [
              {
                span: { start: 0, length: 0 },
                newText: "import { map } from 'lodash';\n",
              },
            ],
          },
        ],
      } as unknown as ts.CodeFixAction;

      const candidate = wrapTsCodeFix(mockAction, "low");

      expect(candidate.kind).toBe("tsCodeFix");
      expect(candidate.fixName).toBe("import");
      expect(candidate.description).toBe("Add import from 'lodash'");
      expect(candidate.riskHint).toBe("low");
      if (candidate.kind === "tsCodeFix") {
        expect(candidate.action).toBe(mockAction);
      }
    });

    it("creates candidate without risk hint", () => {
      const mockAction = {
        fixName: "fixSpelling",
        description: "Change spelling",
        changes: [],
      } as unknown as ts.CodeFixAction;

      const candidate = wrapTsCodeFix(mockAction);

      expect(candidate.riskHint).toBeUndefined();
    });
  });

  describe("createSyntheticFix", () => {
    it("creates correct structure for a synthetic fix", () => {
      const changes: FileChange[] = [
        { file: "/test/file.ts", start: 10, end: 20, newText: "newCode" },
      ];

      const candidate = createSyntheticFix(
        "widenType",
        "Widen parameter type to unknown",
        changes,
        {
          scopeHint: "errors",
          riskHint: "high",
          tags: ["structural"],
          metadata: { originalType: "string" },
        }
      );

      expect(candidate.kind).toBe("synthetic");
      expect(candidate.fixName).toBe("widenType");
      expect(candidate.description).toBe("Widen parameter type to unknown");
      expect(candidate.scopeHint).toBe("errors");
      expect(candidate.riskHint).toBe("high");
      expect(candidate.tags).toEqual(["structural"]);
      if (candidate.kind === "synthetic") {
        expect(candidate.changes).toEqual(changes);
        expect(candidate.metadata).toEqual({ originalType: "string" });
      }
    });

    it("creates candidate without optional fields", () => {
      const changes: FileChange[] = [];
      const candidate = createSyntheticFix("test", "Test fix", changes);

      expect(candidate.kind).toBe("synthetic");
      expect(candidate.scopeHint).toBeUndefined();
      expect(candidate.riskHint).toBeUndefined();
    });
  });

  describe("getFilesModified", () => {
    it("extracts files from tsCodeFix candidate", () => {
      const mockAction = {
        fixName: "import",
        description: "Add import",
        changes: [
          { fileName: "/test/a.ts", textChanges: [] },
          { fileName: "/test/b.ts", textChanges: [] },
          { fileName: "/test/a.ts", textChanges: [] }, // Duplicate
        ],
      } as unknown as ts.CodeFixAction;

      const candidate = wrapTsCodeFix(mockAction);
      const files = getFilesModified(candidate);

      expect(files.size).toBe(2);
      expect(files.has("/test/a.ts")).toBe(true);
      expect(files.has("/test/b.ts")).toBe(true);
    });

    it("extracts files from synthetic candidate", () => {
      const candidate = createSyntheticFix("test", "Test", [
        { file: "/test/x.ts", start: 0, end: 0, newText: "" },
        { file: "/test/y.ts", start: 0, end: 0, newText: "" },
      ]);

      const files = getFilesModified(candidate);

      expect(files.size).toBe(2);
      expect(files.has("/test/x.ts")).toBe(true);
      expect(files.has("/test/y.ts")).toBe(true);
    });

    it("returns empty set for candidate with no changes", () => {
      const candidate = createSyntheticFix("test", "Test", []);
      const files = getFilesModified(candidate);

      expect(files.size).toBe(0);
    });
  });

  describe("getChanges", () => {
    it("extracts FileChange array from tsCodeFix", () => {
      const mockAction = {
        fixName: "import",
        description: "Add import",
        changes: [
          {
            fileName: "/test/file.ts",
            textChanges: [
              { span: { start: 0, length: 0 }, newText: "import x;\n" },
              { span: { start: 100, length: 5 }, newText: "newCode" },
            ],
          },
        ],
      } as unknown as ts.CodeFixAction;

      const candidate = wrapTsCodeFix(mockAction);
      const changes = getChanges(candidate);

      expect(changes).toHaveLength(2);
      expect(changes[0]).toEqual({
        file: "/test/file.ts",
        start: 0,
        end: 0,
        newText: "import x;\n",
      });
      expect(changes[1]).toEqual({
        file: "/test/file.ts",
        start: 100,
        end: 105,
        newText: "newCode",
      });
    });

    it("returns changes directly from synthetic candidate", () => {
      const originalChanges: FileChange[] = [
        { file: "/test/a.ts", start: 10, end: 20, newText: "x" },
      ];
      const candidate = createSyntheticFix("test", "Test", originalChanges);

      const changes = getChanges(candidate);

      expect(changes).toBe(originalChanges);
    });
  });

  describe("normalizeEdits", () => {
    it("sorts edits by file ascending, then position descending", () => {
      const changes: FileChange[] = [
        { file: "/b.ts", start: 10, end: 15, newText: "b1" },
        { file: "/a.ts", start: 50, end: 60, newText: "a2" },
        { file: "/a.ts", start: 10, end: 20, newText: "a1" },
        { file: "/b.ts", start: 30, end: 35, newText: "b2" },
      ];

      const normalized = normalizeEdits(changes);

      expect(normalized).toHaveLength(4);
      expect(normalized[0].file).toBe("/a.ts");
      expect(normalized[0].start).toBe(50); // Higher position first
      expect(normalized[1].file).toBe("/a.ts");
      expect(normalized[1].start).toBe(10);
      expect(normalized[2].file).toBe("/b.ts");
      expect(normalized[2].start).toBe(30); // Higher position first
      expect(normalized[3].file).toBe("/b.ts");
      expect(normalized[3].start).toBe(10);
    });

    it("returns empty array for empty input", () => {
      const normalized = normalizeEdits([]);
      expect(normalized).toHaveLength(0);
    });

    it("handles single edit", () => {
      const changes: FileChange[] = [
        { file: "/test.ts", start: 5, end: 10, newText: "x" },
      ];

      const normalized = normalizeEdits(changes);

      expect(normalized).toHaveLength(1);
      expect(normalized[0]).toEqual(changes[0]);
    });

    it("filters overlapping edits in same file", () => {
      const changes: FileChange[] = [
        { file: "/test.ts", start: 10, end: 30, newText: "overlap1" },
        { file: "/test.ts", start: 20, end: 40, newText: "overlap2" },
      ];

      const normalized = normalizeEdits(changes);

      // Should keep the first one (higher start after sort descending)
      expect(normalized).toHaveLength(1);
      expect(normalized[0].start).toBe(20);
    });
  });

  describe("applyCandidate", () => {
    let vfs: VirtualFS;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
    });

    it("applies synthetic candidate changes to VFS", () => {
      const fileName = vfs.getFileNames()[0];
      vfs.write(fileName, "const x = 1;\nconst y = 2;");

      const candidate = createSyntheticFix("test", "Test", [
        { file: fileName, start: 0, end: 5, newText: "let" },
      ]);

      applyCandidate(vfs, candidate);

      expect(vfs.read(fileName)).toBe("let x = 1;\nconst y = 2;");
    });

    it("applies multiple changes in correct order", () => {
      const fileName = vfs.getFileNames()[0];
      vfs.write(fileName, "const a = 1; const b = 2;");

      // Changes at positions 13 and 0 - should be applied from end first
      const candidate = createSyntheticFix("test", "Test", [
        { file: fileName, start: 0, end: 5, newText: "let" },
        { file: fileName, start: 13, end: 18, newText: "let" },
      ]);

      applyCandidate(vfs, candidate);

      expect(vfs.read(fileName)).toBe("let a = 1; let b = 2;");
    });
  });

  describe("computeCandidateEditSize", () => {
    it("computes size for synthetic candidate", () => {
      const candidate = createSyntheticFix("test", "Test", [
        { file: "/test.ts", start: 0, end: 10, newText: "hello" },
        { file: "/test.ts", start: 20, end: 25, newText: "world" },
      ]);

      const size = computeCandidateEditSize(candidate);

      // (10 - 0) + 5 + (25 - 20) + 5 = 10 + 5 + 5 + 5 = 25
      expect(size).toBe(25);
    });

    it("returns 0 for empty candidate", () => {
      const candidate = createSyntheticFix("test", "Test", []);
      expect(computeCandidateEditSize(candidate)).toBe(0);
    });
  });

  describe("getCandidateKey", () => {
    it("generates consistent key for same changes", () => {
      const changes: FileChange[] = [
        { file: "/a.ts", start: 10, end: 20, newText: "x" },
        { file: "/b.ts", start: 5, end: 15, newText: "y" },
      ];

      const candidate1 = createSyntheticFix("fix1", "Fix 1", changes);
      const candidate2 = createSyntheticFix("fix1", "Fix 1", [...changes]);

      expect(getCandidateKey(candidate1)).toBe(getCandidateKey(candidate2));
    });

    it("generates different keys for different changes", () => {
      const candidate1 = createSyntheticFix("fix1", "Fix 1", [
        { file: "/a.ts", start: 10, end: 20, newText: "x" },
      ]);
      const candidate2 = createSyntheticFix("fix1", "Fix 1", [
        { file: "/a.ts", start: 10, end: 20, newText: "y" },
      ]);

      expect(getCandidateKey(candidate1)).not.toBe(getCandidateKey(candidate2));
    });

    it("generates different keys for different fix names", () => {
      const changes: FileChange[] = [
        { file: "/a.ts", start: 10, end: 20, newText: "x" },
      ];

      const candidate1 = createSyntheticFix("fix1", "Fix 1", changes);
      const candidate2 = createSyntheticFix("fix2", "Fix 2", changes);

      expect(getCandidateKey(candidate1)).not.toBe(getCandidateKey(candidate2));
    });
  });

  describe("candidatesEqual", () => {
    it("returns true for equivalent candidates", () => {
      const changes: FileChange[] = [
        { file: "/a.ts", start: 10, end: 20, newText: "x" },
      ];

      const candidate1 = createSyntheticFix("fix", "Fix", changes);
      const candidate2 = createSyntheticFix("fix", "Different desc", changes);

      // Note: descriptions don't matter, only fix name and changes
      // Same fixName + same changes = equivalent candidates
      expect(candidatesEqual(candidate1, candidate2)).toBe(true);
    });

    it("returns false for different candidates", () => {
      const candidate1 = createSyntheticFix("fix", "Fix", [
        { file: "/a.ts", start: 10, end: 20, newText: "x" },
      ]);
      const candidate2 = createSyntheticFix("fix", "Fix", [
        { file: "/a.ts", start: 10, end: 20, newText: "y" },
      ]);

      expect(candidatesEqual(candidate1, candidate2)).toBe(false);
    });
  });

  describe("deduplicateCandidates", () => {
    it("removes duplicate candidates", () => {
      const changes: FileChange[] = [
        { file: "/a.ts", start: 10, end: 20, newText: "x" },
      ];

      const candidates: CandidateFix[] = [
        createSyntheticFix("fix", "Fix 1", changes),
        createSyntheticFix("fix", "Fix 2", changes), // Duplicate
        createSyntheticFix("other", "Other", changes),
      ];

      const deduped = deduplicateCandidates(candidates);

      expect(deduped).toHaveLength(2);
      expect(deduped[0].fixName).toBe("fix");
      expect(deduped[1].fixName).toBe("other");
    });

    it("preserves order (keeps first occurrence)", () => {
      const candidates: CandidateFix[] = [
        createSyntheticFix("a", "A", [{ file: "/x.ts", start: 0, end: 0, newText: "1" }]),
        createSyntheticFix("b", "B", [{ file: "/x.ts", start: 0, end: 0, newText: "2" }]),
        createSyntheticFix("a", "A dup", [{ file: "/x.ts", start: 0, end: 0, newText: "1" }]),
      ];

      const deduped = deduplicateCandidates(candidates);

      expect(deduped).toHaveLength(2);
      expect(deduped[0].description).toBe("A"); // First occurrence kept
    });

    it("returns empty array for empty input", () => {
      expect(deduplicateCandidates([])).toHaveLength(0);
    });
  });
});
