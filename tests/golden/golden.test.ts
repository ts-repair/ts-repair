/**
 * Golden Tests
 *
 * Snapshot-based tests that verify repair plan output matches expected results.
 * These tests capture the expected behavior and detect regressions.
 */

import { describe, it, expect } from "bun:test";
import { plan } from "../../src/oracle/planner.js";
import { formatPlanJSON } from "../../src/output/format.js";
import path from "path";
import fs from "fs";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");
const GOLDEN_DIR = path.join(import.meta.dir, "expected");

// Ensure golden directory exists
if (!fs.existsSync(GOLDEN_DIR)) {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
}

/**
 * Normalize plan output for comparison.
 * Removes fields that may vary between runs (absolute paths, etc.)
 */
function normalizePlan(planOutput: string): object {
  const parsed = JSON.parse(planOutput);

  // Normalize file paths to relative
  const normalizeFilePath = (filePath: string) => {
    // Extract just the fixture-relative path
    const fixtureMatch = filePath.match(/fixtures\/([^/]+)\/(.+)$/);
    if (fixtureMatch) {
      return `fixtures/${fixtureMatch[1]}/${fixtureMatch[2]}`;
    }
    return path.basename(filePath);
  };

  // Normalize steps
  if (parsed.steps) {
    for (const step of parsed.steps) {
      if (step.diagnostic?.file) {
        step.diagnostic.file = normalizeFilePath(step.diagnostic.file);
      }
      if (step.changes) {
        for (const change of step.changes) {
          if (change.file) {
            change.file = normalizeFilePath(change.file);
          }
        }
      }
    }
  }

  // Normalize remaining
  if (parsed.remaining) {
    for (const diag of parsed.remaining) {
      if (diag.file) {
        diag.file = normalizeFilePath(diag.file);
      }
    }
  }

  return parsed;
}

/**
 * Load or create golden file.
 * If UPDATE_GOLDEN=true, overwrites existing golden files.
 */
function loadOrCreateGolden(
  name: string,
  actual: object
): { expected: object; isNew: boolean } {
  const goldenPath = path.join(GOLDEN_DIR, `${name}.expected.json`);

  if (process.env.UPDATE_GOLDEN === "true" || !fs.existsSync(goldenPath)) {
    fs.writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + "\n");
    return { expected: actual, isNew: true };
  }

  const expected = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));
  return { expected, isNew: false };
}

describe("Golden Tests", () => {
  describe("async-await fixture", () => {
    it(
      "produces expected repair plan",
      () => {
        const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
        const result = plan(configPath);
        const output = formatPlanJSON(result);
        const normalized = normalizePlan(output);

        const { expected, isNew } = loadOrCreateGolden("async-await", normalized);

        if (isNew) {
          console.log("Created new golden file for async-await");
        }

        // Compare summaries
        expect((normalized as any).summary.initialErrors).toBe(
          (expected as any).summary.initialErrors
        );
        expect((normalized as any).summary.finalErrors).toBe(
          (expected as any).summary.finalErrors
        );
        expect((normalized as any).summary.fixedCount).toBe(
          (expected as any).summary.fixedCount
        );

        // Compare number of steps
        expect((normalized as any).steps.length).toBe(
          (expected as any).steps.length
        );

        // Compare fix names (order matters)
        const actualFixNames = (normalized as any).steps.map(
          (s: any) => s.fixName
        );
        const expectedFixNames = (expected as any).steps.map(
          (s: any) => s.fixName
        );
        expect(actualFixNames).toEqual(expectedFixNames);
      },
      { timeout: 15000 }
    );
  });

  describe("spelling-error fixture", () => {
    it(
      "produces expected repair plan",
      () => {
        const configPath = path.join(FIXTURES_DIR, "spelling-error/tsconfig.json");
        const result = plan(configPath, { includeHighRisk: true });
        const output = formatPlanJSON(result);
        const normalized = normalizePlan(output);

        const { expected, isNew } = loadOrCreateGolden("spelling-error", normalized);

        if (isNew) {
          console.log("Created new golden file for spelling-error");
        }

        expect((normalized as any).summary).toEqual((expected as any).summary);
      },
      { timeout: 15000 }
    );
  });

  describe("missing-import fixture", () => {
    it(
      "classifies unfixable imports correctly",
      () => {
        // This fixture has errors that TypeScript suggests spelling fixes for,
        // but they don't actually fix the problem (they're high risk)
        const configPath = path.join(FIXTURES_DIR, "missing-import/tsconfig.json");
        const result = plan(configPath, { maxIterations: 5, maxCandidates: 3 });
        const output = formatPlanJSON(result);
        const normalized = normalizePlan(output);

        // Should have remaining diagnostics (imports not auto-fixable in this setup)
        expect((normalized as any).remaining.length).toBeGreaterThan(0);
      },
      { timeout: 15000 }
    );
  });

  describe("no-errors fixture", () => {
    it("produces empty repair plan", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const result = plan(configPath);
      const output = formatPlanJSON(result);
      const normalized = normalizePlan(output);

      const { expected, isNew } = loadOrCreateGolden("no-errors", normalized);

      if (isNew) {
        console.log("Created new golden file for no-errors");
      }

      expect((normalized as any).summary.initialErrors).toBe(0);
      expect((normalized as any).summary.finalErrors).toBe(0);
      expect((normalized as any).steps).toHaveLength(0);
      expect((normalized as any).remaining).toHaveLength(0);
    });
  });

  describe("no-fixes-available fixture", () => {
    it(
      "classifies unfixable errors correctly",
      () => {
        const configPath = path.join(
          FIXTURES_DIR,
          "no-fixes-available/tsconfig.json"
        );
        const result = plan(configPath);
        const output = formatPlanJSON(result);
        const normalized = normalizePlan(output);

        const { expected, isNew } = loadOrCreateGolden(
          "no-fixes-available",
          normalized
        );

        if (isNew) {
          console.log("Created new golden file for no-fixes-available");
        }

        // Should have remaining diagnostics
        expect((normalized as any).remaining.length).toBeGreaterThan(0);

        // All remaining should be classified
        for (const diag of (normalized as any).remaining) {
          expect([
            "AutoFixable",
            "AutoFixableHighRisk",
            "NeedsJudgment",
            "NoGeneratedCandidate",
            "NoVerifiedCandidate",
          ]).toContain(diag.disposition);
        }
      },
      { timeout: 15000 }
    );
  });
});

describe("Golden Test Utilities", () => {
  describe("normalizePlan", () => {
    it("normalizes absolute paths to relative", () => {
      const input = JSON.stringify({
        steps: [
          {
            diagnostic: {
              file: "/Users/test/project/fixtures/missing-import/index.ts",
            },
            changes: [
              { file: "/Users/test/project/fixtures/missing-import/index.ts" },
            ],
          },
        ],
        remaining: [
          { file: "/Users/test/project/fixtures/missing-import/helpers.ts" },
        ],
      });

      const result = normalizePlan(input) as any;

      expect(result.steps[0].diagnostic.file).toBe(
        "fixtures/missing-import/index.ts"
      );
      expect(result.steps[0].changes[0].file).toBe(
        "fixtures/missing-import/index.ts"
      );
      expect(result.remaining[0].file).toBe(
        "fixtures/missing-import/helpers.ts"
      );
    });
  });
});
