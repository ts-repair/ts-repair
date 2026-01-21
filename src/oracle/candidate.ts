/**
 * Candidate Abstraction
 *
 * Unified representation and operations for all candidate fix types.
 * Supports both TypeScript language service fixes and synthetic fixes.
 */

import type ts from "typescript";
import type { CandidateFix, FileChange } from "../output/types.js";
import type { VirtualFS } from "./vfs.js";

/**
 * Wrap a TypeScript CodeFixAction as a CandidateFix.
 */
export function wrapTsCodeFix(
  action: ts.CodeFixAction,
  riskHint?: "low" | "medium" | "high"
): CandidateFix {
  return {
    kind: "tsCodeFix",
    fixName: action.fixName,
    description: action.description,
    action,
    riskHint,
  };
}

/**
 * Create a synthetic candidate fix from file changes.
 */
export function createSyntheticFix(
  fixName: string,
  description: string,
  changes: FileChange[],
  options?: {
    scopeHint?: CandidateFix["scopeHint"];
    riskHint?: "low" | "medium" | "high";
    tags?: string[];
    metadata?: Record<string, unknown>;
  }
): CandidateFix {
  return {
    kind: "synthetic",
    fixName,
    description,
    changes,
    ...options,
  };
}

/**
 * Get the set of files modified by a candidate fix.
 */
export function getFilesModified(candidate: CandidateFix): Set<string> {
  if (candidate.kind === "tsCodeFix") {
    return new Set(candidate.action.changes.map((c) => c.fileName));
  }
  return new Set(candidate.changes.map((c) => c.file));
}

/**
 * Extract FileChange array from any candidate type.
 */
export function getChanges(candidate: CandidateFix): FileChange[] {
  if (candidate.kind === "tsCodeFix") {
    const changes: FileChange[] = [];
    for (const fileChange of candidate.action.changes) {
      for (const textChange of fileChange.textChanges) {
        changes.push({
          file: fileChange.fileName,
          start: textChange.span.start,
          end: textChange.span.start + textChange.span.length,
          newText: textChange.newText,
        });
      }
    }
    return changes;
  }
  return candidate.changes;
}

/**
 * Normalize edits by sorting and handling overlaps.
 *
 * Edits are sorted by:
 * 1. File name (ascending)
 * 2. Position (descending - so we can apply from end to preserve positions)
 *
 * Overlapping edits in the same file are detected and flagged.
 */
export function normalizeEdits(changes: FileChange[]): FileChange[] {
  if (changes.length === 0) {
    return [];
  }

  // Sort by file (ascending), then by start position (descending)
  // Descending position allows applying edits from end of file first,
  // which preserves positions for earlier edits
  const sorted = [...changes].sort((a, b) => {
    if (a.file !== b.file) {
      return a.file.localeCompare(b.file);
    }
    // For same file, sort by start position descending
    return b.start - a.start;
  });

  // Detect and handle overlapping edits
  const result: FileChange[] = [];
  let prevFile = "";
  let prevEnd = Infinity;

  for (const change of sorted) {
    if (change.file === prevFile && change.end > prevEnd) {
      // Overlapping edit detected - this edit's end extends past the previous edit's start
      // Since we're sorted descending by position, the previous edit has a higher start
      // Skip this overlapping edit (or could merge them)
      continue;
    }

    result.push(change);
    prevFile = change.file;
    prevEnd = change.start;
  }

  return result;
}

/**
 * Apply a candidate fix to a VirtualFS.
 * Changes are normalized and applied in reverse position order to preserve positions.
 */
export function applyCandidate(vfs: VirtualFS, candidate: CandidateFix): void {
  const changes = getChanges(candidate);
  const sorted = normalizeEdits(changes);

  for (const change of sorted) {
    vfs.applyChange(change.file, change.start, change.end, change.newText);
  }
}

/**
 * Compute the total edit size for a candidate (characters changed).
 */
export function computeCandidateEditSize(candidate: CandidateFix): number {
  const changes = getChanges(candidate);
  let size = 0;
  for (const change of changes) {
    // Count both characters deleted and characters inserted
    size += (change.end - change.start) + change.newText.length;
  }
  return size;
}

/**
 * Get a unique identifier for a candidate fix.
 * Used for deduplication and caching.
 */
export function getCandidateKey(candidate: CandidateFix): string {
  const changes = getChanges(candidate);
  const sortedChanges = [...changes].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.start - b.start;
  });

  const changesSummary = sortedChanges
    .map((c) => `${c.file}:${c.start}:${c.end}:${c.newText}`)
    .join("|");

  return `${candidate.fixName}:${changesSummary}`;
}

/**
 * Check if two candidates are equivalent (same changes).
 */
export function candidatesEqual(a: CandidateFix, b: CandidateFix): boolean {
  return getCandidateKey(a) === getCandidateKey(b);
}

/**
 * Deduplicate a list of candidates by their changes.
 */
export function deduplicateCandidates(candidates: CandidateFix[]): CandidateFix[] {
  const seen = new Set<string>();
  const result: CandidateFix[] = [];

  for (const candidate of candidates) {
    const key = getCandidateKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }

  return result;
}
