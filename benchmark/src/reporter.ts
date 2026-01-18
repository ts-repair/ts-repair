/**
 * Benchmark reporter - comparison logic and output formatting
 */

import * as fs from 'node:fs';
import chalk from 'chalk';
import type {
  RunResult,
  Comparison,
  CategorySavings,
  Diagnostic,
  ScalingAnalysis,
  ErrorCategory,
} from './types.js';
import { formatTokenCount, formatCost, calculateCost } from './token-counter.js';

/**
 * Compare vanilla and ts-repair results
 */
export function compare(vanilla: RunResult, tsRepair: RunResult): Comparison {
  const tokenSavings =
    vanilla.totalTokens > 0
      ? ((vanilla.totalTokens - tsRepair.totalTokens) / vanilla.totalTokens) * 100
      : 0;

  const roundSavings =
    vanilla.rounds.length > 0
      ? ((vanilla.rounds.length - tsRepair.rounds.length) / vanilla.rounds.length) * 100
      : 0;

  const autoFixRate =
    vanilla.initialDiagnosticCount > 0
      ? ((tsRepair.autoFixed ?? 0) / vanilla.initialDiagnosticCount) * 100
      : 0;

  return {
    vanilla,
    tsRepair,
    tokenSavingsPercent: tokenSavings,
    roundSavingsPercent: roundSavings,
    autoFixRate,
    savingsByErrorCategory: computeCategorySavings(vanilla, tsRepair),
  };
}

/**
 * Compute savings broken down by error category
 */
function computeCategorySavings(
  vanilla: RunResult,
  tsRepair: RunResult
): CategorySavings {
  // Count initial diagnostics by category
  const countByCategory = (diagnostics: Diagnostic[]): Record<ErrorCategory, number> => {
    const counts: Record<ErrorCategory, number> = {
      cascade: 0,
      mechanical: 0,
      judgment: 0,
    };
    for (const d of diagnostics) {
      counts[d.category]++;
    }
    return counts;
  };

  // Get initial diagnostics from first round
  const vanillaInitial =
    vanilla.rounds[0]?.diagnosticsAtStart ?? [];
  const tsRepairInitial =
    tsRepair.rounds[0]?.diagnosticsAtStart ?? [];

  const vanillaCounts = countByCategory(vanillaInitial);
  const tsRepairCounts = countByCategory(tsRepairInitial);

  // Estimate tokens per category based on proportion
  const totalVanillaErrors = Object.values(vanillaCounts).reduce((a, b) => a + b, 0);
  const totalTsRepairErrors = Object.values(tsRepairCounts).reduce((a, b) => a + b, 0);

  const categoryTokens = (
    counts: Record<ErrorCategory, number>,
    totalTokens: number,
    totalErrors: number
  ): Record<ErrorCategory, number> => {
    if (totalErrors === 0) {
      return { cascade: 0, mechanical: 0, judgment: 0 };
    }
    return {
      cascade: Math.round((counts.cascade / totalErrors) * totalTokens),
      mechanical: Math.round((counts.mechanical / totalErrors) * totalTokens),
      judgment: Math.round((counts.judgment / totalErrors) * totalTokens),
    };
  };

  const vanillaTokens = categoryTokens(vanillaCounts, vanilla.totalTokens, totalVanillaErrors);
  const tsRepairTokens = categoryTokens(tsRepairCounts, tsRepair.totalTokens, totalTsRepairErrors);

  return {
    cascade: { vanilla: vanillaTokens.cascade, tsRepair: tsRepairTokens.cascade },
    mechanical: { vanilla: vanillaTokens.mechanical, tsRepair: tsRepairTokens.mechanical },
    judgment: { vanilla: vanillaTokens.judgment, tsRepair: tsRepairTokens.judgment },
  };
}

/**
 * Print a colored console report
 */
export function printConsoleReport(comparison: Comparison): void {
  const { vanilla, tsRepair, tokenSavingsPercent, roundSavingsPercent, autoFixRate } = comparison;

  console.log('\n' + chalk.bold('═══════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('                    ts-repair Benchmark Results'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════\n'));

  // Configuration
  console.log(chalk.bold('Configuration:'));
  console.log(`  Project: ${chalk.yellow(vanilla.config.name)}`);
  console.log(`  Initial errors: ${chalk.yellow(vanilla.initialDiagnosticCount)}`);
  console.log(`  Seed: ${chalk.yellow(vanilla.config.seed)}`);
  console.log();

  // Summary table
  console.log(chalk.bold('Results Summary:'));
  console.log('  ' + '─'.repeat(60));
  console.log(
    `  ${chalk.bold('Metric'.padEnd(25))} ${chalk.bold('Vanilla'.padEnd(15))} ${chalk.bold('ts-repair'.padEnd(15))} ${chalk.bold('Savings')}`
  );
  console.log('  ' + '─'.repeat(60));

  // Rounds
  console.log(
    `  ${'Rounds'.padEnd(25)} ${vanilla.rounds.length.toString().padEnd(15)} ${tsRepair.rounds.length.toString().padEnd(15)} ${formatPercent(roundSavingsPercent)}`
  );

  // Total tokens
  console.log(
    `  ${'Total tokens'.padEnd(25)} ${formatTokenCount(vanilla.totalTokens).padEnd(15)} ${formatTokenCount(tsRepair.totalTokens).padEnd(15)} ${formatPercent(tokenSavingsPercent)}`
  );

  // Prompt tokens
  console.log(
    `  ${'Prompt tokens'.padEnd(25)} ${formatTokenCount(vanilla.totalPromptTokens).padEnd(15)} ${formatTokenCount(tsRepair.totalPromptTokens).padEnd(15)} ${formatPercent(
      vanilla.totalPromptTokens > 0
        ? ((vanilla.totalPromptTokens - tsRepair.totalPromptTokens) / vanilla.totalPromptTokens) * 100
        : 0
    )}`
  );

  // Completion tokens
  console.log(
    `  ${'Completion tokens'.padEnd(25)} ${formatTokenCount(vanilla.totalCompletionTokens).padEnd(15)} ${formatTokenCount(tsRepair.totalCompletionTokens).padEnd(15)} ${formatPercent(
      vanilla.totalCompletionTokens > 0
        ? ((vanilla.totalCompletionTokens - tsRepair.totalCompletionTokens) / vanilla.totalCompletionTokens) * 100
        : 0
    )}`
  );

  // Estimated cost
  const vanillaCost = calculateCost(vanilla.totalPromptTokens, vanilla.totalCompletionTokens);
  const tsRepairCost = calculateCost(tsRepair.totalPromptTokens, tsRepair.totalCompletionTokens);
  console.log(
    `  ${'Estimated cost'.padEnd(25)} ${formatCost(vanillaCost).padEnd(15)} ${formatCost(tsRepairCost).padEnd(15)} ${formatPercent(
      vanillaCost > 0 ? ((vanillaCost - tsRepairCost) / vanillaCost) * 100 : 0
    )}`
  );

  // Wall time
  console.log(
    `  ${'Wall time'.padEnd(25)} ${formatMs(vanilla.totalWallTimeMs).padEnd(15)} ${formatMs(tsRepair.totalWallTimeMs).padEnd(15)} ${formatPercent(
      vanilla.totalWallTimeMs > 0
        ? ((vanilla.totalWallTimeMs - tsRepair.totalWallTimeMs) / vanilla.totalWallTimeMs) * 100
        : 0
    )}`
  );

  console.log('  ' + '─'.repeat(60));
  console.log();

  // ts-repair specific metrics
  console.log(chalk.bold('ts-repair Metrics:'));
  console.log(`  Auto-fixed: ${chalk.green(tsRepair.autoFixed ?? 0)} errors (${formatPercent(autoFixRate)} of total)`);
  console.log(`  Punted to LLM: ${chalk.yellow(tsRepair.puntedToLlm ?? 0)} errors`);
  console.log();

  // Success status
  console.log(chalk.bold('Success:'));
  console.log(
    `  Vanilla: ${vanilla.success ? chalk.green('✓ All errors resolved') : chalk.red(`✗ ${vanilla.finalDiagnosticCount} errors remaining`)}`
  );
  console.log(
    `  ts-repair: ${tsRepair.success ? chalk.green('✓ All errors resolved') : chalk.red(`✗ ${tsRepair.finalDiagnosticCount} errors remaining`)}`
  );
  console.log();

  // Bottom line
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════'));
  if (tokenSavingsPercent > 0) {
    console.log(
      chalk.green.bold(
        `  🎉 ts-repair saved ${tokenSavingsPercent.toFixed(1)}% tokens (${formatTokenCount(vanilla.totalTokens - tsRepair.totalTokens)} tokens)`
      )
    );
  } else {
    console.log(
      chalk.yellow.bold(
        `  ⚠ ts-repair used ${(-tokenSavingsPercent).toFixed(1)}% more tokens`
      )
    );
  }
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════\n'));
}

/**
 * Format a percentage with color
 */
function formatPercent(value: number): string {
  const formatted = `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  if (value > 0) {
    return chalk.green(formatted);
  } else if (value < 0) {
    return chalk.red(formatted);
  }
  return chalk.gray(formatted);
}

/**
 * Format milliseconds
 */
function formatMs(ms: number): string {
  if (ms >= 60000) {
    return `${(ms / 60000).toFixed(1)}m`;
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${ms}ms`;
}

/**
 * Export results to JSON
 */
export function exportJson(results: Comparison[], filePath: string): void {
  const data = {
    timestamp: new Date().toISOString(),
    results: results.map((r) => ({
      config: r.vanilla.config,
      vanilla: {
        initialDiagnostics: r.vanilla.initialDiagnosticCount,
        finalDiagnostics: r.vanilla.finalDiagnosticCount,
        rounds: r.vanilla.rounds.length,
        promptTokens: r.vanilla.totalPromptTokens,
        completionTokens: r.vanilla.totalCompletionTokens,
        totalTokens: r.vanilla.totalTokens,
        wallTimeMs: r.vanilla.totalWallTimeMs,
        success: r.vanilla.success,
      },
      tsRepair: {
        initialDiagnostics: r.tsRepair.initialDiagnosticCount,
        finalDiagnostics: r.tsRepair.finalDiagnosticCount,
        rounds: r.tsRepair.rounds.length,
        promptTokens: r.tsRepair.totalPromptTokens,
        completionTokens: r.tsRepair.totalCompletionTokens,
        totalTokens: r.tsRepair.totalTokens,
        wallTimeMs: r.tsRepair.totalWallTimeMs,
        success: r.tsRepair.success,
        autoFixed: r.tsRepair.autoFixed,
        puntedToLlm: r.tsRepair.puntedToLlm,
      },
      comparison: {
        tokenSavingsPercent: r.tokenSavingsPercent,
        roundSavingsPercent: r.roundSavingsPercent,
        autoFixRate: r.autoFixRate,
        savingsByCategory: r.savingsByErrorCategory,
      },
    })),
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Export results to CSV for graphing
 */
export function exportCsv(results: Comparison[], filePath: string): void {
  const headers = [
    'name',
    'seed',
    'initial_errors',
    'vanilla_rounds',
    'vanilla_tokens',
    'vanilla_prompt_tokens',
    'vanilla_completion_tokens',
    'vanilla_cost',
    'vanilla_success',
    'tsrepair_rounds',
    'tsrepair_tokens',
    'tsrepair_prompt_tokens',
    'tsrepair_completion_tokens',
    'tsrepair_cost',
    'tsrepair_success',
    'tsrepair_auto_fixed',
    'tsrepair_punted_to_llm',
    'token_savings_percent',
    'round_savings_percent',
    'auto_fix_rate',
  ];

  const rows = results.map((r) => [
    r.vanilla.config.name,
    r.vanilla.config.seed,
    r.vanilla.initialDiagnosticCount,
    r.vanilla.rounds.length,
    r.vanilla.totalTokens,
    r.vanilla.totalPromptTokens,
    r.vanilla.totalCompletionTokens,
    calculateCost(r.vanilla.totalPromptTokens, r.vanilla.totalCompletionTokens),
    r.vanilla.success ? 1 : 0,
    r.tsRepair.rounds.length,
    r.tsRepair.totalTokens,
    r.tsRepair.totalPromptTokens,
    r.tsRepair.totalCompletionTokens,
    calculateCost(r.tsRepair.totalPromptTokens, r.tsRepair.totalCompletionTokens),
    r.tsRepair.success ? 1 : 0,
    r.tsRepair.autoFixed ?? 0,
    r.tsRepair.puntedToLlm ?? 0,
    r.tokenSavingsPercent,
    r.roundSavingsPercent,
    r.autoFixRate,
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  fs.writeFileSync(filePath, csv);
}

/**
 * Export results to Markdown for documentation
 */
export function exportMarkdown(results: Comparison[], filePath: string): void {
  let md = `# ts-repair Benchmark Results\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;

  md += `## Summary\n\n`;
  md += `| Project | Errors | Vanilla Tokens | ts-repair Tokens | Savings | Auto-fix Rate |\n`;
  md += `|---------|--------|----------------|------------------|---------|---------------|\n`;

  for (const r of results) {
    md += `| ${r.vanilla.config.name} | ${r.vanilla.initialDiagnosticCount} | ${formatTokenCount(r.vanilla.totalTokens)} | ${formatTokenCount(r.tsRepair.totalTokens)} | ${r.tokenSavingsPercent.toFixed(1)}% | ${r.autoFixRate.toFixed(1)}% |\n`;
  }

  md += `\n## Detailed Results\n\n`;

  for (const r of results) {
    md += `### ${r.vanilla.config.name}\n\n`;
    md += `- Initial errors: ${r.vanilla.initialDiagnosticCount}\n`;
    md += `- Seed: ${r.vanilla.config.seed}\n\n`;

    md += `| Metric | Vanilla | ts-repair | Savings |\n`;
    md += `|--------|---------|-----------|----------|\n`;
    md += `| Rounds | ${r.vanilla.rounds.length} | ${r.tsRepair.rounds.length} | ${r.roundSavingsPercent.toFixed(1)}% |\n`;
    md += `| Total tokens | ${formatTokenCount(r.vanilla.totalTokens)} | ${formatTokenCount(r.tsRepair.totalTokens)} | ${r.tokenSavingsPercent.toFixed(1)}% |\n`;
    md += `| Auto-fixed | - | ${r.tsRepair.autoFixed ?? 0} | ${r.autoFixRate.toFixed(1)}% of errors |\n`;
    md += `| Success | ${r.vanilla.success ? '✓' : '✗'} | ${r.tsRepair.success ? '✓' : '✗'} | - |\n\n`;
  }

  fs.writeFileSync(filePath, md);
}

/**
 * Analyze scaling behavior across multiple error counts
 */
export function analyzeScaling(comparisons: Comparison[]): ScalingAnalysis {
  // Sort by error count
  const sorted = [...comparisons].sort(
    (a, b) => a.vanilla.initialDiagnosticCount - b.vanilla.initialDiagnosticCount
  );

  const errorCounts = sorted.map((c) => c.vanilla.initialDiagnosticCount);
  const tokenSavings = sorted.map((c) => c.tokenSavingsPercent);
  const autoFixRates = sorted.map((c) => c.autoFixRate);

  // Determine trend using linear regression
  const trend = determineTrend(errorCounts, tokenSavings);

  // Project savings at 100 errors using linear extrapolation
  const projectedSavingsAt100Errors = extrapolateSavings(errorCounts, tokenSavings, 100);

  return {
    errorCounts,
    tokenSavings,
    autoFixRates,
    trend,
    projectedSavingsAt100Errors,
  };
}

/**
 * Determine if savings are improving, stable, or degrading
 */
function determineTrend(
  errorCounts: number[],
  tokenSavings: number[]
): 'improving' | 'stable' | 'degrading' {
  if (errorCounts.length < 2) {
    return 'stable';
  }

  // Calculate slope using least squares
  const n = errorCounts.length;
  const sumX = errorCounts.reduce((a, b) => a + b, 0);
  const sumY = tokenSavings.reduce((a, b) => a + b, 0);
  const sumXY = errorCounts.reduce((acc, x, i) => acc + x * (tokenSavings[i] ?? 0), 0);
  const sumX2 = errorCounts.reduce((acc, x) => acc + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Threshold for "stable" is ±0.1% per error
  if (slope > 0.1) {
    return 'improving';
  } else if (slope < -0.1) {
    return 'degrading';
  }
  return 'stable';
}

/**
 * Extrapolate savings to a target error count
 */
function extrapolateSavings(
  errorCounts: number[],
  tokenSavings: number[],
  targetErrors: number
): number {
  if (errorCounts.length < 2) {
    return tokenSavings[0] ?? 0;
  }

  // Linear regression
  const n = errorCounts.length;
  const sumX = errorCounts.reduce((a, b) => a + b, 0);
  const sumY = tokenSavings.reduce((a, b) => a + b, 0);
  const sumXY = errorCounts.reduce((acc, x, i) => acc + x * (tokenSavings[i] ?? 0), 0);
  const sumX2 = errorCounts.reduce((acc, x) => acc + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return intercept + slope * targetErrors;
}

/**
 * Print scaling analysis to console
 */
export function printScalingReport(analysis: ScalingAnalysis): void {
  console.log('\n' + chalk.bold('Scaling Analysis:'));
  console.log('─'.repeat(60));

  // Data points
  console.log(chalk.bold('Data points:'));
  for (let i = 0; i < analysis.errorCounts.length; i++) {
    console.log(
      `  ${(analysis.errorCounts[i] ?? 0).toString().padStart(3)} errors: ${(analysis.tokenSavings[i] ?? 0).toFixed(1)}% token savings, ${(analysis.autoFixRates[i] ?? 0).toFixed(1)}% auto-fix rate`
    );
  }
  console.log();

  // Trend
  const trendColor =
    analysis.trend === 'improving'
      ? chalk.green
      : analysis.trend === 'degrading'
        ? chalk.red
        : chalk.yellow;
  console.log(`Trend: ${trendColor(analysis.trend)}`);

  // Projection
  console.log(
    `Projected savings at 100 errors: ${chalk.cyan(analysis.projectedSavingsAt100Errors.toFixed(1))}%`
  );

  console.log('─'.repeat(60) + '\n');
}
