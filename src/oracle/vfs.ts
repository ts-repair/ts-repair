/**
 * Virtual File System
 *
 * In-memory file state with copy-on-write snapshot/restore for speculative fix application.
 *
 * Performance optimization: Instead of copying the entire file map on every snapshot,
 * we track only the files that are modified after the snapshot is taken. This reduces
 * snapshot creation from O(n) to O(1) and restore from O(n) to O(modified files).
 */

import ts from "typescript";
import path from "path";

/**
 * A lightweight snapshot that tracks modifications made after it was created.
 *
 * Copy-on-write: Only files that are actually modified get their original
 * values stored in the snapshot. Unmodified files are not copied.
 */
export interface VFSSnapshot {
  /** Original values of files that were modified after this snapshot was taken */
  readonly modified: Map<string, string>;
  /** Files that were added after this snapshot was taken (not present originally) */
  readonly added: Set<string>;
}

export class VirtualFS {
  private files: Map<string, string> = new Map();
  private original: Map<string, string> = new Map();

  /** Currently active snapshot that tracks modifications */
  private activeSnapshot: VFSSnapshot | null = null;

  /**
   * Initialize VFS from a tsconfig.json path
   */
  static fromProject(configPath: string): VirtualFS {
    const vfs = new VirtualFS();

    const absoluteConfigPath = path.resolve(configPath);
    const configFile = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);

    if (configFile.error) {
      throw new Error(
        `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
      );
    }

    const basePath = path.dirname(absoluteConfigPath);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      basePath
    );

    if (parsed.errors.length > 0) {
      const errors = parsed.errors
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n"))
        .join("\n");
      throw new Error(`Failed to parse tsconfig: ${errors}`);
    }

    for (const fileName of parsed.fileNames) {
      const content = ts.sys.readFile(fileName);
      if (content !== undefined) {
        vfs.files.set(fileName, content);
        vfs.original.set(fileName, content);
      }
    }

    return vfs;
  }

  /**
   * Read a file. Returns undefined if not in VFS, falls back to disk.
   */
  read(fileName: string): string | undefined {
    return this.files.get(fileName) ?? ts.sys.readFile(fileName);
  }

  /**
   * Write content to a file in the VFS.
   *
   * If there's an active snapshot, the original value is saved before modifying
   * (copy-on-write semantics).
   */
  write(fileName: string, content: string): void {
    this.trackModification(fileName);
    this.files.set(fileName, content);
  }

  /**
   * Apply a text change to a file.
   *
   * If there's an active snapshot, the original value is saved before modifying
   * (copy-on-write semantics).
   */
  applyChange(fileName: string, start: number, end: number, newText: string): void {
    const content = this.files.get(fileName);
    if (content === undefined) {
      throw new Error(`File not in VFS: ${fileName}`);
    }

    this.trackModification(fileName);

    const before = content.slice(0, start);
    const after = content.slice(end);
    this.files.set(fileName, before + newText + after);
  }

  /**
   * Track a file modification for copy-on-write.
   * Saves the original value before the first modification to each file.
   */
  private trackModification(fileName: string): void {
    if (!this.activeSnapshot) return;

    // Already tracked this file
    if (this.activeSnapshot.modified.has(fileName) ||
        this.activeSnapshot.added.has(fileName)) {
      return;
    }

    const original = this.files.get(fileName);
    if (original !== undefined) {
      // File exists - save its original value
      this.activeSnapshot.modified.set(fileName, original);
    } else {
      // File is new - track it for removal on restore
      this.activeSnapshot.added.add(fileName);
    }
  }

  /**
   * Get all file names in the VFS
   */
  getFileNames(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * Check if a file exists in the VFS or on disk
   */
  fileExists(fileName: string): boolean {
    return this.files.has(fileName) || ts.sys.fileExists(fileName);
  }

  /**
   * Create a copy-on-write snapshot of the current state.
   *
   * This is O(1) - no files are copied. Instead, we start tracking
   * which files are modified after this point.
   *
   * @returns A lightweight snapshot object
   */
  snapshot(): VFSSnapshot {
    const snap: VFSSnapshot = {
      modified: new Map(),
      added: new Set(),
    };
    this.activeSnapshot = snap;
    return snap;
  }

  /**
   * Restore from a copy-on-write snapshot.
   *
   * This is O(modified files) - only files that were changed after the
   * snapshot was taken need to be restored.
   */
  restore(snapshot: VFSSnapshot): void {
    // Restore original values for modified files
    for (const [fileName, content] of snapshot.modified) {
      this.files.set(fileName, content);
    }

    // Remove files that were added after the snapshot
    for (const fileName of snapshot.added) {
      this.files.delete(fileName);
    }

    // Clear active snapshot
    this.activeSnapshot = null;
  }

  /**
   * Reset to original state (when VFS was created)
   */
  reset(): void {
    this.files = new Map(this.original);
    this.activeSnapshot = null;
  }

  /**
   * Get the current content of a file
   */
  getContent(fileName: string): string | undefined {
    return this.files.get(fileName);
  }

  /**
   * Check if there's an active snapshot tracking modifications.
   * Useful for testing and debugging.
   */
  hasActiveSnapshot(): boolean {
    return this.activeSnapshot !== null;
  }
}
