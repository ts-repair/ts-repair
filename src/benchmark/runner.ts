/**
 * Benchmark Runner
 *
 * Single-run executor for the ts-repair benchmark harness.
 * Executes repair planning with telemetry and extracts metrics.
 */

import { plan, type ScoringStrategy } from "../oracle/planner.js";
import type { RepairPlan, VerifiedFix } from "../output/types.js";
import type {
  BenchmarkRun,
  RunMetrics,
  TimingMetrics,
  BuilderMetrics,
} from "./types.js";

// ============================================================================
// Builder Fix Names Registry
// ============================================================================

/**
 * Known builder fixNames mapped to their builder names.
 * This allows us to identify which fixes came from builders.
 */
const BUILDER_FIX_NAMES: Record<string, string> = {
  addModuleExtension: "ModuleExtensionBuilder",
  addMissingConstraintMembers: "GenericConstraintBuilder",
  addIntersectionReset: "InstantiationDepthBuilder",
  disableConditionalDistribution: "ConditionalTypeDistributionBuilder",
  addCatchAllOverload: "OverloadRepairBuilder",
};

/**
 * Check if a fixName indicates a builder-generated fix.
 */
function isBuilderFix(fixName: string): boolean {
  return fixName in BUILDER_FIX_NAMES;
}

/**
 * Get the builder name for a fixName, or undefined if not a builder fix.
 */
function getBuilderName(fixName: string): string | undefined {
  return BUILDER_FIX_NAMES[fixName];
}

// ============================================================================
// Run Options
// ============================================================================

/**
 * Options for executing a benchmark run.
 */
export interface RunOptions {
  /** Include high-risk fixes in the repair plan */
  includeHighRisk?: boolean;
  /** Enable verbose output during planning */
  verbose?: boolean;
}

// ============================================================================
// Single Run Executor
// ============================================================================

/**
 * Execute a single benchmark run.
 *
 * Calls the plan() function with telemetry enabled, captures timing,
 * and extracts comprehensive metrics from the result.
 *
 * @param configPath - Path to the tsconfig.json file
 * @param strategy - Scoring strategy to use (delta or weighted)
 * @param options - Optional configuration for the run
 * @returns Complete benchmark run results
 */
export function executeSingleRun(
  configPath: string,
  strategy: ScoringStrategy,
  options: RunOptions = {}
): BenchmarkRun {
  const startTime = performance.now();

  // Execute planning with telemetry enabled
  const result = plan(configPath, {
    scoringStrategy: strategy,
    enableTelemetry: true,
    includeHighRisk: options.includeHighRisk ?? false,
    useBuilders: true,
    onProgress: options.verbose ? (msg) => console.log(msg) : undefined,
  });

  const endTime = performance.now();
  const totalMs = endTime - startTime;

  return {
    configPath,
    strategy,
    result,
    timing: extractTimingMetrics(result, totalMs),
    metrics: extractRunMetrics(result),
    builderStats: extractBuilderStats(result),
  };
}

// ============================================================================
// Timing Metrics Extraction
// ============================================================================

/**
 * Extract timing metrics from a repair plan result.
 *
 * Uses telemetry data if available, otherwise falls back to basic timing.
 *
 * @param result - The repair plan from planning
 * @param totalMs - Total elapsed time in milliseconds
 * @returns Timing metrics for the run
 */
function extractTimingMetrics(result: RepairPlan, totalMs: number): TimingMetrics {
  const timing: TimingMetrics = {
    totalMs,
  };

  // Extract detailed timing from telemetry if available
  if (result.telemetry) {
    const telemetry = result.telemetry;

    timing.verificationMs = telemetry.totalTimeMs;

    // Calculate average verification time
    if (telemetry.totalVerifications > 0) {
      timing.avgVerificationMs = telemetry.totalTimeMs / telemetry.totalVerifications;
    }

    // Estimate diagnostics time as total - verifications
    // This is approximate since we don't have exact diagnostic timing
    const estimatedDiagnosticsMs = totalMs - telemetry.totalTimeMs;
    if (estimatedDiagnosticsMs > 0) {
      timing.diagnosticsMs = estimatedDiagnosticsMs;
    }
  }

  return timing;
}

// ============================================================================
// Run Metrics Extraction
// ============================================================================

/**
 * Extract run metrics from a repair plan.
 *
 * Calculates error counts, reduction ratios, candidate statistics,
 * and step analysis from the repair result.
 *
 * @param result - The repair plan from planning
 * @returns Comprehensive run metrics
 */
export function extractRunMetrics(result: RepairPlan): RunMetrics {
  const { summary, steps } = result;

  // Calculate error reduction ratio
  const errorReduction =
    summary.initialErrors > 0
      ? (summary.initialErrors - summary.finalErrors) / summary.initialErrors
      : 0;

  // Extract budget statistics
  const budget = summary.budget;
  const candidatesGenerated = budget.candidatesGenerated;
  const candidatesVerified = budget.candidatesVerified;
  const candidatesPruned = candidatesGenerated - candidatesVerified;

  // Calculate step statistics
  const stepsApplied = steps.length;

  // Calculate average delta per step
  const totalDelta = steps.reduce((sum, step) => sum + step.delta, 0);
  const avgDeltaPerStep = stepsApplied > 0 ? totalDelta / stepsApplied : 0;

  // Count regressions (steps that introduced new errors)
  // A regression is when errorsAfter > errorsBefore - 1 (i.e., more than one error introduced per fixed)
  // Actually, delta = errorsBefore - errorsAfter, so regression would be negative delta
  // But our algorithm only selects positive delta fixes, so we count steps with negative impact
  // In practice, this should always be 0 since we require delta > 0
  const regressionCount = steps.filter((step) => step.delta < 0).length;

  return {
    initialErrors: summary.initialErrors,
    finalErrors: summary.finalErrors,
    errorReduction,
    candidatesGenerated,
    candidatesVerified,
    candidatesPruned,
    stepsApplied,
    avgDeltaPerStep,
    regressionCount,
  };
}

// ============================================================================
// Builder Stats Extraction
// ============================================================================

/**
 * Statistics for a builder accumulated during analysis.
 */
interface BuilderAccumulator {
  diagnosticsMatched: number;
  candidatesGenerated: number;
  candidatesVerified: number;
  candidatesSelected: number;
  totalGenerationTimeMs: number;
}

/**
 * Extract per-builder statistics from a repair plan.
 *
 * Analyzes the steps to identify which fixes came from builders
 * and calculates success rates and other metrics.
 *
 * @param result - The repair plan from planning
 * @returns Array of per-builder metrics
 */
export function extractBuilderStats(result: RepairPlan): BuilderMetrics[] {
  const { steps } = result;

  // Track stats per builder
  const builderStats = new Map<string, BuilderAccumulator>();

  // Initialize stats for all known builders
  for (const builderName of Object.values(BUILDER_FIX_NAMES)) {
    if (!builderStats.has(builderName)) {
      builderStats.set(builderName, {
        diagnosticsMatched: 0,
        candidatesGenerated: 0,
        candidatesVerified: 0,
        candidatesSelected: 0,
        totalGenerationTimeMs: 0,
      });
    }
  }

  // Count selected candidates from each builder
  for (const step of steps) {
    const builderName = getBuilderName(step.fixName);
    if (builderName) {
      const stats = builderStats.get(builderName);
      if (stats) {
        stats.candidatesSelected++;
        // When a candidate is selected, it was also generated and verified
        stats.candidatesGenerated++;
        stats.candidatesVerified++;
        // Each selected fix addresses at least one diagnostic
        stats.diagnosticsMatched++;
      }
    }
  }

  // Note: We don't have detailed telemetry about all candidates that were
  // generated by builders but not selected. The current telemetry tracks
  // total candidates, not per-builder. For now, we base stats on selected fixes.
  //
  // In a more detailed implementation, we would:
  // 1. Track per-builder candidate generation in the planner
  // 2. Track per-builder verification results
  // 3. Export this in telemetry

  // Convert to BuilderMetrics array
  const metrics: BuilderMetrics[] = [];

  for (const [builderName, stats] of builderStats) {
    // Calculate success rate: selected / verified
    const fixSuccessRate =
      stats.candidatesVerified > 0
        ? stats.candidatesSelected / stats.candidatesVerified
        : 0;

    // Calculate false positives: matches that didn't result in valid fixes
    // For now, we assume all matched diagnostics resulted in valid fixes
    // since we only track selected candidates
    const falsePositives = 0;
    const falsePositiveRate = 0;

    // Calculate average generation time
    // Without per-builder timing data, we estimate this as 0
    const avgGenerationTimeMs = 0;

    metrics.push({
      builderName,
      diagnosticsMatched: stats.diagnosticsMatched,
      candidatesGenerated: stats.candidatesGenerated,
      candidatesVerified: stats.candidatesVerified,
      candidatesSelected: stats.candidatesSelected,
      fixSuccessRate,
      falsePositives,
      falsePositiveRate,
      avgGenerationTimeMs,
    });
  }

  // Filter out builders with no activity if desired
  // For now, include all builders for consistency in comparison
  return metrics;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a step was generated by any builder.
 */
export function isBuilderGeneratedStep(step: VerifiedFix): boolean {
  return isBuilderFix(step.fixName);
}

/**
 * Get the builder name for a step, or undefined if not builder-generated.
 */
export function getStepBuilderName(step: VerifiedFix): string | undefined {
  return getBuilderName(step.fixName);
}

/**
 * Count total fixes from builders in a repair plan.
 */
export function countBuilderFixes(result: RepairPlan): number {
  return result.steps.filter((step) => isBuilderFix(step.fixName)).length;
}

/**
 * Count fixes from a specific builder in a repair plan.
 */
export function countFixesFromBuilder(
  result: RepairPlan,
  builderName: string
): number {
  return result.steps.filter(
    (step) => getBuilderName(step.fixName) === builderName
  ).length;
}
