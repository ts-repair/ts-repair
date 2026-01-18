/**
 * Type definitions for ts-repair benchmark harness
 */

/**
 * Mangle types - categorized by expected cascade behavior
 */
export type ManglerType =
  // HIGH CASCADE (ts-repair advantage)
  | 'deleteImport'
  | 'removeAsyncModifier'
  | 'deleteInterfaceProperty'
  // MEDIUM (mechanical, localized)
  | 'removeTypeAnnotation'
  | 'deleteReturnType'
  | 'removeOptionalChaining'
  // HARD (require LLM judgment)
  | 'widenToUnknown'
  | 'deleteTypeGuard'
  | 'breakUnionType';

/**
 * Category of errors based on expected repair behavior
 */
export type ErrorCategory = 'cascade' | 'mechanical' | 'judgment';

/**
 * Recipe specifies how many of each mangle to apply
 */
export interface MangleRecipe {
  deleteImport?: number;
  removeAsyncModifier?: number;
  deleteInterfaceProperty?: number;
  removeTypeAnnotation?: number;
  deleteReturnType?: number;
  removeOptionalChaining?: number;
  widenToUnknown?: number;
  deleteTypeGuard?: number;
  breakUnionType?: number;
}

/**
 * Record of each mangle applied
 */
export interface MangleRecord {
  id: string;
  type: ManglerType;
  file: string;
  line: number;
  column: number;
  original: string;
  replacement: string;
  expectedCascadeDepth: number;
}

/**
 * Single compiler diagnostic
 */
export interface Diagnostic {
  code: number;
  message: string;
  file: string;
  line: number;
  column: number;
  category: ErrorCategory;
}

/**
 * A fix suggested by the LLM
 */
export interface Fix {
  file: string;
  line: number;
  original: string;
  replacement: string;
}

/**
 * Message in a conversation
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * API usage statistics
 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
}

/**
 * Metrics for one repair round
 */
export interface RoundMetrics {
  roundNumber: number;
  diagnosticsAtStart: Diagnostic[];
  diagnosticsAtEnd: Diagnostic[];
  promptTokens: number;
  completionTokens: number;
  filesModified: string[];
  wallTimeMs: number;
  // ts-repair specific
  autoFixedCount?: number;
  puntedToLlmCount?: number;
}

/**
 * Full run result
 */
export interface RunResult {
  approach: 'vanilla' | 'ts-repair';
  config: BenchmarkConfig;
  mangles: MangleRecord[];
  initialDiagnosticCount: number;
  finalDiagnosticCount: number;
  rounds: RoundMetrics[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalWallTimeMs: number;
  success: boolean;
  // ts-repair specific
  autoFixed?: number;
  puntedToLlm?: number;
}

/**
 * Category-level savings breakdown
 */
export interface CategorySavings {
  cascade: { vanilla: number; tsRepair: number };
  mechanical: { vanilla: number; tsRepair: number };
  judgment: { vanilla: number; tsRepair: number };
}

/**
 * Comparison between approaches
 */
export interface Comparison {
  vanilla: RunResult;
  tsRepair: RunResult;
  tokenSavingsPercent: number;
  roundSavingsPercent: number;
  autoFixRate: number;
  savingsByErrorCategory: CategorySavings;
}

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  name: string;
  projectPath: string;
  tsconfigPath: string;
  targetDir?: string;
  recipe: MangleRecipe;
  targetErrorCount: number;
  maxRounds: number;
  seed: number;
}

/**
 * Result of running tsc
 */
export interface TscResult {
  success: boolean;
  diagnostics: Diagnostic[];
  wallTimeMs: number;
}

/**
 * Result of mangling a project
 */
export interface MangleResult {
  records: MangleRecord[];
  modifiedFiles: Map<string, string>;
}

/**
 * A candidate location for mangling
 */
export interface MangleCandidate {
  type: ManglerType;
  file: string;
  line: number;
  column: number;
  start: number;
  end: number;
  original: string;
  replacement: string;
  estimatedCascade: number;
}

/**
 * Options for mangling a project
 */
export interface MangleOptions {
  projectPath: string;
  tsconfigPath: string;
  recipe: MangleRecipe;
  targetDir?: string;
  seed: number;
}

/**
 * Scaling analysis results
 */
export interface ScalingAnalysis {
  errorCounts: number[];
  tokenSavings: number[];
  autoFixRates: number[];
  trend: 'improving' | 'stable' | 'degrading';
  projectedSavingsAt100Errors: number;
}

/**
 * Claude client interface for abstraction
 */
export interface ClaudeClient {
  complete(prompt: string): Promise<{
    content: string;
    fixes: Fix[];
    usage: Usage;
  }>;
}

/**
 * Preset repository configurations
 */
export interface RepoPreset {
  repo: string;
  tsconfig: string;
  targetDir?: string;
}

/**
 * Cascade multipliers for estimating error count from mangles
 */
export const CASCADE_MULTIPLIERS: Record<ManglerType, number> = {
  deleteImport: 5,
  removeAsyncModifier: 3,
  deleteInterfaceProperty: 4,
  removeTypeAnnotation: 1,
  deleteReturnType: 1,
  removeOptionalChaining: 1,
  widenToUnknown: 2,
  deleteTypeGuard: 2,
  breakUnionType: 1,
};

/**
 * Category mapping for mangle types
 */
export const MANGLE_CATEGORIES: Record<ManglerType, ErrorCategory> = {
  deleteImport: 'cascade',
  removeAsyncModifier: 'cascade',
  deleteInterfaceProperty: 'cascade',
  removeTypeAnnotation: 'mechanical',
  deleteReturnType: 'mechanical',
  removeOptionalChaining: 'mechanical',
  widenToUnknown: 'judgment',
  deleteTypeGuard: 'judgment',
  breakUnionType: 'judgment',
};

/**
 * Default benchmark configuration values
 */
export const DEFAULT_CONFIG = {
  maxRounds: 20,
  maxCandidatesPerDiagnostic: 10,
  maxVerifications: 500,
} as const;

/**
 * Map of error codes to likely categories
 */
export const ERROR_CODE_CATEGORIES: Record<number, ErrorCategory> = {
  // Cascade errors (typically from imports/types)
  2304: 'cascade', // Cannot find name
  2305: 'cascade', // Module has no exported member
  2307: 'cascade', // Cannot find module
  2339: 'cascade', // Property does not exist
  2345: 'cascade', // Argument type not assignable
  2740: 'cascade', // Type is missing properties

  // Mechanical errors (localized fixes)
  1005: 'mechanical', // Expected semicolon
  1109: 'mechanical', // Expression expected
  1128: 'mechanical', // Declaration or statement expected
  1161: 'mechanical', // Unterminated string
  2322: 'mechanical', // Type not assignable (often local)
  2349: 'mechanical', // Cannot invoke expression

  // Judgment errors (need semantic understanding)
  1308: 'judgment', // await in non-async
  2769: 'judgment', // No overload matches
  2571: 'judgment', // Object is of type unknown
  2352: 'judgment', // Conversion may be mistake
  2366: 'judgment', // Function lacks ending return
};
