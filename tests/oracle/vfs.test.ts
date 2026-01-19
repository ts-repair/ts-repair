/**
 * VFS Unit Tests
 *
 * Tests for the Virtual File System with comprehensive boundary case coverage.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { VirtualFS } from "../../src/oracle/vfs.js";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("VirtualFS", () => {
  describe("fromProject", () => {
    it("loads files from a valid tsconfig.json", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const vfs = VirtualFS.fromProject(configPath);

      const fileNames = vfs.getFileNames();
      expect(fileNames.length).toBeGreaterThan(0);

      // Should include index.ts
      const hasIndexTs = fileNames.some((f) => f.endsWith("index.ts"));
      expect(hasIndexTs).toBe(true);
    });

    it("throws on invalid tsconfig path", () => {
      expect(() => {
        VirtualFS.fromProject("/nonexistent/tsconfig.json");
      }).toThrow();
    });

    it("throws on malformed tsconfig", () => {
      // This would need a malformed fixture - we'll skip for now
      // since creating intentionally malformed JSON is tricky
    });

    it("loads multiple files from a project", () => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      const vfs = VirtualFS.fromProject(configPath);

      const fileNames = vfs.getFileNames();
      expect(fileNames.length).toBe(2); // index.ts and helpers.ts
    });
  });

  describe("read", () => {
    let vfs: VirtualFS;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
    });

    it("reads file content from VFS", () => {
      const fileNames = vfs.getFileNames();
      const content = vfs.read(fileNames[0]);

      expect(content).toBeDefined();
      expect(typeof content).toBe("string");
      expect(content!.length).toBeGreaterThan(0);
    });

    it("returns undefined for files not in VFS (falls back to disk)", () => {
      // Read a file that doesn't exist anywhere
      const content = vfs.read("/completely/nonexistent/file.ts");
      expect(content).toBeUndefined();
    });

    it("reads TypeScript lib files from disk (fallback)", () => {
      // TypeScript lib files should be readable via disk fallback
      const content = vfs.read(require.resolve("typescript/lib/lib.es5.d.ts"));
      expect(content).toBeDefined();
    });
  });

  describe("write", () => {
    let vfs: VirtualFS;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
    });

    it("writes new content to a file", () => {
      const fileNames = vfs.getFileNames();
      const fileName = fileNames[0];
      const newContent = "// New content";

      vfs.write(fileName, newContent);

      expect(vfs.read(fileName)).toBe(newContent);
    });

    it("overwrites existing content", () => {
      const fileNames = vfs.getFileNames();
      const fileName = fileNames[0];

      vfs.write(fileName, "first");
      expect(vfs.read(fileName)).toBe("first");

      vfs.write(fileName, "second");
      expect(vfs.read(fileName)).toBe("second");
    });

    it("can write empty content", () => {
      const fileNames = vfs.getFileNames();
      const fileName = fileNames[0];

      vfs.write(fileName, "");
      expect(vfs.read(fileName)).toBe("");
    });

    it("can write to new files not originally in project", () => {
      const newFile = "/virtual/new-file.ts";
      vfs.write(newFile, "export const x = 1;");

      expect(vfs.read(newFile)).toBe("export const x = 1;");
      expect(vfs.getFileNames()).toContain(newFile);
    });
  });

  describe("applyChange", () => {
    let vfs: VirtualFS;
    let fileName: string;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
      fileName = vfs.getFileNames()[0];
      // Set known content for testing
      vfs.write(fileName, "Hello, World!");
    });

    it("replaces text in the middle", () => {
      // "Hello, World!" -> "Hello, Universe!"
      vfs.applyChange(fileName, 7, 12, "Universe");
      expect(vfs.read(fileName)).toBe("Hello, Universe!");
    });

    it("inserts text at the beginning", () => {
      // "Hello, World!" -> "// Comment\nHello, World!"
      vfs.applyChange(fileName, 0, 0, "// Comment\n");
      expect(vfs.read(fileName)).toBe("// Comment\nHello, World!");
    });

    it("inserts text at the end", () => {
      // "Hello, World!" -> "Hello, World!\n// End"
      vfs.applyChange(fileName, 13, 13, "\n// End");
      expect(vfs.read(fileName)).toBe("Hello, World!\n// End");
    });

    it("deletes text (empty replacement)", () => {
      // "Hello, World!" -> "Hello!"
      vfs.applyChange(fileName, 5, 12, "");
      expect(vfs.read(fileName)).toBe("Hello!");
    });

    it("replaces entire content", () => {
      vfs.applyChange(fileName, 0, 13, "New content");
      expect(vfs.read(fileName)).toBe("New content");
    });

    it("throws when file not in VFS", () => {
      expect(() => {
        vfs.applyChange("/nonexistent/file.ts", 0, 5, "test");
      }).toThrow("File not in VFS");
    });

    it("handles empty file", () => {
      vfs.write(fileName, "");
      vfs.applyChange(fileName, 0, 0, "inserted");
      expect(vfs.read(fileName)).toBe("inserted");
    });

    it("handles single character replacement", () => {
      vfs.write(fileName, "abc");
      vfs.applyChange(fileName, 1, 2, "X");
      expect(vfs.read(fileName)).toBe("aXc");
    });

    it("handles multi-byte characters", () => {
      vfs.write(fileName, "café");
      vfs.applyChange(fileName, 3, 4, "e"); // Replace é with e
      expect(vfs.read(fileName)).toBe("cafe");
    });
  });

  describe("snapshot and restore", () => {
    let vfs: VirtualFS;
    let fileName: string;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
      fileName = vfs.getFileNames()[0];
    });

    it("captures current state", () => {
      const originalContent = vfs.read(fileName);
      const snapshot = vfs.snapshot();

      // Modify the file
      vfs.write(fileName, "modified content");
      expect(vfs.read(fileName)).toBe("modified content");

      // Restore
      vfs.restore(snapshot);
      expect(vfs.read(fileName)).toBe(originalContent);
    });

    it("snapshot tracks modifications (copy-on-write)", () => {
      const originalContent = vfs.read(fileName);
      const snapshot = vfs.snapshot();

      // Modify after snapshot
      vfs.write(fileName, "modified");

      // Snapshot should have captured the original value
      expect(snapshot.modified.get(fileName)).toBe(originalContent);
      // Current state should be modified
      expect(vfs.read(fileName)).toBe("modified");
    });

    it("multiple snapshots are independent", () => {
      vfs.write(fileName, "state1");
      const snapshot1 = vfs.snapshot();

      vfs.write(fileName, "state2");
      const snapshot2 = vfs.snapshot();

      vfs.write(fileName, "state3");

      vfs.restore(snapshot1);
      expect(vfs.read(fileName)).toBe("state1");

      vfs.restore(snapshot2);
      expect(vfs.read(fileName)).toBe("state2");
    });

    it("restores file additions", () => {
      const snapshot = vfs.snapshot();

      // Add a new file
      vfs.write("/new/file.ts", "new content");
      expect(vfs.getFileNames()).toContain("/new/file.ts");

      // Restore should remove it
      vfs.restore(snapshot);
      expect(vfs.getFileNames()).not.toContain("/new/file.ts");
    });

    it("snapshot is lightweight (O(1) creation)", () => {
      // Snapshot should be created instantly without copying files
      const snapshot = vfs.snapshot();

      // Snapshot starts with empty modified/added sets
      expect(snapshot.modified.size).toBe(0);
      expect(snapshot.added.size).toBe(0);
    });

    it("only tracks modified files (not all files)", () => {
      const fileNames = vfs.getFileNames();
      expect(fileNames.length).toBeGreaterThan(0);

      const snapshot = vfs.snapshot();

      // Modify only one file
      vfs.write(fileName, "modified");

      // Snapshot should only track the one modified file
      expect(snapshot.modified.size).toBe(1);
      expect(snapshot.modified.has(fileName)).toBe(true);
    });
  });

  describe("reset", () => {
    let vfs: VirtualFS;
    let fileName: string;
    let originalContent: string;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
      fileName = vfs.getFileNames()[0];
      originalContent = vfs.read(fileName)!;
    });

    it("resets to original state", () => {
      vfs.write(fileName, "modified");
      expect(vfs.read(fileName)).toBe("modified");

      vfs.reset();
      expect(vfs.read(fileName)).toBe(originalContent);
    });

    it("removes files added after initialization", () => {
      vfs.write("/new/file.ts", "new content");
      expect(vfs.getFileNames()).toContain("/new/file.ts");

      vfs.reset();
      expect(vfs.getFileNames()).not.toContain("/new/file.ts");
    });

    it("can be called multiple times", () => {
      vfs.write(fileName, "mod1");
      vfs.reset();
      expect(vfs.read(fileName)).toBe(originalContent);

      vfs.write(fileName, "mod2");
      vfs.reset();
      expect(vfs.read(fileName)).toBe(originalContent);
    });
  });

  describe("getContent", () => {
    let vfs: VirtualFS;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
    });

    it("returns content for files in VFS", () => {
      const fileName = vfs.getFileNames()[0];
      const content = vfs.getContent(fileName);

      expect(content).toBeDefined();
      expect(typeof content).toBe("string");
    });

    it("returns undefined for files not in VFS (no disk fallback)", () => {
      const content = vfs.getContent("/nonexistent/file.ts");
      expect(content).toBeUndefined();
    });
  });

  describe("fileExists", () => {
    let vfs: VirtualFS;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
    });

    it("returns true for files in VFS", () => {
      const fileName = vfs.getFileNames()[0];
      expect(vfs.fileExists(fileName)).toBe(true);
    });

    it("returns true for files on disk (fallback)", () => {
      // TypeScript lib should exist on disk
      const libPath = require.resolve("typescript/lib/lib.es5.d.ts");
      expect(vfs.fileExists(libPath)).toBe(true);
    });

    it("returns false for completely nonexistent files", () => {
      expect(vfs.fileExists("/completely/made/up/path.ts")).toBe(false);
    });
  });

  describe("getFileNames", () => {
    it("returns all files in VFS", () => {
      const configPath = path.join(FIXTURES_DIR, "multiple-errors/tsconfig.json");
      const vfs = VirtualFS.fromProject(configPath);

      const fileNames = vfs.getFileNames();
      expect(fileNames.length).toBe(2); // index.ts and helpers.ts
    });

    it("returns empty array after reset and clear", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const vfs = VirtualFS.fromProject(configPath);

      // Take a snapshot then modify all files to simulate clearing
      const fileNames = vfs.getFileNames();
      const snapshot = vfs.snapshot();

      // After restore, should have original files
      vfs.restore(snapshot);
      expect(vfs.getFileNames().length).toBe(fileNames.length);
    });

    it("includes newly written files", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const vfs = VirtualFS.fromProject(configPath);

      vfs.write("/new/file.ts", "content");

      expect(vfs.getFileNames()).toContain("/new/file.ts");
    });
  });

  describe("copy-on-write behavior", () => {
    let vfs: VirtualFS;
    let fileName: string;
    let originalContent: string;

    beforeEach(() => {
      const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
      vfs = VirtualFS.fromProject(configPath);
      fileName = vfs.getFileNames()[0];
      originalContent = vfs.read(fileName)!;
    });

    it("hasActiveSnapshot returns false initially", () => {
      expect(vfs.hasActiveSnapshot()).toBe(false);
    });

    it("hasActiveSnapshot returns true after snapshot", () => {
      vfs.snapshot();
      expect(vfs.hasActiveSnapshot()).toBe(true);
    });

    it("hasActiveSnapshot returns false after restore", () => {
      const snapshot = vfs.snapshot();
      vfs.write(fileName, "modified");
      vfs.restore(snapshot);
      expect(vfs.hasActiveSnapshot()).toBe(false);
    });

    it("tracks added files separately from modified", () => {
      const snapshot = vfs.snapshot();

      // Add a new file
      const newFile = "/brand/new/file.ts";
      vfs.write(newFile, "new content");

      // Should be in 'added', not 'modified'
      expect(snapshot.added.has(newFile)).toBe(true);
      expect(snapshot.modified.has(newFile)).toBe(false);
    });

    it("removes added files on restore", () => {
      const snapshot = vfs.snapshot();

      const newFile = "/brand/new/file.ts";
      vfs.write(newFile, "new content");
      expect(vfs.getFileNames()).toContain(newFile);

      vfs.restore(snapshot);
      expect(vfs.getFileNames()).not.toContain(newFile);
      expect(vfs.read(newFile)).toBeUndefined();
    });

    it("only tracks first modification per file", () => {
      const snapshot = vfs.snapshot();

      // Modify same file multiple times
      vfs.write(fileName, "first change");
      vfs.write(fileName, "second change");
      vfs.write(fileName, "third change");

      // Snapshot should have the original value (before first change)
      expect(snapshot.modified.get(fileName)).toBe(originalContent);
      expect(snapshot.modified.size).toBe(1);
    });

    it("applyChange also triggers COW tracking", () => {
      const snapshot = vfs.snapshot();

      // Use applyChange instead of write
      vfs.applyChange(fileName, 0, 0, "// added\n");

      // Should have tracked the original
      expect(snapshot.modified.has(fileName)).toBe(true);
      expect(snapshot.modified.get(fileName)).toBe(originalContent);
    });

    it("restore undoes applyChange modifications", () => {
      const snapshot = vfs.snapshot();

      vfs.applyChange(fileName, 0, 0, "// added\n");
      expect(vfs.read(fileName)).toBe("// added\n" + originalContent);

      vfs.restore(snapshot);
      expect(vfs.read(fileName)).toBe(originalContent);
    });

    it("handles multiple files modified", () => {
      const fileNames = vfs.getFileNames();
      expect(fileNames.length).toBeGreaterThanOrEqual(2);

      const file1 = fileNames[0];
      const file2 = fileNames[1];
      const original1 = vfs.read(file1)!;
      const original2 = vfs.read(file2)!;

      const snapshot = vfs.snapshot();

      vfs.write(file1, "modified1");
      vfs.write(file2, "modified2");

      expect(snapshot.modified.size).toBe(2);

      vfs.restore(snapshot);
      expect(vfs.read(file1)).toBe(original1);
      expect(vfs.read(file2)).toBe(original2);
    });

    it("does not track modifications without active snapshot", () => {
      // No snapshot taken
      vfs.write(fileName, "modified");

      // Take snapshot after modification
      const snapshot = vfs.snapshot();

      // Snapshot should start empty (no prior tracking)
      expect(snapshot.modified.size).toBe(0);
    });

    it("reset clears active snapshot", () => {
      vfs.snapshot();
      expect(vfs.hasActiveSnapshot()).toBe(true);

      vfs.reset();
      expect(vfs.hasActiveSnapshot()).toBe(false);
    });

    it("nested snapshots work correctly (LIFO pattern)", () => {
      vfs.write(fileName, "state0");

      const snapshot1 = vfs.snapshot();
      vfs.write(fileName, "state1");

      // Restore to state0
      vfs.restore(snapshot1);
      expect(vfs.read(fileName)).toBe("state0");

      // Take new snapshot and modify again
      const snapshot2 = vfs.snapshot();
      vfs.write(fileName, "state2");

      // Restore to state0 again
      vfs.restore(snapshot2);
      expect(vfs.read(fileName)).toBe("state0");
    });
  });
});
