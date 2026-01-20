/**
 * Candidate Fix Abstraction
 *
 * Unified representation for both TypeScript codefix candidates and
 * synthetic (builder-generated) candidates. This abstraction enables
 * the vNext repair framework to treat all fix sources uniformly.
 */

import ts from "typescript";
import type { FileChange } from "../output/types.js";
import type { TypeScriptHost } from "./typescript.js";

// ============================================================================
// Verification Scope
// ============================================================================

/**
 * Hint for how wide the verification cone should be for a candidate.
 *
 * - "modified": Only check files touched by the candidate (fast path)
 * - "errors": Check modified files + all files with existing errors
 * - "wide": Check modified + errors + reverse dependencies (structural fixes)
 */
export type VerificationScopeHint = "modified" | "errors" | "wide";

// ============================================================================
// Candidate Fix Types
// ============================================================================

/**
 * A candidate fix sourced from TypeScript's Language Service.
 */
export interface TsCodeFixCandidate {
  kind: "tsCodeFix";

  /** The fix name from TypeScript (e.g., "import", "fixSpelling") */
  fixName: string;

  /** Human-readable description of the fix */
  description: string;

  /** The original CodeFixAction from TypeScript */
  action: ts.CodeFixAction;

  /** Suggested verification scope (defaults to "modified") */
  scopeHint?: VerificationScopeHint;

  /** Risk level override (if not provided, assessed from fixName) */
  riskHint?: "low" | "medium" | "high";

  /** Tags for filtering/grouping candidates */
  tags?: string[];
}

/**
 * A candidate fix generated synthetically by a SolutionBuilder.
 */
export interface SyntheticCandidate {
  kind: "synthetic";

  /** Unique name for this fix type (e.g., "widenOverloadParam") */
  fixName: string;

  /** Human-readable description of the fix */
  description: string;

  /** The changes to apply (in our normalized FileChange format) */
  changes: FileChange[];

  /** Suggested verification scope (structural fixes often need "errors" or "wide") */
  scopeHint?: VerificationScopeHint;

  /** Risk level (synthetic fixes often default to "high") */
  riskHint?: "low" | "medium" | "high";

  /** Tags for filtering/grouping candidates */
  tags?: string[];

  /** Builder-specific metadata for debugging/tracing */
  metadata?: Record<string, unknown>;
}

/**
 * Unified candidate fix type - either from TypeScript or synthetically generated.
 */
export type CandidateFix = TsCodeFixCandidate | SyntheticCandidate;

// ============================================================================
// Candidate Constructors
// ============================================================================

/**
 * Wrap a TypeScript CodeFixAction as a CandidateFix.
 */
export function fromCodeFixAction(
  action: ts.CodeFixAction,
  options?: {
    scopeHint?: VerificationScopeHint;
    riskHint?: "low" | "medium" | "high";
    tags?: string[];
  }
): TsCodeFixCandidate {
  return {
    kind: "tsCodeFix",
    fixName: action.fixName,
    description: action.description,
    action,
    scopeHint: options?.scopeHint,
    riskHint: options?.riskHint,
    tags: options?.tags,
  };
}

/**
 * Create a synthetic candidate from changes.
 */
export function createSyntheticCandidate(
  fixName: string,
  description: string,
  changes: FileChange[],
  options?: {
    scopeHint?: VerificationScopeHint;
    riskHint?: "low" | "medium" | "high";
    tags?: string[];
    metadata?: Record<string, unknown>;
  }
): SyntheticCandidate {
  return {
    kind: "synthetic",
    fixName,
    description,
    changes,
    scopeHint: options?.scopeHint ?? "errors", // Synthetic fixes often need wider scope
    riskHint: options?.riskHint ?? "high", // Default to high risk for synthetic
    tags: options?.tags,
    metadata: options?.metadata,
  };
}

// ============================================================================
// Candidate Accessors
// ============================================================================

/**
 * Get the fix name from a candidate.
 */
export function getFixName(candidate: CandidateFix): string {
  return candidate.fixName;
}

/**
 * Get the description from a candidate.
 */
export function getDescription(candidate: CandidateFix): string {
  return candidate.description;
}

/**
 * Get the scope hint from a candidate (defaults to "modified").
 */
export function getScopeHint(candidate: CandidateFix): VerificationScopeHint {
  return candidate.scopeHint ?? "modified";
}

/**
 * Get the risk hint from a candidate (undefined means assess from fixName).
 */
export function getRiskHint(
  candidate: CandidateFix
): "low" | "medium" | "high" | undefined {
  return candidate.riskHint;
}

/**
 * Get tags from a candidate.
 */
export function getTags(candidate: CandidateFix): string[] {
  return candidate.tags ?? [];
}

// ============================================================================
// Change Extraction
// ============================================================================

/**
 * Extract FileChange[] from a candidate without applying.
 */
export function candidateToChanges(candidate: CandidateFix): FileChange[] {
  if (candidate.kind === "synthetic") {
    return candidate.changes;
  }

  // Convert ts.CodeFixAction changes to FileChange[]
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

/**
 * Get the set of files that will be modified by a candidate.
 */
export function getModifiedFiles(candidate: CandidateFix): Set<string> {
  const files = new Set<string>();

  if (candidate.kind === "synthetic") {
    for (const change of candidate.changes) {
      files.add(change.file);
    }
  } else {
    for (const fileChange of candidate.action.changes) {
      files.add(fileChange.fileName);
    }
  }

  return files;
}

/**
 * Compute the total edit size for a candidate (characters changed).
 * Used for scoring - smaller edits are preferred.
 */
export function computeCandidateEditSize(candidate: CandidateFix): number {
  let size = 0;

  if (candidate.kind === "synthetic") {
    for (const change of candidate.changes) {
      // Count both removed and added characters
      size += (change.end - change.start) + change.newText.length;
    }
  } else {
    for (const fileChange of candidate.action.changes) {
      for (const textChange of fileChange.textChanges) {
        size += textChange.span.length + textChange.newText.length;
      }
    }
  }

  return size;
}

// ============================================================================
// Candidate Application
// ============================================================================

/**
 * Result of applying a candidate to the host.
 */
export interface ApplyResult {
  /** Files modified by this candidate */
  modifiedFiles: Set<string>;

  /** Normalized changes in our FileChange format */
  changes: FileChange[];

  /** Total edit size (characters changed) */
  editSize: number;
}

/**
 * Apply a candidate to the TypeScript host.
 *
 * This handles both TS codefixes and synthetic candidates uniformly.
 * After calling this, you should call host.notifySpecificFilesChanged()
 * with the modifiedFiles to update the LanguageService.
 */
export function applyCandidate(
  host: TypeScriptHost,
  candidate: CandidateFix
): ApplyResult {
  const modifiedFiles = getModifiedFiles(candidate);
  const changes = candidateToChanges(candidate);
  const editSize = computeCandidateEditSize(candidate);
  const vfs = host.getVFS();

  if (candidate.kind === "synthetic") {
    // Apply synthetic changes directly to VFS
    for (const change of candidate.changes) {
      vfs.applyChange(change.file, change.start, change.end, change.newText);
    }
  } else {
    // Use host's applyFix for TS codefixes (handles version bumping)
    host.applyFix(candidate.action);
  }

  return { modifiedFiles, changes, editSize };
}

/**
 * Apply a candidate's changes directly to the VFS without notifying the host.
 * Useful for speculative application during verification.
 */
export function applyCandidateToVFS(
  host: TypeScriptHost,
  candidate: CandidateFix
): ApplyResult {
  const modifiedFiles = getModifiedFiles(candidate);
  const changes = candidateToChanges(candidate);
  const editSize = computeCandidateEditSize(candidate);
  const vfs = host.getVFS();

  if (candidate.kind === "synthetic") {
    for (const change of candidate.changes) {
      vfs.applyChange(change.file, change.start, change.end, change.newText);
    }
  } else {
    // Apply TS changes directly to VFS (bypass host.applyFix to avoid version bump)
    for (const fileChange of candidate.action.changes) {
      for (const textChange of fileChange.textChanges) {
        vfs.applyChange(
          fileChange.fileName,
          textChange.span.start,
          textChange.span.start + textChange.span.length,
          textChange.newText
        );
      }
    }
  }

  return { modifiedFiles, changes, editSize };
}

// ============================================================================
// Candidate Comparison
// ============================================================================

/**
 * Check if two candidates modify overlapping file regions.
 */
export function candidatesConflict(a: CandidateFix, b: CandidateFix): boolean {
  const changesA = candidateToChanges(a);
  const changesB = candidateToChanges(b);

  for (const changeA of changesA) {
    for (const changeB of changesB) {
      if (changeA.file !== changeB.file) continue;

      // Normalize zero-length spans for overlap check
      const aStart = changeA.start;
      const aEnd = changeA.start === changeA.end ? changeA.end + 1 : changeA.end;
      const bStart = changeB.start;
      const bEnd = changeB.start === changeB.end ? changeB.end + 1 : changeB.end;

      // Check for overlap
      if (aStart < bEnd && bStart < aEnd) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if two candidates target the same diagnostic location.
 * Used for exclusive group detection.
 */
export function candidatesTargetSameDiagnostic(
  _a: CandidateFix,
  _b: CandidateFix,
  _diagnosticKey: string
): boolean {
  // This is a placeholder - actual implementation would need diagnostic context
  // For now, rely on the planner to track this via diagnostic association
  return false;
}
