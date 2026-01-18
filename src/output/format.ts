/**
 * Output Formatting
 *
 * Format repair plans for human-readable and machine-readable output.
 */

import type { RepairPlan } from "./types.js";
import path from "path";

/**
 * Format a repair plan for human-readable console output
 */
export function formatPlanText(plan: RepairPlan): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push("VERIFIED REPAIR PLAN");
  lines.push("═".repeat(60));
  lines.push("");

  lines.push(
    `Errors: ${plan.summary.initialErrors} → ${plan.summary.finalErrors}`
  );

  if (plan.summary.initialErrors > 0) {
    const reduction =
      ((plan.summary.initialErrors - plan.summary.finalErrors) /
        plan.summary.initialErrors) *
      100;
    lines.push(`Reduction: ${reduction.toFixed(0)}%`);
  }

  lines.push("");

  if (plan.steps.length === 0) {
    lines.push("No automatic fixes available.");
  } else {
    lines.push("APPLY THESE FIXES IN ORDER:");
    lines.push("");

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const fileName = path.basename(step.diagnostic.file);

      lines.push(`${i + 1}. ${step.fixName}`);
      lines.push(`   File: ${fileName}:${step.diagnostic.line}`);
      lines.push(`   Error: TS${step.diagnostic.code}`);
      lines.push(`   ${step.diagnostic.message.slice(0, 60)}${step.diagnostic.message.length > 60 ? "..." : ""}`);
      lines.push(`   Effect: ${step.errorsBefore} → ${step.errorsAfter} errors`);
      lines.push(`   Risk: ${step.risk}`);
      lines.push("");
    }
  }

  if (plan.batches.length > 0) {
    lines.push("─".repeat(60));
    lines.push("COMPATIBLE BATCHES:");
    lines.push("");

    for (let i = 0; i < plan.batches.length; i++) {
      const batch = plan.batches[i];
      lines.push(`${i + 1}. ${batch.join(", ")}`);
    }

    lines.push("");
  }

  if (plan.remaining.length > 0) {
    lines.push("─".repeat(60));
    lines.push("REMAINING (require judgment):");
    lines.push("");

    for (const diag of plan.remaining) {
      const fileName = path.basename(diag.file);
      lines.push(`• TS${diag.code} @ ${fileName}:${diag.line}`);
      lines.push(`  ${diag.message.slice(0, 70)}${diag.message.length > 70 ? "..." : ""}`);
      lines.push(`  Disposition: ${diag.disposition}`);
      if (diag.disposition === "NoVerifiedCandidate") {
        lines.push(`  Candidates: ${diag.candidateCount} (none verified to help)`);
      } else if (diag.disposition === "NoGeneratedCandidate") {
        lines.push(`  Candidates: none (TypeScript has no fixes for this error)`);
      }
      lines.push("");
    }
  }

  // Budget information
  lines.push("─".repeat(60));
  lines.push("Budget:");
  lines.push(`  Candidates generated: ${plan.summary.budget.candidatesGenerated}`);
  lines.push(`  Candidates verified: ${plan.summary.budget.candidatesVerified}`);
  if (plan.summary.budget.verificationBudget !== Infinity) {
    lines.push(`  Verification budget: ${plan.summary.budget.verificationBudget}`);
  }
  if (plan.summary.budget.budgetExhausted) {
    lines.push(`  ⚠ Budget exhausted`);
  }

  lines.push("═".repeat(60));

  return lines.join("\n");
}

/**
 * Format a repair plan as JSON for programmatic use
 */
export function formatPlanJSON(plan: RepairPlan): string {
  // Create a clean version for JSON output
  const output = {
    summary: plan.summary,
    steps: plan.steps.map((step) => ({
      id: step.id,
      fixName: step.fixName,
      fixDescription: step.fixDescription,
      risk: step.risk,
      diagnostic: {
        code: step.diagnostic.code,
        message: step.diagnostic.message,
        file: step.diagnostic.file,
        line: step.diagnostic.line,
        column: step.diagnostic.column,
      },
      changes: step.changes.map((c) => ({
        file: c.file,
        start: c.start,
        end: c.end,
        newText: c.newText,
      })),
      effect: {
        before: step.errorsBefore,
        after: step.errorsAfter,
        delta: step.delta,
      },
      dependencies: {
        conflictsWith: step.dependencies.conflictsWith,
        requires: step.dependencies.requires,
        exclusiveGroup: step.dependencies.exclusiveGroup ?? null,
      },
    })),
    batches: plan.batches,
    remaining: plan.remaining.map((diag) => ({
      code: diag.code,
      message: diag.message,
      file: diag.file,
      line: diag.line,
      column: diag.column,
      disposition: diag.disposition,
      candidateCount: diag.candidateCount,
    })),
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Format a compact version for agent consumption
 */
export function formatPlanCompact(plan: RepairPlan): string {
  const output = {
    errors: `${plan.summary.initialErrors} → ${plan.summary.finalErrors}`,
    budget: {
      generated: plan.summary.budget.candidatesGenerated,
      verified: plan.summary.budget.candidatesVerified,
      exhausted: plan.summary.budget.budgetExhausted,
    },
    fixes: plan.steps.map((step) => ({
      fix: step.fixName,
      file: path.basename(step.diagnostic.file),
      line: step.diagnostic.line,
      changes: step.changes.map((c) => ({
        file: path.basename(c.file),
        start: c.start,
        end: c.end,
        text: c.newText.length > 100 ? c.newText.slice(0, 100) + "..." : c.newText,
      })),
      dependencies: {
        conflictsWith: step.dependencies.conflictsWith,
        requires: step.dependencies.requires,
        exclusiveGroup: step.dependencies.exclusiveGroup ?? null,
      },
    })),
    batches: plan.batches,
    remaining: plan.remaining.map((diag) => ({
      code: diag.code,
      file: path.basename(diag.file),
      line: diag.line,
      disposition: diag.disposition,
    })),
  };

  return JSON.stringify(output, null, 2);
}
