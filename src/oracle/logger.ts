/**
 * Budget Logger
 *
 * Structured logging for budget tracing and session replay.
 * Captures candidate generation, pruning, verification, and fix commitment events.
 */

import type {
  BudgetEvent,
  BudgetLogSummary,
} from "../output/types.js";

// ============================================================================
// Budget Logger Interface
// ============================================================================

export interface BudgetLogger {
  /** Log a budget event */
  log(event: Omit<BudgetEvent, "timestamp">): void;

  /** Get all logged events */
  getEvents(): BudgetEvent[];

  /** Get aggregated summary statistics */
  getSummary(): BudgetLogSummary;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a budget logger for tracing budget consumption
 */
export function createBudgetLogger(): BudgetLogger {
  const events: BudgetEvent[] = [];

  return {
    log(event: Omit<BudgetEvent, "timestamp">): void {
      events.push({
        ...event,
        timestamp: Date.now(),
      });
    },

    getEvents(): BudgetEvent[] {
      return events;
    },

    getSummary(): BudgetLogSummary {
      let candidatesGenerated = 0;
      let candidatesPruned = 0;
      let verificationsRun = 0;
      let fixesCommitted = 0;
      let budgetExhausted = false;

      for (const event of events) {
        switch (event.type) {
          case "candidates_generated":
            candidatesGenerated++;
            break;
          case "candidate_pruned":
            candidatesPruned++;
            break;
          case "verification_end":
            verificationsRun++;
            break;
          case "fix_committed":
            fixesCommitted++;
            break;
          case "budget_exhausted":
            budgetExhausted = true;
            break;
        }
      }

      return {
        totalEvents: events.length,
        candidatesGenerated,
        candidatesPruned,
        verificationsRun,
        fixesCommitted,
        budgetExhausted,
      };
    },
  };
}

/**
 * Create a no-op logger for when tracing is disabled
 */
export function createNoopLogger(): BudgetLogger {
  return {
    log(): void {
      // No-op
    },
    getEvents(): BudgetEvent[] {
      return [];
    },
    getSummary(): BudgetLogSummary {
      return {
        totalEvents: 0,
        candidatesGenerated: 0,
        candidatesPruned: 0,
        verificationsRun: 0,
        fixesCommitted: 0,
        budgetExhausted: false,
      };
    },
  };
}
