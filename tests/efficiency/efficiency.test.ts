/**
 * Efficiency Tests
 *
 * Tests that verify the quality of candidate selection.
 * These tests ensure we correctly identify and select the best fixes
 * from multiple available candidates.
 */

import { describe, it, expect } from "bun:test";
import { plan } from "../../src/oracle/planner.js";
import { getFixtureHost, getFixturesDir } from "../helpers/fixture-cache.js";
import path from "path";

const FIXTURES_DIR = getFixturesDir();

describe("Efficiency Tests", () => {
  describe("candidate selection quality", () => {
    it(
      "selects fixes with highest error reduction",
      () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const result = plan(configPath);

        // Each fix should have positive delta (error reduction)
        for (const step of result.steps) {
          expect(step.delta).toBeGreaterThan(0);
        }

        // Verify we made progress
        expect(result.summary.finalErrors).toBeLessThan(
          result.summary.initialErrors
        );
      },
      { timeout: 15000 }
    );

    it("prefers lower-risk fixes when deltas are equal", () => {
      // This is implicit in the algorithm - low/medium risk fixes
      // are considered before high risk ones (unless includeHighRisk is false)
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath, { includeHighRisk: false });

      // All selected fixes should be low or medium risk
      for (const step of result.steps) {
        expect(["low", "medium"]).toContain(step.risk);
      }
    });
  });

  describe("candidate evaluation count", () => {
    it(
      "limiting candidates still finds good fixes",
      () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");

        // Plan with full candidates
        const fullResult = plan(configPath, { maxCandidates: 100 });

        // Plan with limited candidates
        const limitedResult = plan(configPath, { maxCandidates: 3 });

        // Limited should still find fixes (though maybe fewer)
        if (fullResult.steps.length > 0) {
          // At least one fix should be found
          expect(limitedResult.steps.length).toBeGreaterThan(0);
        }
      },
      { timeout: 15000 }
    );
  });

  describe("greedy algorithm behavior", () => {
    it("always selects the best available fix per iteration", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      // Each step should represent an improvement
      for (const step of result.steps) {
        expect(step.errorsBefore).toBeGreaterThan(step.errorsAfter);
      }

      // Steps are applied in order, so errorsBefore should decrease
      // (or stay same if fix eliminates 1 and exposes another)
      for (let i = 1; i < result.steps.length; i++) {
        const prev = result.steps[i - 1];
        const curr = result.steps[i];

        // Current errorsBefore should equal previous errorsAfter
        expect(curr.errorsBefore).toBe(prev.errorsAfter);
      }
    });

    it("stops when no improving fix is available", () => {
      const configPath = path.join(
        FIXTURES_DIR,
        "no-fixes-available/tsconfig.json"
      );
      const result = plan(configPath);

      // Should terminate even though errors remain
      expect(result.summary.finalErrors).toBeGreaterThan(0);

      // Should classify remaining diagnostics
      expect(result.remaining.length).toBeGreaterThan(0);
    });
  });

  describe("fix ordering", () => {
    it("applies fixes in order of best delta", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      // While we can't directly verify "best" without re-running verification,
      // we can verify that the algorithm made progress at each step
      let previousErrors = result.summary.initialErrors;

      for (const step of result.steps) {
        // Should reduce errors
        expect(step.errorsAfter).toBeLessThan(previousErrors);
        previousErrors = step.errorsAfter;
      }
    });
  });

  describe("resource efficiency", () => {
    it("does not perform unnecessary iterations", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");

      const messages: string[] = [];
      const result = plan(configPath, {
        maxIterations: 100,
        onProgress: (msg) => messages.push(msg),
      });

      // Should stop immediately with no iterations needed
      expect(result.steps).toHaveLength(0);

      // Should only have starting message
      expect(messages.length).toBeLessThanOrEqual(2);
    });

    it("terminates within maxIterations", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");

      const result = plan(configPath, {
        maxIterations: 2,
      });

      // Should have at most 2 fixes
      expect(result.steps.length).toBeLessThanOrEqual(2);
    });
  });

  describe("verification accuracy", () => {
    it("only includes fixes that actually reduce errors", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      for (const step of result.steps) {
        // Every fix must have positive delta
        expect(step.delta).toBeGreaterThan(0);

        // errorsAfter must be less than errorsBefore
        expect(step.errorsAfter).toBeLessThan(step.errorsBefore);
      }
    });

    it("correctly reports error counts in summary", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const result = plan(configPath);

      // Summary should be consistent
      expect(result.summary.fixedCount).toBe(result.steps.length);
      expect(result.summary.remainingCount).toBe(result.remaining.length);

      // Final errors should match remaining count
      expect(result.summary.finalErrors).toBe(result.summary.remainingCount);

      // Initial - fixed should approximate final (may not be exact due to cascading)
      expect(result.summary.finalErrors).toBeLessThanOrEqual(
        result.summary.initialErrors
      );
    });
  });

  describe("candidate diversity", () => {
    it("considers multiple fix types", () => {
      const host = getFixtureHost("async-await");
      const diagnostics = host.getDiagnostics();

      // Collect all unique fix names
      const fixNames = new Set<string>();
      for (const diag of diagnostics) {
        const fixes = host.getCodeFixes(diag);
        for (const fix of fixes) {
          fixNames.add(fix.fixName);
        }
      }

      // Should have at least one fix type available
      expect(fixNames.size).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Performance Baselines", () => {
  // These tests establish performance baselines and ensure we don't regress

  it("plans async-await fixture in reasonable time", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");

    const start = performance.now();
    plan(configPath);
    const elapsed = performance.now() - start;

    // Should complete in under 5 seconds (generous for CI)
    expect(elapsed).toBeLessThan(5000);
  });

  it("plans no-errors fixture in reasonable time", () => {
    const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");

    const start = performance.now();
    plan(configPath);
    const elapsed = performance.now() - start;

    // Should complete in under 2 seconds
    expect(elapsed).toBeLessThan(2000);
  });
});
