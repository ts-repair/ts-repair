/**
 * ts-repair Benchmark Harness
 *
 * Measures token efficiency of ts-repair vs vanilla tsc when an LLM fixes TypeScript errors.
 */

// Types
export type {
  ManglerType,
  ErrorCategory,
  MangleRecipe,
  MangleRecord,
  MangleResult,
  MangleOptions,
  MangleCandidate,
  Diagnostic,
  Fix,
  Message,
  Usage,
  RoundMetrics,
  RunResult,
  CategorySavings,
  Comparison,
  BenchmarkConfig,
  TscResult,
  ScalingAnalysis,
  ClaudeClient,
  RepoPreset,
} from './types.js';

export { CASCADE_MULTIPLIERS, MANGLE_CATEGORIES, DEFAULT_CONFIG, ERROR_CODE_CATEGORIES } from './types.js';

// TSC wrapper
export {
  runTsc,
  parseTscOutput,
  countByCategory,
  groupByFile,
  getUniqueFiles,
  formatDiagnostics,
  diagnosticsMatch,
  findResolvedDiagnostics,
  findIntroducedDiagnostics,
} from './tsc.js';

// Token counting
export {
  countTokens,
  countPromptTokens,
  estimateCompletionTokens,
  countCodeTokens,
  formatTokenCount,
  calculateCost,
  formatCost,
  cleanup as cleanupTokenizer,
  calculateTokenStats,
} from './token-counter.js';

// Mangling
export {
  mangleProject,
  scaleRecipe,
  applyManglesToDisk,
  previewMangles,
  DEFAULT_RECIPE,
  CASCADE_RECIPE,
  MECHANICAL_RECIPE,
  JUDGMENT_RECIPE,
} from './mangler.js';

// Runners
export {
  runVanillaBenchmark,
  buildVanillaPrompt,
  applyFixes,
  estimateVanillaTokens,
} from './runner-vanilla.js';

export {
  runTsRepairBenchmark,
  runTsRepair,
  applyTsRepairFixes,
  buildTsRepairPrompt,
  estimateTsRepairTokens,
  runTsRepairApply,
} from './runner-tsrepair.js';

// Reporting
export {
  compare,
  printConsoleReport,
  exportJson,
  exportCsv,
  exportMarkdown,
  analyzeScaling,
  printScalingReport,
} from './reporter.js';
