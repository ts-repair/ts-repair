/**
 * Budget Preview
 *
 * Estimate budget impact before running a full repair.
 * Useful for dev/testing, pricing, and tuning thresholds.
 */

import {
  createTypeScriptHost,
  toDiagnosticRef,
} from "./typescript.js";
import { pruneCandidates, assessRisk } from "./planner.js";
import type { BudgetPreview } from "../output/types.js";

// ============================================================================
// Preview Options
// ============================================================================

export interface PreviewOptions {
  /** Maximum candidates to evaluate per diagnostic (default: 10) */
  maxCandidates?: number;

  /** Include high-risk fixes in estimate (default: false) */
  includeHighRisk?: boolean;
}

const DEFAULT_OPTIONS: Required<PreviewOptions> = {
  maxCandidates: 10,
  includeHighRisk: false,
};

// ============================================================================
// Preview Implementation
// ============================================================================

/**
 * Preview the budget impact of a repair run without actually verifying
 */
export function previewBudgetImpact(
  configPath: string,
  options: PreviewOptions = {}
): BudgetPreview {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const host = createTypeScriptHost(configPath);

  const diagnostics = host.getDiagnostics();
  const breakdown: BudgetPreview["diagnosticBreakdown"] = [];

  let totalCandidates = 0;
  let totalVerifications = 0;

  for (const diagnostic of diagnostics) {
    const fixes = host.getCodeFixes(diagnostic);
    const pruned = pruneCandidates(fixes, opts.maxCandidates);

    // Filter by risk if not including high-risk
    const eligibleFixes = opts.includeHighRisk
      ? pruned
      : pruned.filter((fix) => assessRisk(fix.fixName) !== "high");

    totalCandidates += fixes.length;
    totalVerifications += eligibleFixes.length;

    breakdown.push({
      diagnostic: toDiagnosticRef(diagnostic),
      candidateCount: fixes.length,
      estimatedCost: eligibleFixes.length,
    });
  }

  return {
    estimatedVerifications: totalVerifications,
    estimatedCandidates: totalCandidates,
    diagnosticBreakdown: breakdown,
  };
}

/**
 * Format a budget preview for human-readable output
 */
export function formatPreviewText(preview: BudgetPreview): string {
  const lines: string[] = [];

  lines.push("Budget Preview");
  lines.push("==============");
  lines.push(`Diagnostics: ${preview.diagnosticBreakdown.length}`);
  lines.push(`Candidates (total): ${preview.estimatedCandidates}`);
  lines.push(`Estimated verifications: ${preview.estimatedVerifications}`);
  lines.push("");
  lines.push("By diagnostic:");

  for (const item of preview.diagnosticBreakdown) {
    const diag = item.diagnostic;
    const shortFile = diag.file.split("/").pop() ?? diag.file;
    const shortMessage =
      diag.message.length > 50
        ? diag.message.slice(0, 50) + "..."
        : diag.message;

    lines.push(
      `  ${shortFile}:${diag.line} TS${diag.code} "${shortMessage}"`
    );
    lines.push(
      `    Candidates: ${item.candidateCount}, Est. cost: ${item.estimatedCost}`
    );
  }

  return lines.join("\n");
}

/**
 * Format a budget preview as JSON
 */
export function formatPreviewJSON(preview: BudgetPreview): string {
  return JSON.stringify(preview, null, 2);
}
