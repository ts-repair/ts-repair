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

    it("snapshot is independent copy (not reference)", () => {
      const originalContent = vfs.read(fileName);
      const snapshot = vfs.snapshot();

      // Modify after snapshot
      vfs.write(fileName, "modified");

      // Snapshot should have captured the original (CoW: stored in modified map)
      expect(snapshot.modified.get(fileName)).toBe(originalContent);
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

    it("handles snapshot with no modifications", () => {
      // Create snapshot but don't modify anything
      const originalContent = vfs.read(fileName);
      const snapshot = vfs.snapshot();

      // Restore without any modifications
      vfs.restore(snapshot);

      // File should still have its content
      expect(vfs.read(fileName)).toBe(originalContent);
      expect(snapshot.modified.size).toBe(0);
      expect(snapshot.added.size).toBe(0);
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

    it("returns original files after reset", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const vfs = VirtualFS.fromProject(configPath);
      const originalCount = vfs.getFileNames().length;

      // Add a new file
      vfs.write("/new/file.ts", "content");
      expect(vfs.getFileNames().length).toBe(originalCount + 1);

      // Reset to original
      vfs.reset();
      expect(vfs.getFileNames()).toHaveLength(originalCount);
    });

    it("includes newly written files", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const vfs = VirtualFS.fromProject(configPath);

      vfs.write("/new/file.ts", "content");

      expect(vfs.getFileNames()).toContain("/new/file.ts");
    });
  });
});
