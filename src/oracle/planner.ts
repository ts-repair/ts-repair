/**
 * Repair Planner
 *
 * The core oracle-guided algorithm that speculatively applies fixes,
 * verifies them against the TypeScript compiler, and builds a repair plan.
 */

import ts from "typescript";
import {
  createTypeScriptHost,
  createIncrementalTypeScriptHost,
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
} from "../output/types.js";
import { createBudgetLogger, createNoopLogger, type BudgetLogger } from "./logger.js";

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
 * Speculatively apply a fix and measure the diagnostic delta.
 *
 * Performance optimizations:
 * 1. Accepts diagnosticsBefore as parameter to avoid redundant type-checking
 * 2. Only notifies host about files that were actually modified
 */
function verify(
  host: TypeScriptHost,
  diagnostic: ts.Diagnostic,
  fix: ts.CodeFixAction,
  diagnosticsBefore: ts.Diagnostic[],
  beforeKeys?: Set<string>  // Optional pre-computed keys for efficiency
): VerificationResult {
  const vfs = host.getVFS();
  const snapshot = vfs.snapshot();
  const errorsBefore = diagnosticsBefore.length;

  // Track which files the fix modifies (for targeted notification after restore)
  const modifiedFiles = new Set<string>();
  for (const fileChange of fix.changes) {
    modifiedFiles.add(fileChange.fileName);
  }

  // Apply the fix
  host.applyFix(fix);

  // Re-check (this is the only getDiagnostics call needed per verification)
  const diagnosticsAfter = host.getDiagnostics();
  const errorsAfter = diagnosticsAfter.length;

  // Compute keys for Set-based lookups (O(1) instead of O(n) scans)
  const afterKeys = new Set(diagnosticsAfter.map(diagnosticKey));
  const actualBeforeKeys = beforeKeys ?? new Set(diagnosticsBefore.map(diagnosticKey));

  // Check if target diagnostic was fixed using Set lookup
  const targetKey = diagnosticKey(diagnostic);
  const targetFixed = !afterKeys.has(targetKey);

  // Find new diagnostics using Set difference (O(n) instead of O(n*m))
  const newDiagnostics = diagnosticsAfter.filter(
    (d) => !actualBeforeKeys.has(diagnosticKey(d))
  );

  // Find resolved diagnostics using Set difference
  const resolvedDiagnostics = diagnosticsBefore.filter(
    (d) => !afterKeys.has(diagnosticKey(d))
  );

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

  // Restore VFS
  vfs.restore(snapshot);

  // Notify host only about files that were modified (not all files)
  // This enables incremental re-checking on the next verification
  if (host.notifyFileChanged) {
    for (const fileName of modifiedFiles) {
      host.notifyFileChanged(fileName);
    }
  } else {
    // Fall back to notifying all files for non-incremental host
    host.notifyFilesChanged();
  }

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

  /**
   * Use incremental type checking for faster verification.
   * When true, uses TypeScript's BuilderProgram which only re-checks
   * files affected by each change. Much faster for large projects.
   */
  incremental: boolean;

  /** Callback for progress updates */
  onProgress?: (message: string) => void;

  /** Budget logger for tracing (optional) */
  logger?: BudgetLogger;
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
  incremental: false, // Opt-in: enable for large projects (100+ errors) for faster verification
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
  const host = opts.incremental
    ? createIncrementalTypeScriptHost(configPath)
    : createTypeScriptHost(configPath);
  const logger = opts.logger ?? createNoopLogger();

  const steps: VerifiedFix[] = [];
  let fixId = 0;

  // Budget tracking
  let candidatesGenerated = 0;
  let candidatesVerified = 0;
  const verificationBudget = opts.maxVerifications;
  let budgetExhausted = false;

  // Get initial diagnostics (reused for first iteration to avoid duplicate type-check)
  let currentDiagnostics = host.getDiagnostics();
  const initialErrors = currentDiagnostics.length;

  opts.onProgress?.(`Starting with ${initialErrors} errors`);

  let iteration = 0;

  mainLoop: while (iteration < opts.maxIterations) {
    iteration++;

    // On iteration 2+, refresh diagnostics (iteration 1 uses initialDiagnostics)
    if (iteration > 1) {
      currentDiagnostics = host.getDiagnostics();
    }

    if (currentDiagnostics.length === 0) {
      opts.onProgress?.("All errors resolved!");
      break;
    }

    opts.onProgress?.(
      `Iteration ${iteration}: ${currentDiagnostics.length} errors`
    );

    // Pre-compute diagnostic keys for O(1) lookups during verification
    const currentDiagnosticKeys = new Set(currentDiagnostics.map(diagnosticKey));

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

      const allFixes = host.getCodeFixes(diagnostic);
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

        const result = verify(host, diagnostic, fix, currentDiagnostics, currentDiagnosticKeys);
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

        // Early exit: if this fix resolves ALL errors, no need to check more candidates
        if (result.errorsAfter === 0) {
          break;
        }
      }

      // Early exit from diagnostic loop if we found a fix that resolves all errors
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
  }

  // Classify remaining diagnostics
  const finalDiagnostics = host.getDiagnostics();
  let remaining: ClassifiedDiagnostic[];

  if (budgetExhausted) {
    // Mark all remaining as NeedsJudgment due to budget exhaustion
    remaining = finalDiagnostics.map((d) => ({
      ...toDiagnosticRef(d),
      disposition: "NeedsJudgment" as const,
      candidateCount: 0,
    }));
  } else {
    remaining = classifyRemaining(host, finalDiagnostics, opts);
  }

  // Build budget stats
  const budgetStats: BudgetStats = {
    candidatesGenerated,
    candidatesVerified,
    verificationBudget,
    budgetExhausted,
  };

  const batches = deriveDependencies(steps);

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
 * Classify remaining diagnostics by disposition
 */
function classifyRemaining(
  host: TypeScriptHost,
  diagnostics: ts.Diagnostic[],
  opts: PlanOptions
): ClassifiedDiagnostic[] {
  const classified: ClassifiedDiagnostic[] = [];

  // Pre-compute diagnostic keys for O(1) lookups during verification
  const diagnosticKeys = new Set(diagnostics.map(diagnosticKey));

  for (const diagnostic of diagnostics) {
    const fixes = host.getCodeFixes(diagnostic);
    const ref = toDiagnosticRef(diagnostic);

    if (fixes.length === 0) {
      classified.push({
        ...ref,
        disposition: "NoGeneratedCandidate",
        candidateCount: 0,
      });
      continue;
    }

    // Check if any fix actually helps
    // Use the same criteria as the main planning loop for consistency
    let hasLowRiskFix = false;
    let validFixCount = 0;

    for (const fix of fixes.slice(0, opts.maxCandidates)) {
      const result = verify(host, diagnostic, fix, diagnostics, diagnosticKeys);
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
      classified.push({
        ...ref,
        disposition: "NoVerifiedCandidate",
        candidateCount: fixes.length,
      });
    } else if (validFixCount > 1) {
      classified.push({
        ...ref,
        disposition: "NeedsJudgment",
        candidateCount: validFixCount,
      });
    } else if (hasLowRiskFix) {
      classified.push({
        ...ref,
        disposition: "AutoFixable",
        candidateCount: validFixCount,
      });
    } else {
      classified.push({
        ...ref,
        disposition: "AutoFixableHighRisk",
        candidateCount: validFixCount,
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
    incremental: request.incremental ?? false,
    logger,
  });
}

// Re-export logger for convenience
export { createBudgetLogger, createNoopLogger, type BudgetLogger };
