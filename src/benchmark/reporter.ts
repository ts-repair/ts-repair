/**
 * Benchmark Reporter
 *
 * Formats benchmark results in multiple output formats:
 * - JSON: Full machine-readable results
 * - CSV: Tabular data for spreadsheet analysis
 * - Text: Human-readable summary with tables and recommendations
 */

import { writeFileSync } from "fs";
import path from "path";
import type { ScoringStrategy } from "../output/types.js";
import type { BenchmarkResults, BenchmarkRun } from "./types.js";

// ============================================================================
// JSON Output
// ============================================================================

/**
 * Format benchmark results as pretty-printed JSON.
 *
 * Includes all metrics, comparisons, and builder statistics
 * for machine processing and detailed analysis.
 *
 * @param results - Complete benchmark results
 * @returns Pretty-printed JSON string
 */
export function formatAsJson(results: BenchmarkResults): string {
  return JSON.stringify(results, null, 2);
}

// ============================================================================
// CSV Output
// ============================================================================

/**
 * Format benchmark results as CSV.
 *
 * One row per fixture/strategy combination with columns for
 * all key metrics. Suitable for spreadsheet analysis.
 *
 * Columns: fixture, strategy, initial_errors, final_errors, error_reduction,
 *          fixes_applied, time_ms, builder_fixes
 *
 * @param results - Complete benchmark results
 * @returns CSV string with header row
 */
export function formatAsCsv(results: BenchmarkResults): string {
  const lines: string[] = [];

  // Header row
  lines.push(
    [
      "fixture",
      "strategy",
      "initial_errors",
      "final_errors",
      "error_reduction",
      "fixes_applied",
      "time_ms",
      "builder_fixes",
    ].join(",")
  );

  // Data rows - one per run
  for (const run of results.runs) {
    const fixtureName = extractFixtureName(run.configPath);
    const builderFixes = countBuilderFixes(run);

    lines.push(
      [
        escapeCsvField(fixtureName),
        run.strategy,
        run.metrics.initialErrors,
        run.metrics.finalErrors,
        run.metrics.errorReduction.toFixed(4),
        run.metrics.stepsApplied,
        Math.round(run.timing.totalMs),
        builderFixes,
      ].join(",")
    );
  }

  return lines.join("\n");
}

/**
 * Escape a CSV field value.
 * Wraps in quotes if contains comma, quote, or newline.
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Count builder-generated fixes in a run.
 */
function countBuilderFixes(run: BenchmarkRun): number {
  return run.builderStats.reduce(
    (sum, stat) => sum + stat.candidatesSelected,
    0
  );
}

// ============================================================================
// Text Output
// ============================================================================

/**
 * Format benchmark results as human-readable text.
 *
 * Includes:
 * - Header with timestamp and version
 * - Strategy comparison table
 * - Builder effectiveness table
 * - Per-fixture results table
 * - Clear recommendation
 *
 * @param results - Complete benchmark results
 * @returns Formatted text string for console/file output
 */
export function formatAsText(results: BenchmarkResults): string {
  const lines: string[] = [];

  // Header
  lines.push(...formatHeader(results));
  lines.push("");

  // Strategy comparison
  lines.push(...formatStrategyComparison(results));
  lines.push("");

  // Builder effectiveness
  lines.push(...formatBuilderEffectiveness(results));
  lines.push("");

  // Fixture results
  lines.push(...formatFixtureResults(results));

  // Footer
  lines.push("=".repeat(65));

  return lines.join("\n");
}

/**
 * Format the header section with title, corpus summary, and run date.
 */
function formatHeader(results: BenchmarkResults): string[] {
  const lines: string[] = [];

  lines.push("=".repeat(65));
  lines.push("           ts-repair Scoring Strategy Benchmark Results");
  lines.push("=".repeat(65));
  lines.push("");

  // Extract date from timestamp
  const runDate = results.timestamp.split("T")[0];

  lines.push(
    `Corpus: ${results.corpusSummary.totalFixtures} fixtures, ${results.corpusSummary.totalErrors} initial errors`
  );
  lines.push(`Run Date: ${runDate}`);
  lines.push(`Version: ${results.version}`);

  return lines;
}

/**
 * Format the strategy comparison table.
 */
function formatStrategyComparison(results: BenchmarkResults): string[] {
  const lines: string[] = [];
  const { delta, weighted } = results.strategyComparison;

  lines.push("STRATEGY COMPARISON");
  lines.push("-".repeat(65));

  // Calculate differences (positive = weighted better)
  const errorsFixedDiff = weighted.totalErrorsFixed - delta.totalErrorsFixed;
  const reductionDiff =
    (weighted.avgErrorReduction - delta.avgErrorReduction) * 100;
  const timeDiff =
    weighted.totalTimeMs / Math.max(results.runs.filter(r => r.strategy === "weighted").length, 1) -
    delta.totalTimeMs / Math.max(results.runs.filter(r => r.strategy === "delta").length, 1);

  // Table header
  lines.push(
    padRight("", 24) +
      padRight("delta", 14) +
      padRight("weighted", 14) +
      "diff"
  );

  // Errors Fixed row
  lines.push(
    padRight("Errors Fixed:", 24) +
      padRight(String(delta.totalErrorsFixed), 14) +
      padRight(String(weighted.totalErrorsFixed), 14) +
      formatDiff(errorsFixedDiff)
  );

  // Fix Success Rate row
  const deltaRate = (delta.avgErrorReduction * 100).toFixed(0) + "%";
  const weightedRate = (weighted.avgErrorReduction * 100).toFixed(0) + "%";
  lines.push(
    padRight("Fix Success Rate:", 24) +
      padRight(deltaRate, 14) +
      padRight(weightedRate, 14) +
      formatDiffPercent(reductionDiff)
  );

  // Avg Time/Fixture row
  const deltaAvgTime = calculateAvgTimePerFixture(results, "delta");
  const weightedAvgTime = calculateAvgTimePerFixture(results, "weighted");
  lines.push(
    padRight("Avg Time/Fixture:", 24) +
      padRight(deltaAvgTime + "ms", 14) +
      padRight(weightedAvgTime + "ms", 14) +
      formatDiffMs(timeDiff)
  );

  // Regressions row (false positives / regressions)
  const deltaRegressions = countTotalRegressions(results, "delta");
  const weightedRegressions = countTotalRegressions(results, "weighted");
  lines.push(
    padRight("Regressions:", 24) +
      padRight(String(deltaRegressions), 14) +
      padRight(String(weightedRegressions), 14) +
      String(weightedRegressions - deltaRegressions)
  );

  lines.push("");

  // Recommendation
  lines.push(
    `RECOMMENDATION: Use "${results.strategyComparison.winner}" as default`
  );
  lines.push(`Rationale: ${results.strategyComparison.recommendation}`);
  lines.push(`Confidence: ${(results.strategyComparison.confidence * 100).toFixed(0)}%`);

  return lines;
}

/**
 * Format the builder effectiveness table.
 */
function formatBuilderEffectiveness(results: BenchmarkResults): string[] {
  const lines: string[] = [];

  lines.push("BUILDER EFFECTIVENESS");
  lines.push("-".repeat(65));

  // Table header
  lines.push(
    padRight("Builder", 28) +
      padRight("Matches", 10) +
      padRight("Success Rate", 14) +
      "False Pos"
  );

  // Get builders sorted by matches (descending)
  const builders = Object.entries(results.builderEffectiveness)
    .sort((a, b) => b[1].totalMatches - a[1].totalMatches);

  for (const [builderName, stats] of builders) {
    const successRate = (stats.successRate * 100).toFixed(0) + "%";
    const falsePositiveRate = (stats.falsePositiveRate * 100).toFixed(0) + "%";

    lines.push(
      padRight(builderName, 28) +
        padRight(String(stats.totalMatches), 10) +
        padRight(successRate, 14) +
        falsePositiveRate
    );
  }

  return lines;
}

/**
 * Format the per-fixture results table.
 */
function formatFixtureResults(results: BenchmarkResults): string[] {
  const lines: string[] = [];

  lines.push("FIXTURE RESULTS");
  lines.push("-".repeat(65));

  // Table header
  lines.push(
    padRight("Fixture", 28) +
      padRight("delta", 10) +
      padRight("weighted", 10) +
      "Winner"
  );

  // Group runs by fixture
  const runsByFixture = groupRunsByFixture(results.runs);

  for (const [fixtureName, runs] of runsByFixture) {
    const deltaRun = runs.find((r) => r.strategy === "delta");
    const weightedRun = runs.find((r) => r.strategy === "weighted");

    const deltaReduction = deltaRun
      ? (deltaRun.metrics.errorReduction * 100).toFixed(0) + "%"
      : "N/A";
    const weightedReduction = weightedRun
      ? (weightedRun.metrics.errorReduction * 100).toFixed(0) + "%"
      : "N/A";

    const winner = determineFixtureWinner(deltaRun, weightedRun);

    lines.push(
      padRight(truncate(fixtureName, 26), 28) +
        padRight(deltaReduction, 10) +
        padRight(weightedReduction, 10) +
        winner
    );
  }

  return lines;
}

// ============================================================================
// File Writing Helpers
// ============================================================================

/**
 * Write benchmark results as JSON to a file.
 *
 * @param results - Complete benchmark results
 * @param filePath - Output file path
 */
export function writeJsonReport(
  results: BenchmarkResults,
  filePath: string
): void {
  const content = formatAsJson(results);
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Write benchmark results as CSV to a file.
 *
 * @param results - Complete benchmark results
 * @param filePath - Output file path
 */
export function writeCsvReport(
  results: BenchmarkResults,
  filePath: string
): void {
  const content = formatAsCsv(results);
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Write benchmark results as human-readable text to a file.
 *
 * @param results - Complete benchmark results
 * @param filePath - Output file path
 */
export function writeTextReport(
  results: BenchmarkResults,
  filePath: string
): void {
  const content = formatAsText(results);
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Write all report formats to a directory.
 *
 * Creates three files:
 * - benchmark-results.json
 * - benchmark-results.csv
 * - benchmark-results.txt
 *
 * @param results - Complete benchmark results
 * @param outputDir - Output directory path
 */
export function writeAllReports(
  results: BenchmarkResults,
  outputDir: string
): void {
  writeJsonReport(results, path.join(outputDir, "benchmark-results.json"));
  writeCsvReport(results, path.join(outputDir, "benchmark-results.csv"));
  writeTextReport(results, path.join(outputDir, "benchmark-results.txt"));
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract a human-readable fixture name from a config path.
 */
function extractFixtureName(configPath: string): string {
  const parts = configPath.split("/");
  const tsconfigIndex = parts.findIndex((p) => p === "tsconfig.json");
  if (tsconfigIndex > 0) {
    return parts[tsconfigIndex - 1];
  }
  return parts[parts.length - 2] ?? configPath;
}

/**
 * Group runs by fixture name.
 */
function groupRunsByFixture(
  runs: BenchmarkRun[]
): Map<string, BenchmarkRun[]> {
  const grouped = new Map<string, BenchmarkRun[]>();

  for (const run of runs) {
    const name = extractFixtureName(run.configPath);
    const existing = grouped.get(name) ?? [];
    existing.push(run);
    grouped.set(name, existing);
  }

  return grouped;
}

/**
 * Calculate average time per fixture for a strategy.
 */
function calculateAvgTimePerFixture(
  results: BenchmarkResults,
  strategy: ScoringStrategy
): string {
  const runs = results.runs.filter((r) => r.strategy === strategy);
  if (runs.length === 0) return "0";

  const totalTime = runs.reduce((sum, r) => sum + r.timing.totalMs, 0);
  return Math.round(totalTime / runs.length).toString();
}

/**
 * Count total regressions for a strategy.
 */
function countTotalRegressions(
  results: BenchmarkResults,
  strategy: ScoringStrategy
): number {
  const runs = results.runs.filter((r) => r.strategy === strategy);
  return runs.reduce((sum, r) => sum + r.metrics.regressionCount, 0);
}

/**
 * Determine the winner for a single fixture.
 */
function determineFixtureWinner(
  deltaRun: BenchmarkRun | undefined,
  weightedRun: BenchmarkRun | undefined
): string {
  if (!deltaRun && !weightedRun) return "N/A";
  if (!deltaRun) return "weighted";
  if (!weightedRun) return "delta";

  const deltaFixed =
    deltaRun.metrics.initialErrors - deltaRun.metrics.finalErrors;
  const weightedFixed =
    weightedRun.metrics.initialErrors - weightedRun.metrics.finalErrors;

  if (weightedFixed > deltaFixed) return "weighted";
  if (deltaFixed > weightedFixed) return "delta";
  return "tie";
}

/**
 * Pad a string to the right with spaces.
 */
function padRight(str: string, width: number): string {
  return str.padEnd(width);
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Format a numeric difference with +/- prefix.
 */
function formatDiff(diff: number): string {
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return String(diff);
  return "0";
}

/**
 * Format a percentage difference with +/- prefix.
 */
function formatDiffPercent(diff: number): string {
  const rounded = Math.round(diff);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return "0%";
}

/**
 * Format a millisecond difference with +/- prefix.
 */
function formatDiffMs(diff: number): string {
  const rounded = Math.round(diff);
  if (rounded > 0) return `+${rounded}ms`;
  if (rounded < 0) return `${rounded}ms`;
  return "0ms";
}
