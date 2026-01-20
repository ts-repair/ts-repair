/**
 * Core type definitions for ts-repair engine
 */

// Type definitions for ts-repair engine

// ============================================================================
// File Changes
// ============================================================================

export interface FileChange {
  file: string;
  start: number;
  end: number;
  newText: string;
}

// ============================================================================
// Diagnostics
// ============================================================================

export interface DiagnosticRef {
  code: number;
  message: string;
  file: string;
  line: number;
  column: number;
  start: number;
  length: number;
}

export type DiagnosticDisposition =
  | "AutoFixable"
  | "AutoFixableHighRisk"
  | "NeedsJudgment"
  | "NoGeneratedCandidate"
  | "NoVerifiedCandidate";

export interface ClassifiedDiagnostic extends DiagnosticRef {
  disposition: DiagnosticDisposition;
  candidateCount: number;
}

// ============================================================================
// Verified Fixes
// ============================================================================

export interface FixDependencies {
  conflictsWith: string[];
  requires: string[];
  exclusiveGroup?: string;
}

export interface VerifiedFix {
  id: string;

  // The diagnostic this fixes
  diagnostic: DiagnosticRef;

  // The fix from TypeScript
  fixName: string;
  fixDescription: string;

  // Actual changes to apply
  changes: FileChange[];

  // Verification results
  errorsBefore: number;
  errorsAfter: number;
  delta: number; // errorsBefore - errorsAfter (positive = good)

  // Risk assessment
  risk: "low" | "medium" | "high";

  // Dependency metadata
  dependencies: FixDependencies;
}

// ============================================================================
// Repair Plan
// ============================================================================

/** Budget usage statistics */
export interface BudgetStats {
  /** Total candidates generated across all diagnostics */
  candidatesGenerated: number;
  /** Number of candidates that were verified */
  candidatesVerified: number;
  /** Maximum verifications allowed (Infinity if unlimited) */
  verificationBudget: number;
  /** Whether the budget was exhausted before completing */
  budgetExhausted: boolean;
}

export interface RepairPlan {
  /** Ordered steps to apply */
  steps: VerifiedFix[];

  /** Diagnostics that remain after applying all steps */
  remaining: ClassifiedDiagnostic[];

  /** Compatible fix batches derived from dependencies */
  batches: string[][];

  /** Summary statistics */
  summary: {
    initialErrors: number;
    finalErrors: number;
    fixedCount: number;
    remainingCount: number;
    /** Budget usage statistics */
    budget: BudgetStats;
  };
}

// ============================================================================
// API
// ============================================================================

/** Scoring strategy for candidate ranking */
export type ScoringStrategy = "delta" | "weighted";

/** Score weights for weighted scoring strategy */
export interface ScoreWeights {
  introducedMultiplier?: number;
  editSizeAlpha?: number;
  riskPenalty?: {
    low?: number;
    medium?: number;
    high?: number;
  };
}

export interface RepairRequest {
  /** Path to tsconfig.json */
  project: string;

  /** Maximum candidates to evaluate per diagnostic (default: 10) */
  maxCandidates?: number;

  /** Maximum total candidates to consider per planning iteration (default: 100) */
  maxCandidatesPerIteration?: number;

  /** Maximum total verifications across all planning (default: 500) */
  maxVerifications?: number;

  /** Allow fixes that introduce new errors if net positive (default: false) */
  allowRegressions?: boolean;

  /** Include high-risk fixes in the plan (default: false) */
  includeHighRisk?: boolean;

  /** Scoring strategy for candidate ranking (default: delta) */
  scoringStrategy?: ScoringStrategy;

  /** Scoring weights for weighted strategy */
  scoreWeights?: ScoreWeights;

  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

export interface RepairResponse {
  /** The verified repair plan */
  plan: RepairPlan;

  /** Time taken to compute the plan (ms) */
  durationMs: number;
}

// ============================================================================
// Budget Logging
// ============================================================================

/** Event types for budget logging */
export type BudgetEventType =
  | "candidates_generated"
  | "candidate_pruned"
  | "verification_start"
  | "verification_end"
  | "fix_committed"
  | "budget_exhausted";

/** A single budget event for tracing */
export interface BudgetEvent {
  type: BudgetEventType;
  timestamp: number;
  iteration?: number;
  diagnostic?: { file: string; code: number; message: string };
  fix?: { name: string; description: string };
  budget?: { used: number; remaining: number };
  result?: { delta: number; targetFixed: boolean };
}

/** Summary of budget log events */
export interface BudgetLogSummary {
  totalEvents: number;
  candidatesGenerated: number;
  candidatesPruned: number;
  verificationsRun: number;
  fixesCommitted: number;
  budgetExhausted: boolean;
}

// ============================================================================
// Budget Preview
// ============================================================================

/** Preview of budget impact for a repair run */
export interface BudgetPreview {
  /** Estimated number of verifications needed */
  estimatedVerifications: number;
  /** Total candidates generated across all diagnostics */
  estimatedCandidates: number;
  /** Breakdown by diagnostic */
  diagnosticBreakdown: Array<{
    diagnostic: DiagnosticRef;
    candidateCount: number;
    estimatedCost: number;
  }>;
}

// ============================================================================
// vNext: Verification Scope and Candidates
// ============================================================================

/**
 * Verification scope hints for cone construction.
 * Controls how wide the verification checks after applying a fix.
 *
 * - "modified": Only check files modified by the fix (fastest)
 * - "errors": Check modified files + files with existing errors
 * - "wide": Check modified + errors + reverse dependencies (structural changes)
 */
export type VerificationScopeHint = "modified" | "errors" | "wide";

/**
 * Unified candidate representation for all fix types.
 * Supports both TypeScript language service fixes and synthetic fixes.
 */
export type CandidateFix =
  | {
      kind: "tsCodeFix";
      fixName: string;
      description: string;
      action: import("typescript").CodeFixAction;
      scopeHint?: VerificationScopeHint;
      riskHint?: "low" | "medium" | "high";
      tags?: string[];
    }
  | {
      kind: "synthetic";
      fixName: string;
      description: string;
      changes: FileChange[];
      scopeHint?: VerificationScopeHint;
      riskHint?: "low" | "medium" | "high";
      tags?: string[];
      metadata?: Record<string, unknown>;
    };

// ============================================================================
// vNext: Verification Policy
// ============================================================================

/**
 * Verification policy configuration.
 * Controls how verification cones are constructed and cached.
 */
export interface VerificationPolicy {
  /** Default scope hint when candidate doesn't specify one */
  defaultScope: VerificationScopeHint;

  /** Allow fixes that introduce new errors if net positive */
  allowRegressions: boolean;

  /** Maximum files to include in a verification cone */
  maxConeFiles: number;

  /** Maximum errors to consider for cone expansion */
  maxConeErrors: number;

  /** Cone expansion configuration */
  coneExpansion: {
    /** Include files with existing errors in the cone */
    includeErrors: boolean;
    /** Include reverse dependencies of modified files */
    includeReverseDeps: boolean;
    /** Maximum error files to add when capping cone size */
    topKErrorFiles: number;
  };

  /** Cache "before" diagnostics per cone signature */
  cacheBeforeDiagnostics: boolean;

  /** Cache key strategy: "cone" or "cone+iteration" */
  cacheKeyStrategy: "cone" | "cone+iteration";

  /** Host invalidation strategy after verification */
  hostInvalidation: "modified" | "cone" | "full";
}

// ============================================================================
// vNext: Solution Builder Framework
// ============================================================================

/**
 * Context provided to solution builders for matching and generation.
 */
export interface BuilderContext {
  /** The diagnostic being addressed */
  diagnostic: import("typescript").Diagnostic;

  /** TypeScript host for AST access, file content, etc. */
  host: import("../oracle/typescript.js").TypeScriptHost;

  /** Set of files currently containing errors */
  filesWithErrors: Set<string>;

  /** All current diagnostics (for cross-reference) */
  currentDiagnostics: import("typescript").Diagnostic[];

  /** Project compiler options */
  compilerOptions: import("typescript").CompilerOptions;

  /** Get AST node at diagnostic position (lazy-loaded) */
  getNodeAtPosition(): import("typescript").Node | undefined;

  /** Get source file for a path */
  getSourceFile(path: string): import("typescript").SourceFile | undefined;
}

/**
 * Solution builder interface.
 * Builders generate synthetic candidates for specific diagnostic patterns.
 */
export interface SolutionBuilder {
  /** Unique name for this builder (for logging/debugging) */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Diagnostic codes this builder handles (for fast routing) */
  readonly diagnosticCodes?: readonly number[];

  /** Message patterns this builder handles (regex) */
  readonly messagePatterns?: readonly RegExp[];

  /**
   * Check if this builder can handle the given diagnostic.
   * Should be cheap - pattern match on code/message first, AST only if needed.
   */
  matches(ctx: BuilderContext): boolean;

  /**
   * Generate candidate fixes for the diagnostic.
   * Should return a bounded set (typically 1-6 candidates).
   */
  generate(ctx: BuilderContext): CandidateFix[];
}

/**
 * Builder match result for debugging/logging.
 */
export interface BuilderMatchResult {
  builder: string;
  matched: boolean;
  reason?: string;
}
