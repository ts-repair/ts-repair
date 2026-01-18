/**
 * Output Format Tests
 *
 * Tests for the output formatting functions.
 */

import { describe, it, expect } from "bun:test";
import {
  formatPlanText,
  formatPlanJSON,
  formatPlanCompact,
} from "../../src/output/format.js";
import type { RepairPlan, VerifiedFix, ClassifiedDiagnostic } from "../../src/output/types.js";

// Helper to create test data
function createTestPlan(overrides: Partial<RepairPlan> = {}): RepairPlan {
  const defaultBudget = {
    candidatesGenerated: 0,
    candidatesVerified: 0,
    verificationBudget: 500,
    budgetExhausted: false,
  };

  const summaryOverrides = overrides.summary ?? {};
  const budgetOverrides = summaryOverrides.budget ?? {};

  return {
    steps: overrides.steps ?? [],
    remaining: overrides.remaining ?? [],
    batches: overrides.batches ?? [],
    summary: {
      initialErrors: summaryOverrides.initialErrors ?? 0,
      finalErrors: summaryOverrides.finalErrors ?? 0,
      fixedCount: summaryOverrides.fixedCount ?? 0,
      remainingCount: summaryOverrides.remainingCount ?? 0,
      budget: {
        ...defaultBudget,
        ...budgetOverrides,
      },
    },
  };
}

function createTestFix(overrides: Partial<VerifiedFix> = {}): VerifiedFix {
  return {
    id: "fix-0",
    diagnostic: {
      code: 2304,
      message: "Cannot find name 'foo'",
      file: "/project/src/index.ts",
      line: 10,
      column: 5,
      start: 100,
      length: 3,
    },
    fixName: "fixMissingImport",
    fixDescription: "Add import from './foo'",
    changes: [
      {
        file: "/project/src/index.ts",
        start: 0,
        end: 0,
        newText: "import { foo } from './foo';\n",
      },
    ],
    errorsBefore: 3,
    errorsAfter: 2,
    delta: 1,
    risk: "low",
    dependencies: {
      conflictsWith: [],
      requires: [],
    },
    ...overrides,
  };
}

function createTestDiagnostic(
  overrides: Partial<ClassifiedDiagnostic> = {}
): ClassifiedDiagnostic {
  return {
    code: 2322,
    message: "Type 'string' is not assignable to type 'number'",
    file: "/project/src/index.ts",
    line: 15,
    column: 10,
    start: 200,
    length: 10,
    disposition: "NoGeneratedCandidate",
    candidateCount: 0,
    ...overrides,
  };
}

describe("formatPlanText", () => {
  it("formats empty plan", () => {
    const plan = createTestPlan();
    const output = formatPlanText(plan);

    expect(output).toContain("VERIFIED REPAIR PLAN");
    expect(output).toContain("Errors: 0 → 0");
    expect(output).toContain("No automatic fixes available");
  });

  it("formats plan with fixes", () => {
    const plan = createTestPlan({
      steps: [createTestFix()],
      summary: {
        initialErrors: 3,
        finalErrors: 2,
        fixedCount: 1,
        remainingCount: 0,
      },
      batches: [["fix-0"]],
    });

    const output = formatPlanText(plan);

    expect(output).toContain("Errors: 3 → 2");
    expect(output).toContain("APPLY THESE FIXES IN ORDER");
    expect(output).toContain("1. fixMissingImport");
    expect(output).toContain("File: index.ts:10");
    expect(output).toContain("Error: TS2304");
    expect(output).toContain("Effect: 3 → 2 errors");
    expect(output).toContain("Risk: low");
    expect(output).toContain("COMPATIBLE BATCHES");
    expect(output).toContain("1. fix-0");
  });

  it("skips batches section when empty", () => {
    const plan = createTestPlan({
      steps: [createTestFix()],
      summary: {
        initialErrors: 1,
        finalErrors: 0,
        fixedCount: 1,
        remainingCount: 0,
      },
    });

    const output = formatPlanText(plan);

    expect(output).not.toContain("COMPATIBLE BATCHES");
  });

  it("formats plan with remaining diagnostics", () => {
    const plan = createTestPlan({
      remaining: [createTestDiagnostic()],
      summary: {
        initialErrors: 1,
        finalErrors: 1,
        fixedCount: 0,
        remainingCount: 1,
      },
    });

    const output = formatPlanText(plan);

    expect(output).toContain("REMAINING (require judgment)");
    expect(output).toContain("TS2322");
    expect(output).toContain("Disposition: NoGeneratedCandidate");
  });

  it("calculates reduction percentage", () => {
    const plan = createTestPlan({
      summary: {
        initialErrors: 10,
        finalErrors: 3,
        fixedCount: 7,
        remainingCount: 3,
      },
    });

    const output = formatPlanText(plan);

    expect(output).toContain("Reduction: 70%");
  });

  it("truncates long messages", () => {
    const longMessage = "a".repeat(100);
    const plan = createTestPlan({
      steps: [
        createTestFix({
          diagnostic: {
            code: 2304,
            message: longMessage,
            file: "/project/src/index.ts",
            line: 10,
            column: 5,
            start: 100,
            length: 3,
          },
        }),
      ],
      summary: {
        initialErrors: 1,
        finalErrors: 0,
        fixedCount: 1,
        remainingCount: 0,
      },
    });

    const output = formatPlanText(plan);

    // Should be truncated with "..."
    expect(output).toContain("...");
  });

  it("numbers multiple fixes correctly", () => {
    const plan = createTestPlan({
      steps: [
        createTestFix({ id: "fix-0", fixName: "firstFix" }),
        createTestFix({ id: "fix-1", fixName: "secondFix" }),
        createTestFix({ id: "fix-2", fixName: "thirdFix" }),
      ],
      summary: {
        initialErrors: 3,
        finalErrors: 0,
        fixedCount: 3,
        remainingCount: 0,
      },
    });

    const output = formatPlanText(plan);

    expect(output).toContain("1. firstFix");
    expect(output).toContain("2. secondFix");
    expect(output).toContain("3. thirdFix");
  });

  it("includes candidate count for NoVerifiedCandidate diagnostics", () => {
    const plan = createTestPlan({
      remaining: [
        createTestDiagnostic({
          disposition: "NoVerifiedCandidate",
          candidateCount: 5,
        }),
      ],
      summary: {
        initialErrors: 1,
        finalErrors: 1,
        fixedCount: 0,
        remainingCount: 1,
      },
    });

    const output = formatPlanText(plan);

    expect(output).toContain("Candidates: 5 (none verified to help)");
  });

  it("shows no-fixes message for NoGeneratedCandidate diagnostics", () => {
    const plan = createTestPlan({
      remaining: [
        createTestDiagnostic({
          disposition: "NoGeneratedCandidate",
          candidateCount: 0,
        }),
      ],
      summary: {
        initialErrors: 1,
        finalErrors: 1,
        fixedCount: 0,
        remainingCount: 1,
      },
    });

    const output = formatPlanText(plan);

    expect(output).toContain("Candidates: none (TypeScript has no fixes for this error)");
  });
});

describe("formatPlanJSON", () => {
  it("produces valid JSON", () => {
    const plan = createTestPlan();
    const output = formatPlanJSON(plan);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("includes summary", () => {
    const plan = createTestPlan({
      summary: {
        initialErrors: 5,
        finalErrors: 2,
        fixedCount: 3,
        remainingCount: 2,
      },
    });

    const output = JSON.parse(formatPlanJSON(plan));

    expect(output.summary.initialErrors).toBe(5);
    expect(output.summary.finalErrors).toBe(2);
    expect(output.summary.fixedCount).toBe(3);
    expect(output.summary.remainingCount).toBe(2);
  });

  it("includes steps with all fields", () => {
    const plan = createTestPlan({
      steps: [createTestFix()],
      summary: {
        initialErrors: 1,
        finalErrors: 0,
        fixedCount: 1,
        remainingCount: 0,
      },
      batches: [["fix-0"]],
    });

    const output = JSON.parse(formatPlanJSON(plan));

    expect(output.steps).toHaveLength(1);
    expect(output.batches).toEqual([["fix-0"]]);
    const step = output.steps[0];

    expect(step.id).toBe("fix-0");
    expect(step.fixName).toBe("fixMissingImport");
    expect(step.fixDescription).toBe("Add import from './foo'");
    expect(step.risk).toBe("low");
    expect(step.diagnostic.code).toBe(2304);
    expect(step.changes).toHaveLength(1);
    expect(step.effect.before).toBe(3);
    expect(step.effect.after).toBe(2);
    expect(step.effect.delta).toBe(1);
    expect(step.dependencies.conflictsWith).toEqual([]);
    expect(step.dependencies.requires).toEqual([]);
    expect(step.dependencies.exclusiveGroup).toBeNull();
  });

  it("includes remaining diagnostics", () => {
    const plan = createTestPlan({
      remaining: [createTestDiagnostic()],
      summary: {
        initialErrors: 1,
        finalErrors: 1,
        fixedCount: 0,
        remainingCount: 1,
      },
    });

    const output = JSON.parse(formatPlanJSON(plan));

    expect(output.remaining).toHaveLength(1);
    const diag = output.remaining[0];

    expect(diag.code).toBe(2322);
    expect(diag.disposition).toBe("NoGeneratedCandidate");
    expect(diag.candidateCount).toBe(0);
  });

  it("formats with indentation", () => {
    const plan = createTestPlan();
    const output = formatPlanJSON(plan);

    // Should have newlines (formatted)
    expect(output).toContain("\n");
  });
});

describe("formatPlanCompact", () => {
  it("produces valid JSON", () => {
    const plan = createTestPlan();
    const output = formatPlanCompact(plan);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("uses compact error summary", () => {
    const plan = createTestPlan({
      summary: {
        initialErrors: 5,
        finalErrors: 2,
        fixedCount: 3,
        remainingCount: 2,
      },
      batches: [["fix-0", "fix-1"]],
    });

    const output = JSON.parse(formatPlanCompact(plan));

    expect(output.errors).toBe("5 → 2");
    expect(output.batches).toEqual([["fix-0", "fix-1"]]);
  });

  it("includes dependencies in compact fixes", () => {
    const plan = createTestPlan({
      steps: [
        createTestFix({
          dependencies: {
            conflictsWith: ["fix-1"],
            requires: ["fix-2"],
            exclusiveGroup: "group-1",
          },
        }),
      ],
      summary: {
        initialErrors: 1,
        finalErrors: 0,
        fixedCount: 1,
        remainingCount: 0,
      },
      batches: [["fix-0"]],
    });

    const output = JSON.parse(formatPlanCompact(plan));

    expect(output.fixes[0].dependencies.conflictsWith).toEqual(["fix-1"]);
    expect(output.fixes[0].dependencies.requires).toEqual(["fix-2"]);
    expect(output.fixes[0].dependencies.exclusiveGroup).toBe("group-1");
    expect(output.batches).toEqual([["fix-0"]]);
  });

  it("uses basename for file paths", () => {
    const plan = createTestPlan({
      steps: [createTestFix()],
      summary: {
        initialErrors: 1,
        finalErrors: 0,
        fixedCount: 1,
        remainingCount: 0,
      },
    });

    const output = JSON.parse(formatPlanCompact(plan));

    expect(output.fixes[0].file).toBe("index.ts");
    expect(output.fixes[0].changes[0].file).toBe("index.ts");
  });

  it("truncates long newText", () => {
    const longText = "x".repeat(200);
    const plan = createTestPlan({
      steps: [
        createTestFix({
          changes: [
            {
              file: "/project/src/index.ts",
              start: 0,
              end: 0,
              newText: longText,
            },
          ],
        }),
      ],
      summary: {
        initialErrors: 1,
        finalErrors: 0,
        fixedCount: 1,
        remainingCount: 0,
      },
    });

    const output = JSON.parse(formatPlanCompact(plan));

    expect(output.fixes[0].changes[0].text.length).toBeLessThan(longText.length);
    expect(output.fixes[0].changes[0].text).toContain("...");
  });

  it("includes minimal remaining info", () => {
    const plan = createTestPlan({
      remaining: [createTestDiagnostic()],
      summary: {
        initialErrors: 1,
        finalErrors: 1,
        fixedCount: 0,
        remainingCount: 1,
      },
    });

    const output = JSON.parse(formatPlanCompact(plan));

    expect(output.remaining).toHaveLength(1);
    const diag = output.remaining[0];

    expect(diag.code).toBe(2322);
    expect(diag.file).toBe("index.ts");
    expect(diag.line).toBe(15);
    expect(diag.disposition).toBe("NoGeneratedCandidate");

    // Should NOT include full message
    expect(diag.message).toBeUndefined();
  });
});

describe("Format Consistency", () => {
  it("all formats handle empty plan", () => {
    const plan = createTestPlan();

    expect(() => formatPlanText(plan)).not.toThrow();
    expect(() => formatPlanJSON(plan)).not.toThrow();
    expect(() => formatPlanCompact(plan)).not.toThrow();
  });

  it("all formats handle full plan", () => {
    const plan = createTestPlan({
      steps: [
        createTestFix({ id: "fix-0" }),
        createTestFix({ id: "fix-1" }),
      ],
      remaining: [
        createTestDiagnostic({ disposition: "NoGeneratedCandidate" }),
        createTestDiagnostic({ disposition: "NeedsJudgment", candidateCount: 3 }),
      ],
      summary: {
        initialErrors: 5,
        finalErrors: 2,
        fixedCount: 2,
        remainingCount: 2,
        budget: {
          candidatesGenerated: 20,
          candidatesVerified: 15,
          verificationBudget: 500,
          budgetExhausted: false,
        },
      },
    });

    expect(() => formatPlanText(plan)).not.toThrow();
    expect(() => formatPlanJSON(plan)).not.toThrow();
    expect(() => formatPlanCompact(plan)).not.toThrow();
  });
});

describe("Budget Output", () => {
  describe("formatPlanText budget section", () => {
    it("includes budget section in text output", () => {
      const plan = createTestPlan({
        summary: {
          initialErrors: 5,
          finalErrors: 2,
          fixedCount: 3,
          remainingCount: 2,
          budget: {
            candidatesGenerated: 25,
            candidatesVerified: 18,
            verificationBudget: 500,
            budgetExhausted: false,
          },
        },
      });

      const output = formatPlanText(plan);

      expect(output).toContain("Budget:");
      expect(output).toContain("Candidates generated: 25");
      expect(output).toContain("Candidates verified: 18");
    });

    it("shows verification budget when not infinity", () => {
      const plan = createTestPlan({
        summary: {
          initialErrors: 1,
          finalErrors: 0,
          fixedCount: 1,
          remainingCount: 0,
          budget: {
            candidatesGenerated: 10,
            candidatesVerified: 5,
            verificationBudget: 100,
            budgetExhausted: false,
          },
        },
      });

      const output = formatPlanText(plan);

      expect(output).toContain("Verification budget: 100");
    });

    it("shows warning when budget exhausted", () => {
      const plan = createTestPlan({
        summary: {
          initialErrors: 10,
          finalErrors: 8,
          fixedCount: 2,
          remainingCount: 8,
          budget: {
            candidatesGenerated: 50,
            candidatesVerified: 50,
            verificationBudget: 50,
            budgetExhausted: true,
          },
        },
      });

      const output = formatPlanText(plan);

      expect(output).toContain("Budget exhausted");
    });
  });

  describe("formatPlanJSON budget section", () => {
    it("includes budget in JSON summary", () => {
      const plan = createTestPlan({
        summary: {
          initialErrors: 5,
          finalErrors: 2,
          fixedCount: 3,
          remainingCount: 2,
          budget: {
            candidatesGenerated: 25,
            candidatesVerified: 18,
            verificationBudget: 500,
            budgetExhausted: false,
          },
        },
      });

      const output = JSON.parse(formatPlanJSON(plan));

      expect(output.summary.budget).toBeDefined();
      expect(output.summary.budget.candidatesGenerated).toBe(25);
      expect(output.summary.budget.candidatesVerified).toBe(18);
      expect(output.summary.budget.verificationBudget).toBe(500);
      expect(output.summary.budget.budgetExhausted).toBe(false);
    });
  });

  describe("formatPlanCompact budget section", () => {
    it("includes compact budget in output", () => {
      const plan = createTestPlan({
        summary: {
          initialErrors: 5,
          finalErrors: 2,
          fixedCount: 3,
          remainingCount: 2,
          budget: {
            candidatesGenerated: 25,
            candidatesVerified: 18,
            verificationBudget: 500,
            budgetExhausted: false,
          },
        },
      });

      const output = JSON.parse(formatPlanCompact(plan));

      expect(output.budget).toBeDefined();
      expect(output.budget.generated).toBe(25);
      expect(output.budget.verified).toBe(18);
      expect(output.budget.exhausted).toBe(false);
    });

    it("shows exhausted flag when true", () => {
      const plan = createTestPlan({
        summary: {
          initialErrors: 10,
          finalErrors: 8,
          fixedCount: 2,
          remainingCount: 8,
          budget: {
            candidatesGenerated: 50,
            candidatesVerified: 50,
            verificationBudget: 50,
            budgetExhausted: true,
          },
        },
      });

      const output = JSON.parse(formatPlanCompact(plan));

      expect(output.budget.exhausted).toBe(true);
    });
  });
});
