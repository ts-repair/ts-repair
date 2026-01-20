/**
 * Benchmark Harness Orchestrator
 *
 * Main orchestrator for running ts-repair benchmarks across multiple fixtures
 * and scoring strategies. Coordinates corpus loading, run execution, and
 * result collection.
 */

import { loadCorpus, filterCorpus, type CorpusFilter } from "./corpus.js";
import { executeSingleRun } from "./runner.js";
import { collectResults } from "./collector.js";
import type { ScoringStrategy } from "../output/types.js";
import type {
  BenchmarkConfig,
  BenchmarkResults,
  BenchmarkRun,
  CorpusConfig,
} from "./types.js";

// ============================================================================
// Harness Options
// ============================================================================

/**
 * Options for configuring a benchmark run.
 */
export interface HarnessOptions {
  /** Path to the corpus JSON file. Defaults to tests/benchmark/corpus.json */
  corpusPath?: string;

  /** Scoring strategies to benchmark. Defaults to ["delta", "weighted"] */
  strategies?: ScoringStrategy[];

  /** Include high-risk fixes in repair plans. Defaults to false */
  includeHighRisk?: boolean;

  /** Number of iterations per fixture for timing stability. Defaults to 1 */
  iterations?: number;

  /** Filter options to subset the corpus */
  filter?: CorpusFilter;

  /** Callback for progress messages */
  onProgress?: (message: string) => void;

  /** Callback when a single run completes */
  onRunComplete?: (run: BenchmarkRun) => void;
}

/**
 * Default options for benchmark runs.
 */
const DEFAULT_OPTIONS: Required<
  Omit<HarnessOptions, "onProgress" | "onRunComplete" | "filter" | "corpusPath">
> = {
  strategies: ["delta", "weighted"],
  includeHighRisk: false,
  iterations: 1,
};

// ============================================================================
// Main Benchmark Function
// ============================================================================

/**
 * Run a complete benchmark across the corpus with all specified strategies.
 *
 * This is the main entry point for the benchmark harness. It:
 * 1. Loads and optionally filters the corpus
 * 2. Runs each fixture with each strategy
 * 3. Supports multiple iterations for timing stability
 * 4. Collects and aggregates results
 *
 * @param options - Configuration options for the benchmark
 * @returns Complete benchmark results with all metrics and comparisons
 *
 * @example
 * ```typescript
 * // Run with default options (both strategies, all fixtures)
 * const results = runBenchmark();
 *
 * // Run with filters and progress reporting
 * const results = runBenchmark({
 *   filter: { categories: ["synthetic"] },
 *   onProgress: console.log,
 * });
 * ```
 */
export function runBenchmark(options: HarnessOptions = {}): BenchmarkResults {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Load and filter corpus
  const corpus = loadCorpus(opts.corpusPath);
  const filteredCorpus = opts.filter ? filterCorpus(corpus, opts.filter) : corpus;

  opts.onProgress?.(`Loaded ${filteredCorpus.entries.length} fixtures`);

  const allRuns: BenchmarkRun[] = [];

  // Run each strategy
  for (const strategy of opts.strategies) {
    opts.onProgress?.(`Running with strategy: ${strategy}`);

    const runs = runCorpusWithStrategy(filteredCorpus, strategy, {
      includeHighRisk: opts.includeHighRisk,
      iterations: opts.iterations,
      onProgress: opts.onProgress,
      onRunComplete: opts.onRunComplete,
    });

    allRuns.push(...runs);
  }

  // Build config for results
  const config: BenchmarkConfig = {
    corpus: filteredCorpus,
    strategies: opts.strategies,
    includeHighRisk: opts.includeHighRisk,
    enableTelemetry: true,
    iterations: opts.iterations,
  };

  return collectResults(allRuns, config);
}

// ============================================================================
// Corpus Runner
// ============================================================================

/**
 * Options for running a corpus with a single strategy.
 */
interface CorpusRunOptions {
  /** Include high-risk fixes in repair plans */
  includeHighRisk: boolean;

  /** Number of iterations per fixture */
  iterations: number;

  /** Callback for progress messages */
  onProgress?: (message: string) => void;

  /** Callback when a single run completes */
  onRunComplete?: (run: BenchmarkRun) => void;
}

/**
 * Run all corpus entries with a single scoring strategy.
 *
 * For each fixture, runs multiple iterations (if configured) and keeps
 * the run with the best timing for consistent results.
 *
 * @param corpus - The corpus configuration with entries to run
 * @param strategy - The scoring strategy to use
 * @param options - Run configuration options
 * @returns Array of benchmark runs, one per fixture
 */
function runCorpusWithStrategy(
  corpus: CorpusConfig,
  strategy: ScoringStrategy,
  options: CorpusRunOptions
): BenchmarkRun[] {
  const runs: BenchmarkRun[] = [];

  for (const entry of corpus.entries) {
    options.onProgress?.(`  ${entry.name}...`);

    // Run multiple iterations and take best timing
    let bestRun: BenchmarkRun | null = null;

    for (let i = 0; i < options.iterations; i++) {
      const run = executeSingleRun(entry.configPath, strategy, {
        includeHighRisk: options.includeHighRisk,
      });

      // Keep the run with best timing (or first if iterations=1)
      if (!bestRun || run.timing.totalMs < bestRun.timing.totalMs) {
        bestRun = run;
      }
    }

    if (bestRun) {
      runs.push(bestRun);
      options.onRunComplete?.(bestRun);
    }
  }

  return runs;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run a benchmark with a single scoring strategy.
 *
 * Convenience function for benchmarking just one strategy instead of
 * comparing both.
 *
 * @param strategy - The scoring strategy to use
 * @param options - Configuration options (strategies will be overridden)
 * @returns Complete benchmark results for the single strategy
 *
 * @example
 * ```typescript
 * const results = runSingleStrategy("weighted", {
 *   filter: { categories: ["builder-specific"] },
 * });
 * ```
 */
export function runSingleStrategy(
  strategy: ScoringStrategy,
  options: Omit<HarnessOptions, "strategies"> = {}
): BenchmarkResults {
  return runBenchmark({ ...options, strategies: [strategy] });
}

/**
 * Compare both delta and weighted scoring strategies.
 *
 * Convenience function that runs both strategies for comparison.
 * This is equivalent to calling runBenchmark() with default strategy options.
 *
 * @param options - Configuration options (strategies will be set to both)
 * @returns Complete benchmark results comparing both strategies
 *
 * @example
 * ```typescript
 * const results = compareStrategies({
 *   iterations: 3,
 *   onProgress: console.log,
 * });
 * console.log(`Winner: ${results.strategyComparison.winner}`);
 * ```
 */
export function compareStrategies(
  options: Omit<HarnessOptions, "strategies"> = {}
): BenchmarkResults {
  return runBenchmark({ ...options, strategies: ["delta", "weighted"] });
}
