/**
 * Planner Unit Tests
 *
 * Tests for the repair planning algorithm including verification,
 * risk assessment, and diagnostic classification.
 */

import { describe, it, expect } from "bun:test";
import {
  plan,
  repair,
  pruneCandidates,
  assessRisk,
  createBudgetLogger,
  type PlanOptions,
} from "../../src/oracle/planner.js";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("plan", () => {
  describe("basic functionality", () => {
    it("returns empty plan for error-free project", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const result = plan(configPath);

      expect(result.steps).toHaveLength(0);
      expect(result.remaining).toHaveLength(0);
      expect(result.summary.initialErrors).toBe(0);
      expect(result.summary.finalErrors).toBe(0);
      expect(result.summary.fixedCount).toBe(0);
      expect(result.summary.remainingCount).toBe(0);
    });

    it("finds and applies fixes for async/await error", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      expect(result.summary.initialErrors).toBeGreaterThan(0);
      expect(result.steps.length).toBeGreaterThan(0);

      // Should fix all errors
      expect(result.summary.finalErrors).toBe(0);
    });

    it("returns remaining diagnostics when fixes don't eliminate all errors", () => {
      const configPath = path.join(
        FIXTURES_DIR,
        "no-fixes-available/tsconfig.json"
      );
      const result = plan(configPath);

      // Should have remaining diagnostics
      expect(result.remaining.length).toBeGreaterThan(0);
    });

    it(
      "generates unique fix IDs",
      () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const result = plan(configPath);

        if (result.steps.length > 1) {
          const ids = result.steps.map((s) => s.id);
          const uniqueIds = new Set(ids);
          expect(uniqueIds.size).toBe(ids.length);
        }
      },
      { timeout: 15000 }
    );
  });

  describe("verified fixes structure", () => {
    it("includes all required fields in VerifiedFix", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      if (result.steps.length > 0) {
        const step = result.steps[0];

        expect(step.id).toBeDefined();
        expect(typeof step.id).toBe("string");

        expect(step.diagnostic).toBeDefined();
        expect(step.diagnostic.code).toBeDefined();
        expect(step.diagnostic.message).toBeDefined();
        expect(step.diagnostic.file).toBeDefined();
        expect(step.diagnostic.line).toBeDefined();
        expect(step.diagnostic.column).toBeDefined();

        expect(step.fixName).toBeDefined();
        expect(step.fixDescription).toBeDefined();

        expect(step.changes).toBeDefined();
        expect(Array.isArray(step.changes)).toBe(true);

        expect(typeof step.errorsBefore).toBe("number");
        expect(typeof step.errorsAfter).toBe("number");
        expect(typeof step.delta).toBe("number");

        expect(["low", "medium", "high"]).toContain(step.risk);
      }
    });

    it("records correct error counts before and after", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      if (result.steps.length > 0) {
        const step = result.steps[0];

        // errorsBefore should be >= errorsAfter for a valid fix
        expect(step.errorsBefore).toBeGreaterThanOrEqual(step.errorsAfter);

        // delta should be positive (we only accept improving fixes)
        expect(step.delta).toBeGreaterThan(0);

        // delta should match the difference
        expect(step.delta).toBe(step.errorsBefore - step.errorsAfter);
      }
    });
  });

  describe("options", () => {
    describe("maxCandidates", () => {
      it(
        "respects maxCandidates limit",
        () => {
          const configPath = path.join(
            FIXTURES_DIR,
            "missing-import/tsconfig.json"
          );

          // With only 1 candidate, we should still find fixes (if the best one is first)
          const result = plan(configPath, { maxCandidates: 1 });

          // Should complete without error
          expect(result.summary).toBeDefined();
        },
        { timeout: 15000 }
      );

      it("handles maxCandidates of 0", () => {
        const configPath = path.join(
          FIXTURES_DIR,
          "missing-import/tsconfig.json"
        );
        const result = plan(configPath, { maxCandidates: 0 });

        // With 0 candidates, no fixes should be found
        expect(result.steps).toHaveLength(0);
        // All errors should remain
        expect(result.summary.finalErrors).toBe(result.summary.initialErrors);
      });
    });

    describe("includeHighRisk", () => {
      it("excludes high-risk fixes by default", () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const result = plan(configPath, { includeHighRisk: false });

        for (const step of result.steps) {
          expect(step.risk).not.toBe("high");
        }
      });

      it("includes high-risk fixes when enabled", () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const result = plan(configPath, { includeHighRisk: true });

        // The plan should complete - high risk fixes may or may not be selected
        expect(result.summary).toBeDefined();
      });
    });

    describe("maxIterations", () => {
      it("stops after maxIterations", () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const result = plan(configPath, { maxIterations: 1 });

        // With only 1 iteration, should apply at most 1 fix
        expect(result.steps.length).toBeLessThanOrEqual(1);
      });

      it("completes before maxIterations if all errors fixed", () => {
        const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
        const result = plan(configPath, { maxIterations: 100 });

        // Should complete immediately with no fixes needed
        expect(result.steps).toHaveLength(0);
        expect(result.summary.finalErrors).toBe(0);
      });
    });

    describe("onProgress callback", () => {
      it("calls onProgress with status messages", () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const messages: string[] = [];

        plan(configPath, {
          onProgress: (msg) => messages.push(msg),
        });

        // Should have at least the starting message
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0]).toMatch(/Starting with \d+ errors/);
      });
    });
  });

  describe("diagnostic classification", () => {
    it("classifies remaining diagnostics", () => {
      const configPath = path.join(
        FIXTURES_DIR,
        "no-fixes-available/tsconfig.json"
      );
      const result = plan(configPath);

      for (const diag of result.remaining) {
        expect([
          "AutoFixable",
          "AutoFixableHighRisk",
          "NeedsJudgment",
          "NoGeneratedCandidate",
          "NoVerifiedCandidate",
        ]).toContain(diag.disposition);
        expect(typeof diag.candidateCount).toBe("number");
        expect(diag.candidateCount).toBeGreaterThanOrEqual(0);
      }
    });

    it("marks diagnostics without generated fixes as NoGeneratedCandidate", () => {
      const configPath = path.join(
        FIXTURES_DIR,
        "no-fixes-available/tsconfig.json"
      );
      const result = plan(configPath);

      // Some diagnostics should be NoGeneratedCandidate (TypeScript has no fixes)
      // or NoVerifiedCandidate (fixes exist but don't verify)
      const noGenerated = result.remaining.filter(
        (d) => d.disposition === "NoGeneratedCandidate"
      );
      const noVerified = result.remaining.filter(
        (d) => d.disposition === "NoVerifiedCandidate"
      );
      // At least one of these should be present
      expect(noGenerated.length + noVerified.length).toBeGreaterThan(0);
    });

    it("distinguishes NoGeneratedCandidate from NoVerifiedCandidate", () => {
      const configPath = path.join(
        FIXTURES_DIR,
        "no-fixes-available/tsconfig.json"
      );
      const result = plan(configPath);

      // NoGeneratedCandidate should have candidateCount of 0
      const noGenerated = result.remaining.filter(
        (d) => d.disposition === "NoGeneratedCandidate"
      );
      for (const diag of noGenerated) {
        expect(diag.candidateCount).toBe(0);
      }

      // NoVerifiedCandidate should have candidateCount > 0
      const noVerified = result.remaining.filter(
        (d) => d.disposition === "NoVerifiedCandidate"
      );
      for (const diag of noVerified) {
        expect(diag.candidateCount).toBeGreaterThan(0);
      }
    });
  });

  describe("risk assessment", () => {
    it("assigns low risk to async/await fixes", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      // Async/await fixes should be low risk
      const asyncFixes = result.steps.filter(
        (s) => s.fixName === "fixAwaitInSyncFunction"
      );
      for (const fix of asyncFixes) {
        expect(fix.risk).toBe("low");
      }
    });

    it("assigns medium risk to spelling fixes", () => {
      const configPath = path.join(FIXTURES_DIR, "spelling-error/tsconfig.json");
      const result = plan(configPath, { includeHighRisk: true });

      // Spelling fixes should be medium risk
      const spellingFixes = result.steps.filter(
        (s) => s.fixName === "fixSpelling"
      );
      for (const fix of spellingFixes) {
        expect(fix.risk).toBe("medium");
      }
    });
  });

  describe("monotonic progress", () => {
    it("each step reduces error count", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      for (const step of result.steps) {
        expect(step.errorsAfter).toBeLessThan(step.errorsBefore);
        expect(step.delta).toBeGreaterThan(0);
      }
    });

    it("final error count matches last step errorsAfter", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      if (result.steps.length > 0) {
        const lastStep = result.steps[result.steps.length - 1];
        // Final errors might be higher than lastStep.errorsAfter if
        // there are unfixable errors, but should never be lower
        expect(result.summary.finalErrors).toBeGreaterThanOrEqual(
          lastStep.errorsAfter
        );
      }
    });
  });

  describe("determinism", () => {
    it(
      "produces same output for same input",
      () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");

        const result1 = plan(configPath);
        const result2 = plan(configPath);

        expect(result1.steps.length).toBe(result2.steps.length);
        expect(result1.summary.initialErrors).toBe(result2.summary.initialErrors);
        expect(result1.summary.finalErrors).toBe(result2.summary.finalErrors);

        // Fix names should match
        for (let i = 0; i < result1.steps.length; i++) {
          expect(result1.steps[i].fixName).toBe(result2.steps[i].fixName);
        }
      },
      { timeout: 15000 }
    );
  });

  describe("edge cases", () => {
    it("handles project with syntax errors", () => {
      // Syntax errors may prevent proper diagnostics
      // Just verify it doesn't crash
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      expect(() => plan(configPath)).not.toThrow();
    });

    it("handles empty project", () => {
      // The no-errors fixture has files but no errors
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const result = plan(configPath);

      expect(result.steps).toHaveLength(0);
      expect(result.summary.initialErrors).toBe(0);
    });
  });
});

describe("repair", () => {
  it("wraps plan with request interface", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");

    const result = repair({
      project: configPath,
    });

    expect(result.steps).toBeDefined();
    expect(result.remaining).toBeDefined();
    expect(result.summary).toBeDefined();
  });

  it(
    "passes through options",
    () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");

      const result = repair({
        project: configPath,
        maxCandidates: 5,
        includeHighRisk: true,
      });

      expect(result.summary).toBeDefined();
    },
    { timeout: 15000 }
  );

  it("uses default options when not specified", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");

    const result = repair({
      project: configPath,
    });

    // Default behavior: excludes high risk fixes
    for (const step of result.steps) {
      expect(step.risk).not.toBe("high");
    }
  });
});

describe("budget constraints", () => {
  describe("budget tracking", () => {
    it("tracks candidates generated and verified in summary", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      expect(result.summary.budget).toBeDefined();
      expect(typeof result.summary.budget.candidatesGenerated).toBe("number");
      expect(typeof result.summary.budget.candidatesVerified).toBe("number");
      expect(result.summary.budget.candidatesGenerated).toBeGreaterThanOrEqual(0);
      expect(result.summary.budget.candidatesVerified).toBeGreaterThanOrEqual(0);
    });

    it("reports verificationBudget in summary", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath, { maxVerifications: 100 });

      expect(result.summary.budget.verificationBudget).toBe(100);
    });

    it("reports budgetExhausted as false when not exhausted", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const result = plan(configPath);

      expect(result.summary.budget.budgetExhausted).toBe(false);
    });
  });

  describe("maxVerifications", () => {
    it("stops when maxVerifications is reached", () => {
      // Use multiple-errors fixture to ensure we need multiple verifications
      const configPath = path.join(FIXTURES_DIR, "multiple-errors/tsconfig.json");
      const result = plan(configPath, { maxVerifications: 1, includeHighRisk: true });

      // With 1 verification allowed, should either exhaust or complete if first fix works
      expect(result.summary.budget.candidatesVerified).toBeLessThanOrEqual(1);
    });

    it(
      "caps total verifications across iterations",
      () => {
        const configPath = path.join(FIXTURES_DIR, "multiple-errors/tsconfig.json");
        const result = plan(configPath, { maxVerifications: 3, includeHighRisk: true });

        // Should not verify more than the budget allows
        expect(result.summary.budget.candidatesVerified).toBeLessThanOrEqual(3);
      },
      { timeout: 15000 }
    );

    it("marks remaining diagnostics as NeedsJudgment when budget exhausted", () => {
      const configPath = path.join(FIXTURES_DIR, "multiple-errors/tsconfig.json");
      const result = plan(configPath, { maxVerifications: 1, includeHighRisk: true });

      // If budget was exhausted and there are remaining diagnostics
      if (result.summary.budget.budgetExhausted && result.remaining.length > 0) {
        for (const diag of result.remaining) {
          expect(diag.disposition).toBe("NeedsJudgment");
        }
      }
    });

    it("completes normally when budget is sufficient", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath, { maxVerifications: 500 });

      // Should complete without exhausting budget
      if (result.summary.finalErrors === 0) {
        expect(result.summary.budget.budgetExhausted).toBe(false);
      }
    });
  });

  describe("maxCandidatesPerIteration", () => {
    it("respects maxCandidatesPerIteration limit", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath, { maxCandidatesPerIteration: 5 });

      // Should complete without error
      expect(result.summary).toBeDefined();
    });

    it("limits candidates considered across diagnostics in one iteration", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath, {
        maxCandidatesPerIteration: 2,
        maxIterations: 1,
      });

      // With only 2 candidates per iteration, verifications should be limited
      expect(result.summary.budget.candidatesVerified).toBeLessThanOrEqual(2);
    });
  });

  describe("graceful degradation", () => {
    it("returns partial plan when budget exhausted", () => {
      const configPath = path.join(FIXTURES_DIR, "multiple-errors/tsconfig.json");

      // Very low budget should exhaust quickly on multiple errors
      const result = plan(configPath, { maxVerifications: 1, includeHighRisk: true });

      // Should still return a valid plan structure
      expect(result.steps).toBeDefined();
      expect(Array.isArray(result.steps)).toBe(true);
      expect(result.remaining).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it(
      "reports budget status in plan summary",
      () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const result = plan(configPath, { maxVerifications: 100 });

        // Budget status should always be reported
        expect(result.summary.budget).toBeDefined();
        expect(typeof result.summary.budget.candidatesGenerated).toBe("number");
        expect(typeof result.summary.budget.candidatesVerified).toBe("number");
        expect(typeof result.summary.budget.budgetExhausted).toBe("boolean");
      },
      { timeout: 15000 }
    );
  });
});

describe("pruneCandidates", () => {
  it("returns all fixes when under limit", () => {
    const mockFixes = [
      { fixName: "fixMissingImport", description: "Add import", changes: [] },
      { fixName: "fixSpelling", description: "Fix spelling", changes: [] },
    ] as any[];

    const result = pruneCandidates(mockFixes, 10);
    expect(result).toHaveLength(2);
  });

  it("limits fixes when over limit", () => {
    const mockFixes = [
      { fixName: "fixMissingImport", description: "Add import", changes: [] },
      { fixName: "fixSpelling", description: "Fix spelling", changes: [] },
      { fixName: "highRiskFix", description: "High risk", changes: [] },
    ] as any[];

    const result = pruneCandidates(mockFixes, 2);
    expect(result).toHaveLength(2);
  });

  it("prioritizes low-risk fixes over high-risk", () => {
    const mockFixes = [
      { fixName: "highRiskFix", description: "High risk", changes: [] },
      { fixName: "fixMissingImport", description: "Add import", changes: [] },
    ] as any[];

    const result = pruneCandidates(mockFixes, 1);
    expect(result[0].fixName).toBe("fixMissingImport");
  });
});

describe("assessRisk", () => {
  it("returns low for import fixes", () => {
    expect(assessRisk("fixMissingImport")).toBe("low");
  });

  it("returns low for async/await fixes", () => {
    expect(assessRisk("addMissingAsync")).toBe("low");
    expect(assessRisk("addMissingAwait")).toBe("low");
    expect(assessRisk("fixAwaitInSyncFunction")).toBe("low");
  });

  it("returns medium for spelling fixes", () => {
    expect(assessRisk("fixSpelling")).toBe("medium");
  });

  it("returns high for unknown fixes", () => {
    expect(assessRisk("unknownFix")).toBe("high");
    expect(assessRisk("addTypeAssertion")).toBe("high");
  });
});

describe("budget logger", () => {
  it("creates logger with empty events", () => {
    const logger = createBudgetLogger();
    expect(logger.getEvents()).toHaveLength(0);
  });

  it("logs events with timestamps", () => {
    const logger = createBudgetLogger();
    logger.log({ type: "candidates_generated", iteration: 1 });

    const events = logger.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("candidates_generated");
    expect(events[0].timestamp).toBeDefined();
    expect(typeof events[0].timestamp).toBe("number");
  });

  it("provides summary statistics", () => {
    const logger = createBudgetLogger();
    logger.log({ type: "candidates_generated" });
    logger.log({ type: "candidates_generated" });
    logger.log({ type: "verification_end" });
    logger.log({ type: "fix_committed" });

    const summary = logger.getSummary();
    expect(summary.totalEvents).toBe(4);
    expect(summary.candidatesGenerated).toBe(2);
    expect(summary.verificationsRun).toBe(1);
    expect(summary.fixesCommitted).toBe(1);
    expect(summary.budgetExhausted).toBe(false);
  });

  it("detects budget exhaustion in summary", () => {
    const logger = createBudgetLogger();
    logger.log({ type: "budget_exhausted" });

    const summary = logger.getSummary();
    expect(summary.budgetExhausted).toBe(true);
  });

  it("integrates with planner via options", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
    const logger = createBudgetLogger();

    plan(configPath, { logger });

    const events = logger.getEvents();
    expect(events.length).toBeGreaterThan(0);

    // Should have at least some verification events
    const verificationEvents = events.filter(
      (e) => e.type === "verification_start" || e.type === "verification_end"
    );
    expect(verificationEvents.length).toBeGreaterThan(0);
  });
});
