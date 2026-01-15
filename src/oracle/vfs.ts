/**
 * Virtual File System
 *
 * In-memory file state with snapshot/restore for speculative fix application.
 */

import ts from "typescript";
import path from "path";

export class VirtualFS {
  private files: Map<string, string> = new Map();
  private original: Map<string, string> = new Map();

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
   * Write content to a file in the VFS
   */
  write(fileName: string, content: string): void {
    this.files.set(fileName, content);
  }

  /**
   * Apply a text change to a file
   */
  applyChange(fileName: string, start: number, end: number, newText: string): void {
    const content = this.files.get(fileName);
    if (content === undefined) {
      throw new Error(`File not in VFS: ${fileName}`);
    }

    const before = content.slice(0, start);
    const after = content.slice(end);
    this.files.set(fileName, before + newText + after);
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
   * Create a snapshot of the current state
   */
  snapshot(): Map<string, string> {
    return new Map(this.files);
  }

  /**
   * Restore from a snapshot
   */
  restore(snapshot: Map<string, string>): void {
    this.files = new Map(snapshot);
  }

  /**
   * Reset to original state (when VFS was created)
   */
  reset(): void {
    this.files = new Map(this.original);
  }

  /**
   * Get the current content of a file
   */
  getContent(fileName: string): string | undefined {
    return this.files.get(fileName);
  }
}
