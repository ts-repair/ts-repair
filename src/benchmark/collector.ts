/**
 * Benchmark Metrics Collector
 *
 * Aggregates and analyzes benchmark results from multiple runs.
 * Provides functions to compare scoring strategies and measure builder effectiveness.
 */

import type { ScoringStrategy } from "../output/types.js";
import type {
  BenchmarkRun,
  BenchmarkResults,
  BenchmarkConfig,
  StrategyMetrics,
  StrategyComparison,
} from "./types.js";

// ============================================================================
// Main Collection Function
// ============================================================================

/**
 * Collect and aggregate results from multiple benchmark runs.
 *
 * @param runs - Array of completed benchmark runs
 * @param config - Configuration used for the benchmark
 * @returns Complete benchmark results with all aggregated metrics
 */
export function collectResults(
  runs: BenchmarkRun[],
  config: BenchmarkConfig
): BenchmarkResults {
  const byStrategy = aggregateByStrategy(runs);
  // Note: compareStrategies is exported for external use but not needed here
  const builderEffectiveness = aggregateBuilderEffectiveness(runs);
  const corpusSummary = calculateCorpusSummary(runs, config);

  const winner = determineWinner(byStrategy);

  return {
    timestamp: new Date().toISOString(),
    version: "0.2.0",
    config,
    runs,
    strategyComparison: {
      delta: byStrategy.delta,
      weighted: byStrategy.weighted,
      winner: winner.strategy,
      confidence: winner.confidence,
      recommendation: winner.recommendation,
    },
    builderEffectiveness,
    corpusSummary,
  };
}

// ============================================================================
// Strategy Aggregation
// ============================================================================

/**
 * Aggregate metrics by scoring strategy.
 *
 * Groups all runs by their strategy and computes aggregated metrics
 * for each strategy across all fixtures.
 *
 * @param runs - Array of benchmark runs
 * @returns Record mapping each strategy to its aggregated metrics
 */
export function aggregateByStrategy(
  runs: BenchmarkRun[]
): Record<ScoringStrategy, StrategyMetrics> {
  const deltaRuns = runs.filter((r) => r.strategy === "delta");
  const weightedRuns = runs.filter((r) => r.strategy === "weighted");

  return {
    delta: computeStrategyMetrics("delta", deltaRuns),
    weighted: computeStrategyMetrics("weighted", weightedRuns),
  };
}

/**
 * Compute aggregated metrics for a single strategy.
 */
function computeStrategyMetrics(
  strategy: ScoringStrategy,
  runs: BenchmarkRun[]
): StrategyMetrics {
  if (runs.length === 0) {
    return {
      strategy,
      totalFixesApplied: 0,
      totalErrorsFixed: 0,
      avgErrorReduction: 0,
      topCandidateSelectionRate: 0,
      totalTimeMs: 0,
      timePerErrorFixed: 0,
    };
  }

  // Aggregate totals
  let totalFixesApplied = 0;
  let totalErrorsFixed = 0;
  let totalErrorReduction = 0;
  let totalTimeMs = 0;
  let topCandidateSelections = 0;
  let totalTopCandidateOpportunities = 0;

  for (const run of runs) {
    totalFixesApplied += run.metrics.stepsApplied;
    const errorsFixed = run.metrics.initialErrors - run.metrics.finalErrors;
    totalErrorsFixed += errorsFixed;
    totalErrorReduction += run.metrics.errorReduction;
    totalTimeMs += run.timing.totalMs;

    // Top candidate selection: if we applied steps and they were effective
    if (run.metrics.stepsApplied > 0) {
      // Consider it a top candidate selection if the step had positive delta
      // We use stepsApplied as the denominator (opportunities to select top)
      totalTopCandidateOpportunities += run.metrics.stepsApplied;
      // Assume steps with avg delta > 0 are from good candidate selection
      if (run.metrics.avgDeltaPerStep > 0) {
        topCandidateSelections += run.metrics.stepsApplied;
      }
    }
  }

  // Compute averages
  const avgErrorReduction = totalErrorReduction / runs.length;
  const topCandidateSelectionRate =
    totalTopCandidateOpportunities > 0
      ? topCandidateSelections / totalTopCandidateOpportunities
      : 0;
  const timePerErrorFixed =
    totalErrorsFixed > 0 ? totalTimeMs / totalErrorsFixed : 0;

  return {
    strategy,
    totalFixesApplied,
    totalErrorsFixed,
    avgErrorReduction,
    topCandidateSelectionRate,
    totalTimeMs,
    timePerErrorFixed,
  };
}

// ============================================================================
// Strategy Comparison
// ============================================================================

/**
 * Compare strategies on matched fixture pairs.
 *
 * For each fixture that was run with both delta and weighted strategies,
 * produces a comparison showing which strategy performed better.
 *
 * @param runs - Array of benchmark runs
 * @returns Array of strategy comparisons for each matched fixture
 */
export function compareStrategies(runs: BenchmarkRun[]): StrategyComparison[] {
  // Group runs by configPath
  const runsByConfig = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    const existing = runsByConfig.get(run.configPath) ?? [];
    existing.push(run);
    runsByConfig.set(run.configPath, existing);
  }

  const comparisons: StrategyComparison[] = [];

  // For each fixture, find matching delta and weighted runs
  for (const [configPath, fixtureRuns] of runsByConfig) {
    const deltaRun = fixtureRuns.find((r) => r.strategy === "delta");
    const weightedRun = fixtureRuns.find((r) => r.strategy === "weighted");

    // Only compare if we have both strategies
    if (!deltaRun || !weightedRun) {
      continue;
    }

    // Calculate differences (positive means weighted was better/more)
    const deltaErrorsFixed =
      deltaRun.metrics.initialErrors - deltaRun.metrics.finalErrors;
    const weightedErrorsFixed =
      weightedRun.metrics.initialErrors - weightedRun.metrics.finalErrors;
    const errorsFixedDiff = weightedErrorsFixed - deltaErrorsFixed;

    const deltaVerifications = deltaRun.metrics.candidatesVerified;
    const weightedVerifications = weightedRun.metrics.candidatesVerified;
    const verificationCountDiff = weightedVerifications - deltaVerifications;

    const timingDiff = weightedRun.timing.totalMs - deltaRun.timing.totalMs;

    // Determine winner based on errors fixed (primary metric)
    let winner: "delta" | "weighted" | "tie";
    if (errorsFixedDiff > 0) {
      winner = "weighted";
    } else if (errorsFixedDiff < 0) {
      winner = "delta";
    } else {
      // Tie on errors, use time as tiebreaker (faster wins)
      if (timingDiff < 0) {
        winner = "weighted"; // weighted was faster
      } else if (timingDiff > 0) {
        winner = "delta"; // delta was faster
      } else {
        winner = "tie";
      }
    }

    // Extract fixture name from configPath
    const fixtureName = extractFixtureName(configPath);

    comparisons.push({
      fixture: fixtureName,
      delta: deltaRun,
      weighted: weightedRun,
      winner,
      comparison: {
        errorsFixedDiff,
        verificationCountDiff,
        timingDiff,
      },
    });
  }

  return comparisons;
}

/**
 * Extract a human-readable fixture name from a config path.
 */
function extractFixtureName(configPath: string): string {
  // Try to extract the fixture directory name
  const parts = configPath.split("/");
  const tsconfigIndex = parts.findIndex((p) => p === "tsconfig.json");
  if (tsconfigIndex > 0) {
    return parts[tsconfigIndex - 1];
  }
  // Fall back to second-to-last component or the path itself
  return parts[parts.length - 2] ?? configPath;
}

// ============================================================================
// Builder Effectiveness
// ============================================================================

/**
 * Aggregate builder effectiveness metrics across all runs.
 *
 * Combines BuilderMetrics from all runs to calculate overall
 * success rates and false positive rates per builder.
 *
 * @param runs - Array of benchmark runs
 * @returns Record mapping builder names to aggregated effectiveness metrics
 */
export function aggregateBuilderEffectiveness(
  runs: BenchmarkRun[]
): Record<
  string,
  {
    totalMatches: number;
    successRate: number;
    falsePositiveRate: number;
    avgTimeMs: number;
  }
> {
  // Aggregate builder metrics across all runs
  const builderAggregates = new Map<
    string,
    {
      totalMatches: number;
      totalCandidatesSelected: number;
      totalFalsePositives: number;
      totalGenerationTimeMs: number;
      runCount: number;
    }
  >();

  for (const run of runs) {
    for (const builderStat of run.builderStats) {
      const existing = builderAggregates.get(builderStat.builderName) ?? {
        totalMatches: 0,
        totalCandidatesSelected: 0,
        totalFalsePositives: 0,
        totalGenerationTimeMs: 0,
        runCount: 0,
      };

      existing.totalMatches += builderStat.diagnosticsMatched;
      existing.totalCandidatesSelected += builderStat.candidatesSelected;
      existing.totalFalsePositives += builderStat.falsePositives;
      existing.totalGenerationTimeMs += builderStat.avgGenerationTimeMs;
      existing.runCount += 1;

      builderAggregates.set(builderStat.builderName, existing);
    }
  }

  // Convert to result format
  const result: Record<
    string,
    {
      totalMatches: number;
      successRate: number;
      falsePositiveRate: number;
      avgTimeMs: number;
    }
  > = {};

  for (const [builderName, aggregate] of builderAggregates) {
    const successRate =
      aggregate.totalMatches > 0
        ? aggregate.totalCandidatesSelected / aggregate.totalMatches
        : 0;
    const falsePositiveRate =
      aggregate.totalMatches > 0
        ? aggregate.totalFalsePositives / aggregate.totalMatches
        : 0;
    const avgTimeMs =
      aggregate.runCount > 0
        ? aggregate.totalGenerationTimeMs / aggregate.runCount
        : 0;

    result[builderName] = {
      totalMatches: aggregate.totalMatches,
      successRate,
      falsePositiveRate,
      avgTimeMs,
    };
  }

  return result;
}

// ============================================================================
// Corpus Summary
// ============================================================================

/**
 * Calculate summary statistics for the benchmark corpus.
 *
 * Aggregates total fixtures, errors, and coverage by category.
 *
 * @param runs - Array of benchmark runs
 * @param config - Benchmark configuration
 * @returns Corpus summary with totals and coverage breakdown
 */
export function calculateCorpusSummary(
  runs: BenchmarkRun[],
  config: BenchmarkConfig
): {
  totalFixtures: number;
  totalErrors: number;
  totalFixed: number;
  coverageByCategory: Record<string, number>;
} {
  // Get unique fixtures from runs
  const uniqueFixtures = new Set<string>();
  for (const run of runs) {
    uniqueFixtures.add(run.configPath);
  }

  // Calculate total errors and total fixed
  // Use delta strategy runs to avoid double-counting
  let totalErrors = 0;
  let totalFixed = 0;
  const fixturesTotalErrors = new Map<string, number>();
  const fixturesTotalFixed = new Map<string, number>();

  for (const run of runs) {
    // Only count once per fixture (use the first run we see)
    if (!fixturesTotalErrors.has(run.configPath)) {
      fixturesTotalErrors.set(run.configPath, run.metrics.initialErrors);
      totalErrors += run.metrics.initialErrors;
    }
    // Track best fixed count per fixture across strategies
    const currentFixed = fixturesTotalFixed.get(run.configPath) ?? 0;
    const runFixed = run.metrics.initialErrors - run.metrics.finalErrors;
    if (runFixed > currentFixed) {
      fixturesTotalFixed.set(run.configPath, runFixed);
    }
  }

  // Sum up total fixed
  for (const fixed of fixturesTotalFixed.values()) {
    totalFixed += fixed;
  }

  // Calculate coverage by category
  const coverageByCategory: Record<string, number> = {};
  const corpusEntries = config.corpus.entries;

  // Build a map of configPath to category
  const categoryByConfig = new Map<string, string>();
  for (const entry of corpusEntries) {
    categoryByConfig.set(entry.configPath, entry.category);
  }

  // Count fixtures per category
  const totalByCategory = new Map<string, number>();
  const fixedByCategory = new Map<string, number>();

  for (const entry of corpusEntries) {
    const currentTotal = totalByCategory.get(entry.category) ?? 0;
    totalByCategory.set(entry.category, currentTotal + 1);
  }

  // Count covered fixtures per category
  for (const configPath of uniqueFixtures) {
    const category = categoryByConfig.get(configPath);
    if (category) {
      const currentFixed = fixedByCategory.get(category) ?? 0;
      fixedByCategory.set(category, currentFixed + 1);
    }
  }

  // Calculate coverage ratios
  for (const [category, total] of totalByCategory) {
    const fixed = fixedByCategory.get(category) ?? 0;
    coverageByCategory[category] = total > 0 ? fixed / total : 0;
  }

  return {
    totalFixtures: uniqueFixtures.size,
    totalErrors,
    totalFixed,
    coverageByCategory,
  };
}

// ============================================================================
// Winner Determination
// ============================================================================

/**
 * Determine the winning strategy based on aggregated metrics.
 *
 * Uses multiple criteria with decreasing priority:
 * 1. Total errors fixed
 * 2. Error reduction ratio
 * 3. Time efficiency (errors fixed per ms)
 *
 * @param byStrategy - Aggregated metrics by strategy
 * @returns Winner determination with confidence and recommendation
 */
function determineWinner(
  byStrategy: Record<ScoringStrategy, StrategyMetrics>
): { strategy: ScoringStrategy; confidence: number; recommendation: string } {
  const delta = byStrategy.delta;
  const weighted = byStrategy.weighted;

  // Calculate scores for each strategy
  let deltaScore = 0;
  let weightedScore = 0;
  let totalCriteria = 0;

  // Criterion 1: Total errors fixed (most important)
  totalCriteria += 2; // Weight of 2
  if (delta.totalErrorsFixed > weighted.totalErrorsFixed) {
    deltaScore += 2;
  } else if (weighted.totalErrorsFixed > delta.totalErrorsFixed) {
    weightedScore += 2;
  } else {
    deltaScore += 1;
    weightedScore += 1;
  }

  // Criterion 2: Average error reduction
  totalCriteria += 1;
  if (delta.avgErrorReduction > weighted.avgErrorReduction) {
    deltaScore += 1;
  } else if (weighted.avgErrorReduction > delta.avgErrorReduction) {
    weightedScore += 1;
  } else {
    deltaScore += 0.5;
    weightedScore += 0.5;
  }

  // Criterion 3: Time efficiency (lower timePerErrorFixed is better)
  totalCriteria += 1;
  if (
    delta.timePerErrorFixed > 0 &&
    weighted.timePerErrorFixed > 0 &&
    delta.timePerErrorFixed < weighted.timePerErrorFixed
  ) {
    deltaScore += 1;
  } else if (
    delta.timePerErrorFixed > 0 &&
    weighted.timePerErrorFixed > 0 &&
    weighted.timePerErrorFixed < delta.timePerErrorFixed
  ) {
    weightedScore += 1;
  } else {
    deltaScore += 0.5;
    weightedScore += 0.5;
  }

  // Determine winner
  let strategy: ScoringStrategy;
  let recommendation: string;

  if (deltaScore > weightedScore) {
    strategy = "delta";
    recommendation = generateRecommendation("delta", delta, weighted);
  } else if (weightedScore > deltaScore) {
    strategy = "weighted";
    recommendation = generateRecommendation("weighted", delta, weighted);
  } else {
    // Tie - prefer delta as it's simpler
    strategy = "delta";
    recommendation =
      "Both strategies performed similarly. Delta strategy recommended for simplicity.";
  }

  // Calculate confidence (0-1)
  const scoreDiff = Math.abs(deltaScore - weightedScore);
  const maxPossibleDiff = totalCriteria;
  const confidence = Math.min(1, scoreDiff / maxPossibleDiff + 0.5);

  return { strategy, confidence, recommendation };
}

/**
 * Generate a human-readable recommendation based on the results.
 */
function generateRecommendation(
  winner: ScoringStrategy,
  delta: StrategyMetrics,
  weighted: StrategyMetrics
): string {
  const winnerMetrics = winner === "delta" ? delta : weighted;
  const loserMetrics = winner === "delta" ? weighted : delta;

  const errorsDiff = winnerMetrics.totalErrorsFixed - loserMetrics.totalErrorsFixed;
  const reductionDiff = (
    (winnerMetrics.avgErrorReduction - loserMetrics.avgErrorReduction) *
    100
  ).toFixed(1);

  if (errorsDiff > 0) {
    return `${winner} strategy recommended: fixed ${errorsDiff} more errors with ${reductionDiff}% better average reduction.`;
  } else if (Number(reductionDiff) > 0) {
    return `${winner} strategy recommended: ${reductionDiff}% better average error reduction.`;
  } else {
    return `${winner} strategy recommended: more efficient time-per-error performance.`;
  }
}
