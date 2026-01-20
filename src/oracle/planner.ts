/**
 * Repair Planner
 *
 * The core oracle-guided algorithm that speculatively applies fixes,
 * verifies them against the TypeScript compiler, and builds a repair plan.
 */

import ts from "typescript";
import {
  createTypeScriptHost,
  toDiagnosticRef,
  toFileChanges,
  type TypeScriptHost,
} from "./typescript.js";
import type {
  RepairPlan,
  VerifiedFix,
  ClassifiedDiagnostic,
  RepairRequest,
  BudgetStats,
  FixDependencies,
  VerificationPolicy,
  CandidateFix,
} from "../output/types.js";
import { createBudgetLogger, createNoopLogger, type BudgetLogger } from "./logger.js";
import {
  getFilesModified as getCandidateFilesModified,
  applyCandidate,
} from "./candidate.js";
import { ConeCache, buildCone, getEffectiveScope } from "./cone.js";
import { selectHostInvalidation } from "./policy.js";

// ============================================================================
// Scoring Strategy
// ============================================================================

/**
 * Scoring strategy for candidate ranking.
 * - "delta": Simple error count difference (errorsBefore - errorsAfter)
 * - "weighted": Weighted formula considering diagnostics, edit size, and risk
 */
export type ScoringStrategy = "delta" | "weighted";

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Assign risk level based on fix type
 */
export function assessRisk(fixName: string): "low" | "medium" | "high" {
  // Low risk - almost always correct
  const lowRisk = [
    "import", // TypeScript's actual name for "Add import from ..."
    "fixMissingImport", // Keep for compatibility
    "addMissingAsync",
    "addMissingAwait",
    "fixAwaitInSyncFunction",
    "fixEnableJsxFlag",
    "fixUnusedIdentifier",
    "fixUnreachableCode",
  ];

  // Medium risk - usually correct but may change behavior
  const mediumRisk = [
    "fixMissingMember",
    "fixMissingFunctionDeclaration",
    "fixClassIncorrectlyImplementsInterface",
    "addMissingParam",
    "addOptionalParam",
    "fixSpelling",
    "inferFromUsage",
  ];

  // High risk - may hide bugs or change semantics
  // Everything else defaults to high

  if (lowRisk.includes(fixName)) return "low";
  if (mediumRisk.includes(fixName)) return "medium";
  return "high";
}

// ============================================================================
// Pre-Verification Pruning
// ============================================================================

/**
 * Compute a prior score for a fix based on cheap heuristics (no verification)
 */
function computePriorScore(fix: ts.CodeFixAction): number {
  let score = 0;

  // Fix kind priority (imports > spelling > assertions)
  const riskOrder = { low: 3, medium: 2, high: 1 };
  score += riskOrder[assessRisk(fix.fixName)] * 10;

  // Smaller diffs preferred
  const diffSize = fix.changes.reduce(
    (sum, c) => sum + c.textChanges.reduce((s, t) => s + t.newText.length, 0),
    0
  );
  score -= Math.min(diffSize / 100, 5);

  return score;
}

/**
 * Prune candidates using cheap priors before expensive verification
 */
export function pruneCandidates(
  fixes: readonly ts.CodeFixAction[],
  limit: number
): ts.CodeFixAction[] {
  if (fixes.length <= limit) {
    return [...fixes];
  }

  // Score by cheap priors (no verification)
  const scored = fixes.map((fix) => ({
    fix,
    score: computePriorScore(fix),
  }));

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.fix);
}

// ============================================================================
// Scoring Weights
// ============================================================================

export const DEFAULT_SCORE_WEIGHTS = {
  introducedMultiplier: 4,
  editSizeAlpha: 0.0015,
  riskPenalty: {
    low: 0,
    medium: 0.75,
    high: 2.0,
  },
} as const;

export type ScoreWeights = {
  introducedMultiplier: number;
  editSizeAlpha: number;
  riskPenalty: {
    low: number;
    medium: number;
    high: number;
  };
};

// ============================================================================
// Verification
// ============================================================================

export interface VerificationResult {
  /** Did the fix eliminate the target diagnostic? */
  targetFixed: boolean;

  /** Error count before the fix */
  errorsBefore: number;

  /** Error count after the fix */
  errorsAfter: number;

  /** Net change (positive = good) */
  delta: number;

  /** New diagnostics introduced by this fix */
  newDiagnostics: ts.Diagnostic[];

  /** Weighted sum of resolved diagnostics (for weighted strategy) */
  resolvedWeight: number;

  /** Weighted sum of introduced diagnostics (for weighted strategy) */
  introducedWeight: number;

  /** Total edit size for the fix (for weighted strategy) */
  editSize: number;
}

function diagnosticKey(diagnostic: ts.Diagnostic): string {
  const file = diagnostic.file?.fileName ?? "<unknown>";
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return `${file}::${diagnostic.code}::${message}`;
}

function diagnosticWeight(diagnostic: ts.Diagnostic): number {
  switch (diagnostic.category) {
    case ts.DiagnosticCategory.Warning:
      return 0.5;
    case ts.DiagnosticCategory.Suggestion:
      return 0.25;
    case ts.DiagnosticCategory.Message:
      return 0.1;
    case ts.DiagnosticCategory.Error:
    default:
      return 1;
  }
}

export function computeEditSize(fix: ts.CodeFixAction): number {
  let size = 0;
  for (const fileChange of fix.changes) {
    for (const textChange of fileChange.textChanges) {
      size += textChange.span.length + textChange.newText.length;
    }
  }
  return size;
}

export function computeScore(
  result: VerificationResult,
  risk: "low" | "medium" | "high",
  weights: ScoreWeights
): number {
  const introducedPenalty = result.introducedWeight * weights.introducedMultiplier;
  const editPenalty = result.editSize * weights.editSizeAlpha;
  const riskPenalty = weights.riskPenalty[risk];
  return result.resolvedWeight - introducedPenalty - editPenalty - riskPenalty;
}

interface EditRange {
  file: string;
  start: number;
  end: number;
}

/**
 * Get the set of files that will be modified by a fix
 */
function getFilesModifiedByFix(fix: ts.CodeFixAction): Set<string> {
  const files = new Set<string>();
  for (const change of fix.changes) {
    files.add(change.fileName);
  }
  return files;
}

// Detailed timing for verify() debugging
let verifyTiming = {
  applyFix: 0,
  getDiagnostics: 0,
  restore: 0,
  count: 0,
  totalFilesChecked: 0,
};

export function getVerifyTiming() {
  return verifyTiming;
}

export function resetVerifyTiming() {
  verifyTiming = { applyFix: 0, getDiagnostics: 0, restore: 0, count: 0, totalFilesChecked: 0 };
}

/**
 * Speculatively apply a fix and measure the diagnostic delta.
 *
 * Uses focused verification: only checks filesWithErrors + files modified by the fix,
 * rather than the entire project. This is much faster for large projects.
 *
 * Performance optimizations:
 * 1. Accepts pre-computed diagnostic keys to avoid repeated flattenDiagnosticMessageText() calls
 * 2. Uses Set-based O(1) lookups instead of O(n*m) .some() scans
 * 3. Only checks modified files, not all files with errors
 */
function verify(
  host: TypeScriptHost,
  diagnostic: ts.Diagnostic,
  fix: ts.CodeFixAction,
  diagnosticsBefore: ts.Diagnostic[],
  beforeKeys?: Set<string>,
  beforeKeysArray?: string[]
): VerificationResult {
  const vfs = host.getVFS();
  const snapshot = vfs.snapshot();
  const errorsBefore = diagnosticsBefore.length;

  // OPTIMIZATION: Only check the modified files, not all files with errors
  // The full check happens at the end of planning anyway.
  // This gives us a fast approximation during verification.
  const filesToCheck = getFilesModifiedByFix(fix);

  // Track files checked
  verifyTiming.totalFilesChecked += filesToCheck.size;

  // Apply the fix
  const t0 = performance.now();
  host.applyFix(fix);
  verifyTiming.applyFix += performance.now() - t0;

  // Re-check only the focused set of files
  const t1 = performance.now();
  const diagnosticsAfter = host.getDiagnosticsForFiles(filesToCheck);
  verifyTiming.getDiagnostics += performance.now() - t1;
  const errorsAfter = diagnosticsAfter.length;

  // OPTIMIZATION: Compute keys once per diagnostic (diagnosticKey calls flattenDiagnosticMessageText)
  // Store as array so we can reuse by index without recomputing
  const afterKeysArray = diagnosticsAfter.map(diagnosticKey);
  const afterKeys = new Set(afterKeysArray);
  const actualBeforeKeys = beforeKeys ?? new Set(diagnosticsBefore.map(diagnosticKey));

  // Check if target diagnostic was fixed using O(1) Set lookup
  const targetKey = diagnosticKey(diagnostic);
  const targetFixed = !afterKeys.has(targetKey);

  // Find new diagnostics using pre-computed keys (O(n) instead of O(n*m))
  const newDiagnostics = diagnosticsAfter.filter(
    (_, i) => !actualBeforeKeys.has(afterKeysArray[i])
  );

  // Find resolved diagnostics using pre-computed keys if available
  const resolvedDiagnostics = beforeKeysArray
    ? diagnosticsBefore.filter((_, i) => !afterKeys.has(beforeKeysArray[i]))
    : diagnosticsBefore.filter((d) => !afterKeys.has(diagnosticKey(d)));

  // Calculate weighted scores for weighted strategy
  const resolvedWeight = resolvedDiagnostics.reduce(
    (sum, d) => sum + diagnosticWeight(d),
    0
  );
  const introducedWeight = newDiagnostics.reduce(
    (sum, d) => sum + diagnosticWeight(d),
    0
  );
  const editSize = computeEditSize(fix);

  // Restore VFS and notify host about only the files that were modified
  // This preserves LanguageService cache for unmodified files
  const t2 = performance.now();
  vfs.restore(snapshot);
  const modifiedFiles = getFilesModifiedByFix(fix);
  host.notifySpecificFilesChanged(modifiedFiles);
  verifyTiming.restore += performance.now() - t2;
  verifyTiming.count++;

  return {
    targetFixed,
    errorsBefore,
    errorsAfter,
    delta: errorsBefore - errorsAfter,
    newDiagnostics,
    resolvedWeight,
    introducedWeight,
    editSize,
  };
}

/**
 * Verify a candidate fix using cone-based verification.
 *
 * This version uses the unified CandidateFix abstraction and supports
 * cone caching for better performance with structural edits.
 */
export function verifyWithCone(
  host: TypeScriptHost,
  diagnostic: ts.Diagnostic,
  candidate: CandidateFix,
  filesWithErrors: Set<string>,
  policy: VerificationPolicy,
  coneCache: ConeCache,
  reverseDepsLookup?: (files: Set<string>) => Set<string>
): VerificationResult {
  const vfs = host.getVFS();
  const snapshot = vfs.snapshot();

  // Build verification cone
  const modifiedFiles = getCandidateFilesModified(candidate);
  const scopeHint = getEffectiveScope(candidate.scopeHint, policy);
  const cone = buildCone(modifiedFiles, filesWithErrors, scopeHint, policy, reverseDepsLookup);

  // Track files checked
  verifyTiming.totalFilesChecked += cone.size;

  // Get "before" diagnostics (cached by cone signature)
  const useIteration = policy.cacheKeyStrategy === "cone+iteration";
  let diagnosticsBefore = coneCache.get(cone, useIteration);
  if (!diagnosticsBefore && policy.cacheBeforeDiagnostics) {
    diagnosticsBefore = host.getDiagnosticsForFiles(cone);
    coneCache.set(cone, diagnosticsBefore, useIteration);
  } else if (!diagnosticsBefore) {
    diagnosticsBefore = host.getDiagnosticsForFiles(cone);
  }

  const errorsBefore = diagnosticsBefore.length;

  // Pre-compute diagnostic keys for efficient comparison
  const beforeKeysArray = diagnosticsBefore.map(diagnosticKey);
  const beforeKeys = new Set(beforeKeysArray);

  // Apply the candidate
  const t0 = performance.now();
  applyCandidate(vfs, candidate);
  // Notify host about modified files
  host.notifySpecificFilesChanged(modifiedFiles);
  verifyTiming.applyFix += performance.now() - t0;

  // Re-check the cone
  const t1 = performance.now();
  const diagnosticsAfter = host.getDiagnosticsForFiles(cone);
  verifyTiming.getDiagnostics += performance.now() - t1;
  const errorsAfter = diagnosticsAfter.length;

  // Compute keys for "after" diagnostics
  const afterKeysArray = diagnosticsAfter.map(diagnosticKey);
  const afterKeys = new Set(afterKeysArray);

  // Check if target diagnostic was fixed
  const targetKey = diagnosticKey(diagnostic);
  const targetFixed = !afterKeys.has(targetKey);

  // Find new diagnostics introduced
  const newDiagnostics = diagnosticsAfter.filter(
    (_, i) => !beforeKeys.has(afterKeysArray[i])
  );

  // Find resolved diagnostics
  const resolvedDiagnostics = diagnosticsBefore.filter(
    (_, i) => !afterKeys.has(beforeKeysArray[i])
  );

  // Calculate weighted scores
  const resolvedWeight = resolvedDiagnostics.reduce(
    (sum, d) => sum + diagnosticWeight(d),
    0
  );
  const introducedWeight = newDiagnostics.reduce(
    (sum, d) => sum + diagnosticWeight(d),
    0
  );

  // Calculate edit size
  let editSize: number;
  if (candidate.kind === "tsCodeFix") {
    editSize = computeEditSize(candidate.action);
  } else {
    editSize = candidate.changes.reduce(
      (sum, c) => sum + (c.end - c.start) + c.newText.length,
      0
    );
  }

  // Restore VFS and invalidate based on policy
  const t2 = performance.now();
  vfs.restore(snapshot);
  const invalidation = selectHostInvalidation(modifiedFiles, cone, policy);
  if (invalidation === "modified") {
    host.notifySpecificFilesChanged(modifiedFiles);
  } else if (invalidation === "cone") {
    host.notifySpecificFilesChanged(cone);
  } else {
    host.notifyFilesChanged();
  }
  verifyTiming.restore += performance.now() - t2;
  verifyTiming.count++;

  return {
    targetFixed,
    errorsBefore,
    errorsAfter,
    delta: errorsBefore - errorsAfter,
    newDiagnostics,
    resolvedWeight,
    introducedWeight,
    editSize,
  };
}

// ============================================================================
// Dependency Metadata
// ============================================================================

function normalizeRange(range: EditRange): EditRange {
  if (range.start === range.end) {
    return { ...range, end: range.end + 1 };
  }
  return range;
}

function rangesOverlap(a: EditRange, b: EditRange): boolean {
  if (a.file !== b.file) return false;
  const left = normalizeRange(a);
  const right = normalizeRange(b);
  return left.start < right.end && right.start < left.end;
}

function toEditRanges(changes: { file: string; start: number; end: number }[]): EditRange[] {
  return changes.map((change) => ({
    file: change.file,
    start: change.start,
    end: change.end,
  }));
}

function toInsertionRanges(
  changes: { file: string; start: number; end: number; newText: string }[]
): EditRange[] {
  const ranges: EditRange[] = [];
  for (const change of changes) {
    if (change.start === change.end && change.newText.length > 0) {
      ranges.push({
        file: change.file,
        start: change.start,
        end: change.start + change.newText.length,
      });
    }
  }
  return ranges;
}

function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

export function deriveDependencies(steps: VerifiedFix[]): string[][] {
  const dependenciesById = new Map<string, FixDependencies>();
  const editsById = new Map<string, EditRange[]>();
  const insertionsById = new Map<string, EditRange[]>();
  const stepById = new Map<string, VerifiedFix>();

  for (const step of steps) {
    dependenciesById.set(step.id, { conflictsWith: [], requires: [], exclusiveGroup: undefined });
    editsById.set(step.id, toEditRanges(step.changes));
    insertionsById.set(step.id, toInsertionRanges(step.changes));
    stepById.set(step.id, step);
  }

  const diagnosticGroups = new Map<string, string[]>();
  for (const step of steps) {
    const key = `${step.diagnostic.file}:${step.diagnostic.code}:${step.diagnostic.start}:${step.diagnostic.length}:${step.diagnostic.message}`;
    const group = diagnosticGroups.get(key) ?? [];
    group.push(step.id);
    diagnosticGroups.set(key, group);
  }

  for (const group of diagnosticGroups.values()) {
    if (group.length <= 1) {
      continue;
    }
    const groupId = `diagnostic:${group.join("+")}`;
    for (const fixId of group) {
      const step = stepById.get(fixId);
      if (step) {
        const deps = dependenciesById.get(step.id);
        if (deps) {
          deps.exclusiveGroup = groupId;
        }
      }
    }
  }

  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      const left = steps[i];
      const right = steps[j];
      const leftEdits = editsById.get(left.id) ?? [];
      const rightEdits = editsById.get(right.id) ?? [];
      const leftInsertions = insertionsById.get(left.id) ?? [];

      let overlaps = false;
      for (const leftEdit of leftEdits) {
        for (const rightEdit of rightEdits) {
          if (rangesOverlap(leftEdit, rightEdit)) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) break;
      }

      if (!overlaps) {
        continue;
      }

      let requiresLeft = false;
      for (const insertion of leftInsertions) {
        for (const rightEdit of rightEdits) {
          if (rangesOverlap(insertion, rightEdit)) {
            requiresLeft = true;
            break;
          }
        }
        if (requiresLeft) break;
      }

      if (requiresLeft) {
        const deps = dependenciesById.get(right.id);
        if (deps) {
          addUnique(deps.requires, left.id);
        }
        continue;
      }

      const leftDeps = dependenciesById.get(left.id);
      const rightDeps = dependenciesById.get(right.id);
      if (leftDeps && rightDeps) {
        addUnique(leftDeps.conflictsWith, right.id);
        addUnique(rightDeps.conflictsWith, left.id);
      }
    }
  }

  for (const step of steps) {
    const deps = dependenciesById.get(step.id);
    if (deps) {
      step.dependencies = deps;
    }
  }

  return computeBatches(steps);
}

export function computeBatches(steps: VerifiedFix[]): string[][] {
  const batches: string[][] = [];
  const batchIndexById = new Map<string, number>();
  const stepById = new Map<string, VerifiedFix>();

  for (const step of steps) {
    stepById.set(step.id, step);
  }

  for (const step of steps) {
    let placed = false;

    for (let i = 0; i < batches.length; i++) {
      if (!canJoinBatch(step, batches[i], i, batchIndexById, stepById)) {
        continue;
      }

      batches[i].push(step.id);
      batchIndexById.set(step.id, i);
      placed = true;
      break;
    }

    if (!placed) {
      batches.push([step.id]);
      batchIndexById.set(step.id, batches.length - 1);
    }
  }

  return batches;
}

function canJoinBatch(
  step: VerifiedFix,
  batch: string[],
  batchIndex: number,
  batchIndexById: Map<string, number>,
  stepById: Map<string, VerifiedFix>
): boolean {
  const requiresIndexes = step.dependencies.requires.map((req) =>
    batchIndexById.get(req)
  );

  for (const index of requiresIndexes) {
    if (index === undefined) {
      return false;
    }
    if (index === batchIndex) {
      return false;
    }
    if (index > batchIndex) {
      return false;
    }
  }

  for (const memberId of batch) {
    if (step.dependencies.conflictsWith.includes(memberId)) {
      return false;
    }

    const member = stepById.get(memberId);
    if (!member) {
      continue;
    }

    if (member.dependencies.conflictsWith.includes(step.id)) {
      return false;
    }

    if (
      member.dependencies.exclusiveGroup &&
      member.dependencies.exclusiveGroup === step.dependencies.exclusiveGroup
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Planning Algorithm
// ============================================================================

export interface PlanOptions {
  /** Maximum candidates to evaluate per diagnostic */
  maxCandidates: number;

  /** Maximum total candidates to consider per planning iteration */
  maxCandidatesPerIteration: number;

  /** Maximum total verifications across all planning */
  maxVerifications: number;

  /** Allow fixes that introduce new errors if net positive */
  allowRegressions: boolean;

  /** Include high-risk fixes */
  includeHighRisk: boolean;

  /** Maximum planning iterations */
  maxIterations: number;

  /** Scoring strategy for candidate ranking */
  scoringStrategy: ScoringStrategy;

  /** Score weights for weighted scoring strategy */
  scoreWeights: ScoreWeights;

  /** Callback for progress updates */
  onProgress?: (message: string) => void;

  /** Budget logger for tracing (optional) */
  logger?: BudgetLogger;

  /** Verification policy for cone construction and caching (vNext) */
  verificationPolicy?: Partial<VerificationPolicy>;
}

const DEFAULT_OPTIONS: PlanOptions = {
  maxCandidates: 10,
  maxCandidatesPerIteration: 100,
  maxVerifications: 500,
  allowRegressions: false,
  includeHighRisk: false,
  maxIterations: 50,
  scoringStrategy: "delta",
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
};

/**
 * Helper to convert ts.Diagnostic to a loggable format
 */
function toDiagInfo(d: ts.Diagnostic): { file: string; code: number; message: string } {
  return {
    file: d.file?.fileName ?? "<unknown>",
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 100),
  };
}

/**
 * Generate a verified repair plan for a TypeScript project
 */
export function plan(
  configPath: string,
  options: Partial<PlanOptions> = {}
): RepairPlan {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    scoreWeights: {
      ...DEFAULT_OPTIONS.scoreWeights,
      ...options.scoreWeights,
      riskPenalty: {
        ...DEFAULT_OPTIONS.scoreWeights.riskPenalty,
        ...options.scoreWeights?.riskPenalty,
      },
    },
  };
  const host = createTypeScriptHost(configPath);
  const logger = opts.logger ?? createNoopLogger();

  const steps: VerifiedFix[] = [];
  let fixId = 0;

  // OPTIMIZATION: Cache getCodeFixes() results to avoid repeated calls
  // Key: "fileName|start|code", Value: readonly ts.CodeFixAction[]
  const codeFixesCache = new Map<string, readonly ts.CodeFixAction[]>();

  function getCachedCodeFixes(diagnostic: ts.Diagnostic): readonly ts.CodeFixAction[] {
    if (!diagnostic.file) return [];
    const key = `${diagnostic.file.fileName}|${diagnostic.start}|${diagnostic.code}`;

    let fixes = codeFixesCache.get(key);
    if (fixes === undefined) {
      fixes = host.getCodeFixes(diagnostic);
      codeFixesCache.set(key, fixes);
    }
    return fixes;
  }

  function invalidateCacheForFiles(files: Set<string>): void {
    for (const key of codeFixesCache.keys()) {
      const file = key.split("|")[0];
      if (files.has(file)) {
        codeFixesCache.delete(key);
      }
    }
  }

  // OPTIMIZATION: Track diagnostics with no fixes to skip them in future iterations
  const diagnosticsWithNoFixes = new Set<string>();

  function getDiagnosticKey(diagnostic: ts.Diagnostic): string {
    return `${diagnostic.file?.fileName}|${diagnostic.start}|${diagnostic.code}`;
  }

  // Budget tracking
  let candidatesGenerated = 0;
  let candidatesVerified = 0;
  const verificationBudget = opts.maxVerifications;
  let budgetExhausted = false;

  // Timing telemetry
  const timing = {
    initialDiagnostics: 0,
    iterationDiagnostics: 0,
    verifications: 0,
    verificationCount: 0,
    applyFix: 0,
    classifyRemaining: 0,
  };
  const planStartTime = performance.now();

  // Get initial error count (full check)
  const t0 = performance.now();
  const initialDiagnostics = host.getDiagnostics();
  timing.initialDiagnostics = performance.now() - t0;
  const initialErrors = initialDiagnostics.length;

  // Build initial filesWithErrors set for focused verification
  const filesWithErrors = new Set<string>();
  for (const diag of initialDiagnostics) {
    if (diag.file) {
      filesWithErrors.add(diag.file.fileName);
    }
  }

  opts.onProgress?.(`Starting with ${initialErrors} errors in ${filesWithErrors.size} files`);
  opts.onProgress?.(`[timing] Initial getDiagnostics: ${timing.initialDiagnostics.toFixed(0)}ms`);

  let iteration = 0;

  // Track current diagnostics (updated via focused checking)
  let currentDiagnostics = initialDiagnostics;

  mainLoop: while (iteration < opts.maxIterations) {
    iteration++;

    if (currentDiagnostics.length === 0) {
      opts.onProgress?.("All errors resolved!");
      break;
    }

    opts.onProgress?.(
      `Iteration ${iteration}: ${currentDiagnostics.length} errors in ${filesWithErrors.size} files`
    );

    // OPTIMIZATION: Pre-compute diagnostic keys once per iteration
    // Avoids repeated flattenDiagnosticMessageText() calls in verify()
    const currentDiagnosticKeysArray = currentDiagnostics.map(diagnosticKey);
    const currentDiagnosticKeys = new Set(currentDiagnosticKeysArray);

    // Find the best fix among all candidates
    let bestFix: {
      diagnostic: ts.Diagnostic;
      fix: ts.CodeFixAction;
      result: VerificationResult;
      risk: "low" | "medium" | "high";
      score: number; // Used by weighted strategy
    } | null = null;

    // Track candidates per iteration
    let iterationCandidates = 0;

    for (const diagnostic of currentDiagnostics) {
      // Check budget before processing more diagnostics
      if (candidatesVerified >= verificationBudget) {
        budgetExhausted = true;
        logger.log({
          type: "budget_exhausted",
          iteration,
          budget: { used: candidatesVerified, remaining: 0 },
        });
        opts.onProgress?.("Verification budget exhausted");
        break mainLoop;
      }

      // Check iteration candidate limit
      if (iterationCandidates >= opts.maxCandidatesPerIteration) {
        break;
      }

      // OPTIMIZATION: Skip diagnostics we already know have no fixes
      const diagKey = getDiagnosticKey(diagnostic);
      if (diagnosticsWithNoFixes.has(diagKey)) {
        continue;
      }

      const allFixes = getCachedCodeFixes(diagnostic);

      // OPTIMIZATION: Track diagnostics with no fixes to skip in future iterations
      if (allFixes.length === 0) {
        diagnosticsWithNoFixes.add(diagKey);
        continue;
      }

      candidatesGenerated += allFixes.length;

      logger.log({
        type: "candidates_generated",
        iteration,
        diagnostic: toDiagInfo(diagnostic),
        budget: {
          used: candidatesVerified,
          remaining: verificationBudget - candidatesVerified,
        },
      });

      // Apply per-diagnostic limit and prune
      const remaining = opts.maxCandidatesPerIteration - iterationCandidates;
      const perDiagLimit = Math.min(opts.maxCandidates, remaining);
      const candidates = pruneCandidates(allFixes, perDiagLimit);

      // Log pruned candidates
      const prunedCount = allFixes.length - candidates.length;
      for (let i = 0; i < prunedCount; i++) {
        const prunedFix = allFixes[candidates.length + i];
        if (prunedFix) {
          logger.log({
            type: "candidate_pruned",
            iteration,
            fix: { name: prunedFix.fixName, description: prunedFix.description },
          });
        }
      }

      iterationCandidates += candidates.length;

      for (const fix of candidates) {
        // Check budget before each verification
        if (candidatesVerified >= verificationBudget) {
          budgetExhausted = true;
          logger.log({
            type: "budget_exhausted",
            iteration,
            budget: { used: candidatesVerified, remaining: 0 },
          });
          opts.onProgress?.("Verification budget exhausted");
          break mainLoop;
        }

        const risk = assessRisk(fix.fixName);

        // Skip high-risk fixes if not allowed
        if (risk === "high" && !opts.includeHighRisk) {
          continue;
        }

        logger.log({
          type: "verification_start",
          iteration,
          fix: { name: fix.fixName, description: fix.description },
          budget: {
            used: candidatesVerified,
            remaining: verificationBudget - candidatesVerified,
          },
        });

        const verifyStart = performance.now();
        const result = verify(host, diagnostic, fix, currentDiagnostics, currentDiagnosticKeys, currentDiagnosticKeysArray);
        timing.verifications += performance.now() - verifyStart;
        timing.verificationCount++;
        candidatesVerified++;

        logger.log({
          type: "verification_end",
          iteration,
          fix: { name: fix.fixName, description: fix.description },
          result: { delta: result.delta, targetFixed: result.targetFixed },
          budget: {
            used: candidatesVerified,
            remaining: verificationBudget - candidatesVerified,
          },
        });

        // Skip fixes that don't actually fix the target
        if (!result.targetFixed) {
          continue;
        }

        // Skip fixes that introduce new errors (unless allowed)
        if (!opts.allowRegressions && result.newDiagnostics.length > 0) {
          continue;
        }

        // Branch on scoring strategy
        if (opts.scoringStrategy === "weighted") {
          // Weighted scoring
          const score = computeScore(result, risk, opts.scoreWeights);

          // Skip fixes with non-positive score
          if (score <= 0) {
            continue;
          }

          // Also require delta > 0 (monotonic progress)
          if (result.delta <= 0) {
            continue;
          }

          // Is this the best fix so far?
          if (!bestFix || score > bestFix.score) {
            bestFix = { diagnostic, fix, result, risk, score };
          }
        } else {
          // Delta scoring (default)
          // Skip fixes with non-positive delta
          if (result.delta <= 0) {
            continue;
          }

          // Is this the best fix so far?
          if (!bestFix || result.delta > bestFix.result.delta) {
            bestFix = { diagnostic, fix, result, risk, score: result.delta };
          }
        }

        // OPTIMIZATION: Early exit if this fix resolves ALL errors
        if (result.errorsAfter === 0) {
          break;
        }
      }

      // OPTIMIZATION: Early exit from diagnostic loop if we found a perfect fix
      if (bestFix && bestFix.result.errorsAfter === 0) {
        break;
      }
    }

    if (!bestFix) {
      opts.onProgress?.("No improving fix found, stopping.");
      break;
    }

    // Commit the best fix
    opts.onProgress?.(
      `Applying ${bestFix.fix.fixName}: ${bestFix.result.errorsBefore} → ${bestFix.result.errorsAfter} errors`
    );

    host.applyFix(bestFix.fix);

    logger.log({
      type: "fix_committed",
      iteration,
      fix: { name: bestFix.fix.fixName, description: bestFix.fix.description },
      result: {
        delta: bestFix.result.delta,
        targetFixed: bestFix.result.targetFixed,
      },
    });

    const changes = toFileChanges(bestFix.fix);
    const diagnosticRef = toDiagnosticRef(bestFix.diagnostic);

    steps.push({
      id: `fix-${fixId++}`,
      diagnostic: diagnosticRef,
      fixName: bestFix.fix.fixName,
      fixDescription: bestFix.fix.description,
      changes,
      errorsBefore: bestFix.result.errorsBefore,
      errorsAfter: bestFix.result.errorsAfter,
      delta: bestFix.result.delta,
      risk: bestFix.risk,
      dependencies: {
        conflictsWith: [],
        requires: [],
      },
    });

    // OPTIMIZATION: Only check files modified by this fix, not all files with errors
    // This reduces post-fix diagnostic time from ~3-4s to ~0.1-0.2s per fix
    const modifiedFiles = new Set<string>();
    for (const change of bestFix.fix.changes) {
      modifiedFiles.add(change.fileName);
    }

    // Invalidate caches for modified files
    invalidateCacheForFiles(modifiedFiles);
    // Also clear no-fix tracking for modified files since new diagnostics may have fixes
    for (const key of diagnosticsWithNoFixes) {
      const file = key.split("|")[0];
      if (modifiedFiles.has(file)) {
        diagnosticsWithNoFixes.delete(key);
      }
    }

    // Get diagnostics only for modified files
    const iterDiagStart = performance.now();
    const newDiagnosticsForModified = host.getDiagnosticsForFiles(modifiedFiles);
    timing.iterationDiagnostics += performance.now() - iterDiagStart;

    // Update currentDiagnostics: remove old diagnostics for modified files, add new ones
    currentDiagnostics = currentDiagnostics.filter(
      (d) => !d.file || !modifiedFiles.has(d.file.fileName)
    );
    currentDiagnostics.push(...newDiagnosticsForModified);

    // Update filesWithErrors based on current diagnostics
    filesWithErrors.clear();
    for (const diag of currentDiagnostics) {
      if (diag.file) {
        filesWithErrors.add(diag.file.fileName);
      }
    }

    // Log timing every 10 iterations
    if (iteration % 10 === 0) {
      const avgVerify = timing.verificationCount > 0 ? timing.verifications / timing.verificationCount : 0;
      opts.onProgress?.(`[timing] Iter ${iteration}: verifications=${timing.verificationCount}, avg=${avgVerify.toFixed(0)}ms, iterDiag=${timing.iterationDiagnostics.toFixed(0)}ms`);
    }
  }

  // Classify remaining diagnostics
  const finalDiagStart = performance.now();
  const finalDiagnostics = host.getDiagnostics();
  const finalDiagTime = performance.now() - finalDiagStart;

  let remaining: ClassifiedDiagnostic[];

  if (budgetExhausted) {
    // Mark all remaining as NeedsJudgment due to budget exhaustion
    remaining = finalDiagnostics.map((d) => ({
      ...toDiagnosticRef(d),
      disposition: "NeedsJudgment" as const,
      candidateCount: 0,
    }));
  } else {
    const classifyStart = performance.now();
    remaining = classifyRemaining(host, finalDiagnostics, opts);
    timing.classifyRemaining = performance.now() - classifyStart;
  }

  // Build budget stats
  const budgetStats: BudgetStats = {
    candidatesGenerated,
    candidatesVerified,
    verificationBudget,
    budgetExhausted,
  };

  const batches = deriveDependencies(steps);

  // Log timing summary
  const totalTime = performance.now() - planStartTime;
  const avgVerify = timing.verificationCount > 0 ? timing.verifications / timing.verificationCount : 0;
  opts.onProgress?.(`\n[timing] === SUMMARY ===`);
  opts.onProgress?.(`[timing] Total time: ${(totalTime / 1000).toFixed(2)}s`);
  opts.onProgress?.(`[timing] Initial getDiagnostics: ${timing.initialDiagnostics.toFixed(0)}ms`);
  opts.onProgress?.(`[timing] Final getDiagnostics: ${finalDiagTime.toFixed(0)}ms`);
  opts.onProgress?.(`[timing] Verifications: ${timing.verificationCount} total, ${timing.verifications.toFixed(0)}ms total, ${avgVerify.toFixed(0)}ms avg`);
  opts.onProgress?.(`[timing] Iteration diagnostics: ${timing.iterationDiagnostics.toFixed(0)}ms total`);
  opts.onProgress?.(`[timing] Classify remaining: ${timing.classifyRemaining.toFixed(0)}ms`);
  opts.onProgress?.(`[timing] Iterations: ${iteration}`);

  // Detailed verify() timing breakdown
  const vt = getVerifyTiming();
  if (vt.count > 0) {
    opts.onProgress?.(`\n[timing] === VERIFY BREAKDOWN ===`);
    opts.onProgress?.(`[timing] Files checked per verify: ${(vt.totalFilesChecked / vt.count).toFixed(1)} avg`);
    opts.onProgress?.(`[timing] applyFix: ${vt.applyFix.toFixed(0)}ms total, ${(vt.applyFix / vt.count).toFixed(0)}ms avg`);
    opts.onProgress?.(`[timing] getDiagnosticsForFiles: ${vt.getDiagnostics.toFixed(0)}ms total, ${(vt.getDiagnostics / vt.count).toFixed(0)}ms avg`);
    opts.onProgress?.(`[timing] restore+notify: ${vt.restore.toFixed(0)}ms total, ${(vt.restore / vt.count).toFixed(0)}ms avg`);
  }
  resetVerifyTiming();

  return {
    steps,
    remaining,
    batches,
    summary: {
      initialErrors,
      finalErrors: finalDiagnostics.length,
      fixedCount: steps.length,
      remainingCount: remaining.length,
      budget: budgetStats,
    },
  };
}

/**
 * Classify a single diagnostic by checking its available fixes
 */
function classifySingleDiagnostic(
  host: TypeScriptHost,
  diagnostic: ts.Diagnostic,
  allDiagnostics: ts.Diagnostic[],
  opts: PlanOptions,
  diagnosticKeys: Set<string>,
  diagnosticKeysArray: string[]
): { disposition: ClassifiedDiagnostic["disposition"]; candidateCount: number } {
  const fixes = host.getCodeFixes(diagnostic);

  if (fixes.length === 0) {
    return { disposition: "NoGeneratedCandidate", candidateCount: 0 };
  }

  // Check if any fix actually helps
  // Use the same criteria as the main planning loop for consistency
  let hasLowRiskFix = false;
  let validFixCount = 0;

  for (const fix of fixes.slice(0, opts.maxCandidates)) {
    const result = verify(host, diagnostic, fix, allDiagnostics, diagnosticKeys, diagnosticKeysArray);
    const risk = assessRisk(fix.fixName);

    // Skip high-risk fixes if not allowed
    if (risk === "high" && !opts.includeHighRisk) {
      continue;
    }

    // Check if target was actually fixed
    if (!result.targetFixed) {
      continue;
    }

    // Use the same scoring criteria as the main loop
    let isValidFix = false;
    if (opts.scoringStrategy === "weighted") {
      const score = computeScore(result, risk, opts.scoreWeights);
      // Weighted scoring requires positive score AND positive delta (monotonic progress)
      isValidFix = score > 0 && result.delta > 0;
    } else {
      // Delta scoring requires positive delta
      isValidFix = result.delta > 0;
    }

    if (isValidFix) {
      validFixCount++;
      if (risk === "low" || risk === "medium") {
        hasLowRiskFix = true;
      }
    }
  }

  if (validFixCount === 0) {
    return { disposition: "NoVerifiedCandidate", candidateCount: fixes.length };
  } else if (validFixCount > 1) {
    return { disposition: "NeedsJudgment", candidateCount: validFixCount };
  } else if (hasLowRiskFix) {
    return { disposition: "AutoFixable", candidateCount: validFixCount };
  } else {
    return { disposition: "AutoFixableHighRisk", candidateCount: validFixCount };
  }
}

/**
 * Classify remaining diagnostics by disposition
 *
 * OPTIMIZATION: Groups diagnostics by (code, message) and classifies only
 * one representative per group. Diagnostics with the same error code and
 * message will have the same fix behavior, so we only need to verify once.
 */
function classifyRemaining(
  host: TypeScriptHost,
  diagnostics: ts.Diagnostic[],
  opts: PlanOptions
): ClassifiedDiagnostic[] {
  // Group diagnostics by (code, message) for efficient classification
  const groups = new Map<string, ts.Diagnostic[]>();
  for (const diag of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diag.messageText, " ");
    const key = `${diag.code}|${message}`;
    const group = groups.get(key) ?? [];
    group.push(diag);
    groups.set(key, group);
  }

  // OPTIMIZATION: Pre-compute diagnostic keys once for all verifications
  const diagnosticKeysArray = diagnostics.map(diagnosticKey);
  const diagnosticKeys = new Set(diagnosticKeysArray);

  const classified: ClassifiedDiagnostic[] = [];
  let groupsProcessed = 0;
  const totalGroups = groups.size;

  // Classify each group using its first diagnostic as representative
  for (const [_key, group] of groups) {
    groupsProcessed++;
    opts.onProgress?.(
      `Classifying group ${groupsProcessed}/${totalGroups} (${group.length} diagnostics)`
    );

    const representative = group[0];
    const classification = classifySingleDiagnostic(
      host,
      representative,
      diagnostics,
      opts,
      diagnosticKeys,
      diagnosticKeysArray
    );

    // Apply same classification to all group members
    for (const diag of group) {
      classified.push({
        ...toDiagnosticRef(diag),
        disposition: classification.disposition,
        candidateCount: classification.candidateCount,
      });
    }
  }

  return classified;
}

/**
 * Main entry point for repair planning
 */
export function repair(
  request: RepairRequest,
  logger?: BudgetLogger
): RepairPlan {
  return plan(request.project, {
    maxCandidates: request.maxCandidates ?? 10,
    maxCandidatesPerIteration: request.maxCandidatesPerIteration ?? 100,
    maxVerifications: request.maxVerifications ?? 500,
    allowRegressions: request.allowRegressions ?? false,
    includeHighRisk: request.includeHighRisk ?? false,
    scoringStrategy: request.scoringStrategy ?? "delta",
    scoreWeights: {
      ...DEFAULT_SCORE_WEIGHTS,
      ...request.scoreWeights,
      riskPenalty: {
        ...DEFAULT_SCORE_WEIGHTS.riskPenalty,
        ...request.scoreWeights?.riskPenalty,
      },
    },
    onProgress: request.onProgress,
    logger,
  });
}

// Re-export logger for convenience
export { createBudgetLogger, createNoopLogger, type BudgetLogger };

// Re-export vNext abstractions for convenience
export {
  wrapTsCodeFix,
  getFilesModified as getCandidateFilesModified,
  applyCandidate,
  getChanges,
  normalizeEdits,
  createSyntheticFix,
  deduplicateCandidates,
} from "./candidate.js";
export { ConeCache, buildCone, getEffectiveScope, getConeStats } from "./cone.js";
export {
  DEFAULT_POLICY,
  STRUCTURAL_POLICY,
  WIDE_POLICY,
  mergePolicy,
  selectHostInvalidation,
  getPolicyForScope,
  validatePolicy,
} from "./policy.js";
export { createReverseDepsLookup, getApproximateReverseDeps } from "./typescript.js";
