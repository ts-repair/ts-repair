#!/usr/bin/env node

/**
 * ts-repair CLI
 *
 * Command-line interface for the oracle-guided TypeScript repair engine.
 */

import { repair, createBudgetLogger } from "./oracle/planner.js";
import { previewBudgetImpact, formatPreviewText, formatPreviewJSON } from "./oracle/preview.js";
import { formatPlanText, formatPlanJSON, formatPlanCompact } from "./output/format.js";
import type { RepairRequest } from "./output/types.js";
import fs from "fs";
import path from "path";

// ============================================================================
// Argument Parsing
// ============================================================================

interface CliArgs {
  command: "repair" | "preview" | "help" | "version";
  project: string;
  json: boolean;
  compact: boolean;
  apply: boolean;
  includeHighRisk: boolean;
  verbose: boolean;
  trace: boolean;
  maxVerifications?: number;
  maxCandidatesPerIteration?: number;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    command: "help",
    project: "./tsconfig.json",
    json: false,
    compact: false,
    apply: false,
    includeHighRisk: false,
    verbose: false,
    trace: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "repair") {
      result.command = "repair";
    } else if (arg === "preview") {
      result.command = "preview";
    } else if (arg === "help" || arg === "--help" || arg === "-h") {
      result.command = "help";
    } else if (arg === "version" || arg === "--version" || arg === "-v") {
      result.command = "version";
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--compact") {
      result.compact = true;
    } else if (arg === "--apply") {
      result.apply = true;
    } else if (arg === "--include-high-risk") {
      result.includeHighRisk = true;
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "--trace") {
      result.trace = true;
    } else if (arg === "--max-verifications" && i + 1 < args.length) {
      result.maxVerifications = parseInt(args[++i], 10);
    } else if (arg === "--max-candidates-per-iteration" && i + 1 < args.length) {
      result.maxCandidatesPerIteration = parseInt(args[++i], 10);
    } else if (!arg.startsWith("-") && (result.command === "repair" || result.command === "preview")) {
      result.project = arg;
    }

    i++;
  }

  return result;
}

// ============================================================================
// Commands
// ============================================================================

function showHelp(): void {
  console.log(`
ts-repair - Oracle-Guided TypeScript Repair Engine

Usage:
  ts-repair repair [tsconfig.json] [options]
  ts-repair preview [tsconfig.json] [options]
  ts-repair help
  ts-repair version

Commands:
  repair    Generate a verified repair plan for TypeScript errors
  preview   Preview budget impact without running verification
  help      Show this help message
  version   Show version information

Options:
  --json                          Output as JSON
  --compact                       Output compact JSON (for agents)
  --apply                         Apply fixes to files (not implemented yet)
  --include-high-risk             Include high-risk fixes
  --verbose                       Show progress messages
  --trace                         Output budget event log as JSON
  --max-verifications N           Maximum total verifications (default: 500)
  --max-candidates-per-iteration N  Max candidates per iteration (default: 100)

Examples:
  ts-repair repair                    # Repair using ./tsconfig.json
  ts-repair repair ./tsconfig.json    # Repair specific project
  ts-repair repair --json             # Output as JSON
  ts-repair repair --verbose          # Show progress
  ts-repair repair --trace            # Output event log for analysis
  ts-repair repair --max-verifications 50  # Limit verification budget
  ts-repair preview ./tsconfig.json   # Preview budget impact
`);
}

function showVersion(): void {
  // Read version from package.json
  try {
    const pkgPath = path.join(import.meta.dirname ?? ".", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    console.log(`ts-repair version ${pkg.version}`);
  } catch {
    console.log("ts-repair version 0.2.0");
  }
}

function runRepair(args: CliArgs): void {
  const startTime = Date.now();

  // Resolve project path
  const projectPath = path.resolve(args.project);

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: File not found: ${projectPath}`);
    process.exit(1);
  }

  // Build request
  const request: RepairRequest = {
    project: projectPath,
    includeHighRisk: args.includeHighRisk,
    maxVerifications: args.maxVerifications,
    maxCandidatesPerIteration: args.maxCandidatesPerIteration,
  };

  // Create logger if tracing
  const logger = args.trace ? createBudgetLogger() : undefined;

  try {
    const plan = repair(request, logger);

    // Format output
    if (args.trace) {
      // Output trace log as JSON
      const traceOutput = {
        plan: JSON.parse(formatPlanJSON(plan)),
        trace: {
          events: logger!.getEvents(),
          summary: logger!.getSummary(),
        },
      };
      console.log(JSON.stringify(traceOutput, null, 2));
    } else if (args.json) {
      console.log(formatPlanJSON(plan));
    } else if (args.compact) {
      console.log(formatPlanCompact(plan));
    } else {
      console.log(formatPlanText(plan));
    }

    const duration = Date.now() - startTime;
    if (args.verbose) {
      console.error(`\nCompleted in ${duration}ms`);
    }

    // Exit with error code if there are remaining errors
    if (plan.summary.finalErrors > 0) {
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

function runPreview(args: CliArgs): void {
  // Resolve project path
  const projectPath = path.resolve(args.project);

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: File not found: ${projectPath}`);
    process.exit(1);
  }

  try {
    const preview = previewBudgetImpact(projectPath, {
      includeHighRisk: args.includeHighRisk,
    });

    if (args.json) {
      console.log(formatPreviewJSON(preview));
    } else {
      console.log(formatPreviewText(preview));
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "help":
      showHelp();
      break;
    case "version":
      showVersion();
      break;
    case "repair":
      runRepair(args);
      break;
    case "preview":
      runPreview(args);
      break;
  }
}

main();
