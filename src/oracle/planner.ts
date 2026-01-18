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
} from "../output/types.js";
import { createBudgetLogger, createNoopLogger, type BudgetLogger } from "./logger.js";

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Assign risk level based on fix type
 */
export function assessRisk(fixName: string): "low" | "medium" | "high" {
  // Low risk - almost always correct
  const lowRisk = [
    "fixMissingImport",
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
// Verification
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

  /** Weighted sum of resolved diagnostics */
  resolvedWeight: number;

  /** Weighted sum of introduced diagnostics */
  introducedWeight: number;

  /** Total edit size for the fix */
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

/**
 * Speculatively apply a fix and measure the diagnostic delta
 */
function verify(
  host: TypeScriptHost,
  diagnostic: ts.Diagnostic,
  fix: ts.CodeFixAction
): VerificationResult {
  const vfs = host.getVFS();
  const snapshot = vfs.snapshot();

  const diagnosticsBefore = host.getDiagnostics();
  const errorsBefore = diagnosticsBefore.length;

  // Apply the fix
  host.applyFix(fix);

  // Re-check
  const diagnosticsAfter = host.getDiagnostics();
  const errorsAfter = diagnosticsAfter.length;
  const afterKeys = new Set(diagnosticsAfter.map(diagnosticKey));

  // Check if target diagnostic was fixed
  // Note: We can't match by position because applying a fix may shift positions.
  // Instead, match by file, code, and message text (which is stable).
  const targetMessage = ts.flattenDiagnosticMessageText(
    diagnostic.messageText,
    " "
  );
  const targetFixed = !diagnosticsAfter.some(
    (d) =>
      d.file?.fileName === diagnostic.file?.fileName &&
      d.code === diagnostic.code &&
      ts.flattenDiagnosticMessageText(d.messageText, " ") === targetMessage
  );

  // Find new diagnostics (introduced by this fix)
  // Match by file, code, and message (not position, which may shift)
  const newDiagnostics = diagnosticsAfter.filter((after) => {
    const afterMessage = ts.flattenDiagnosticMessageText(after.messageText, " ");
    return !diagnosticsBefore.some(
      (before) =>
        before.file?.fileName === after.file?.fileName &&
        before.code === after.code &&
        ts.flattenDiagnosticMessageText(before.messageText, " ") === afterMessage
    );
  });

  const resolvedDiagnostics = diagnosticsBefore.filter(
    (before) => !afterKeys.has(diagnosticKey(before))
  );

  const resolvedWeight = resolvedDiagnostics.reduce(
    (sum, d) => sum + diagnosticWeight(d),
    0
  );
  const introducedWeight = newDiagnostics.reduce(
    (sum, d) => sum + diagnosticWeight(d),
    0
  );
  const editSize = computeEditSize(fix);

  // Restore VFS and notify host so LanguageService sees updated files
  vfs.restore(snapshot);
  host.notifyFilesChanged();

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

  /** Scoring weights for candidate ranking */
  scoreWeights: ScoreWeights;

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

  // Budget tracking
  let candidatesGenerated = 0;
  let candidatesVerified = 0;
  const verificationBudget = opts.maxVerifications;
  let budgetExhausted = false;

  // Get initial error count
  const initialDiagnostics = host.getDiagnostics();
  const initialErrors = initialDiagnostics.length;

  opts.onProgress?.(`Starting with ${initialErrors} errors`);

  let iteration = 0;

  mainLoop: while (iteration < opts.maxIterations) {
    iteration++;

    const currentDiagnostics = host.getDiagnostics();
    if (currentDiagnostics.length === 0) {
      opts.onProgress?.("All errors resolved!");
      break;
    }

    opts.onProgress?.(
      `Iteration ${iteration}: ${currentDiagnostics.length} errors`
    );

    // Find the best fix among all candidates
    let bestFix: {
      diagnostic: ts.Diagnostic;
      fix: ts.CodeFixAction;
      result: VerificationResult;
      risk: "low" | "medium" | "high";
      score: number;
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

        const result = verify(host, diagnostic, fix);
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

        const score = computeScore(result, risk, opts.scoreWeights);

        // Skip fixes with non-positive score
        if (score <= 0) {
          continue;
        }

        // Skip fixes that do not reduce errors
        if (result.delta <= 0) {
          continue;
        }

        if (result.resolvedWeight === 0) {
          continue;
        }

        // Is this the best fix so far?
        if (!bestFix || score > bestFix.score) {
          bestFix = { diagnostic, fix, result, risk, score };
        }
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

    steps.push({
      id: `fix-${fixId++}`,
      diagnostic: toDiagnosticRef(bestFix.diagnostic),
      fixName: bestFix.fix.fixName,
      fixDescription: bestFix.fix.description,
      changes: toFileChanges(bestFix.fix),
      errorsBefore: bestFix.result.errorsBefore,
      errorsAfter: bestFix.result.errorsAfter,
      delta: bestFix.result.delta,
      risk: bestFix.risk,
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

  return {
    steps,
    remaining,
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
    let hasLowRiskFix = false;
    let validFixCount = 0;

    for (const fix of fixes.slice(0, opts.maxCandidates)) {
      const result = verify(host, diagnostic, fix);

      const risk = assessRisk(fix.fixName);
      const score = computeScore(result, risk, opts.scoreWeights);

      if (result.targetFixed && score > 0 && result.resolvedWeight > 0) {
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
    scoreWeights: {
      ...DEFAULT_SCORE_WEIGHTS,
      ...request.scoreWeights,
      riskPenalty: {
        ...DEFAULT_SCORE_WEIGHTS.riskPenalty,
        ...request.scoreWeights?.riskPenalty,
      },
    },
    logger,
  });
}

// Re-export logger for convenience
export { createBudgetLogger, createNoopLogger, type BudgetLogger };
