/**
 * Core type definitions for Clank repair engine
 */

// Type definitions for Clank repair engine

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
