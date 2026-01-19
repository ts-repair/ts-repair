#!/usr/bin/env bun

/**
 * ts-repair CLI
 *
 * Command-line interface for the oracle-guided TypeScript repair engine.
 *
 * Commands:
 *   ts-repair tsc -- [tsc args]   Run tsc with optional repair features
 *   ts-repair check               Convenience wrapper for tsc --noEmit
 *   ts-repair plan                Generate a verified repair plan
 *   ts-repair apply               Apply repairs to files
 *   ts-repair explain             Explain a repair candidate
 *   ts-repair repair              Generate plan + optional auto-apply (new)
 *   ts-repair preview             Preview budget impact without verification (new)
 *   ts-repair mcp-server          Run MCP server for agent integration
 *
 * See docs/CLI.md for full specification.
 */

import { repair, createBudgetLogger } from "./oracle/planner.js";
import { previewBudgetImpact, formatPreviewText, formatPreviewJSON } from "./oracle/preview.js";
import { formatPlanText, formatPlanJSON, formatPlanCompact } from "./output/format.js";
import type { RepairPlan, VerifiedFix, FileChange } from "./output/types.js";
import { createTypeScriptHost } from "./oracle/typescript.js";
import { runMcpServer } from "./mcp/server.js";
import type { ScoringStrategy } from "./oracle/planner.js";
import ts from "typescript";
import fs from "fs";
import path from "path";

// ============================================================================
// Exit Codes
// ============================================================================

const EXIT_SUCCESS = 0; // No remaining diagnostics / successful apply
const EXIT_DIAGNOSTICS = 1; // Diagnostics remain
const EXIT_ERROR = 2; // Tool or configuration error

// ============================================================================
// Global Options
// ============================================================================

interface GlobalOptions {
  project: string;
  format: "text" | "json";
  verbose: boolean;
}

function parseGlobalOptions(args: string[]): {
  options: GlobalOptions;
  remaining: string[];
} {
  const options: GlobalOptions = {
    project: "./tsconfig.json",
    format: "text",
    verbose: false,
  };

  const remaining: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "-p" || arg === "--project") {
      if (i + 1 >= args.length) {
        console.error("Error: --project requires a path argument");
        process.exit(EXIT_ERROR);
      }
      options.project = args[++i];
    } else if (arg.startsWith("--project=")) {
      options.project = arg.slice("--project=".length);
    } else if (arg === "--format") {
      if (i + 1 >= args.length) {
        console.error("Error: --format requires an argument (text or json)");
        process.exit(EXIT_ERROR);
      }
      const format = args[++i];
      if (format !== "text" && format !== "json") {
        console.error(`Error: --format must be 'text' or 'json', got '${format}'`);
        process.exit(EXIT_ERROR);
      }
      options.format = format;
    } else if (arg.startsWith("--format=")) {
      const format = arg.slice("--format=".length);
      if (format !== "text" && format !== "json") {
        console.error(`Error: --format must be 'text' or 'json', got '${format}'`);
        process.exit(EXIT_ERROR);
      }
      options.format = format as "text" | "json";
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else {
      remaining.push(arg);
    }

    i++;
  }

  return { options, remaining };
}

// ============================================================================
// tsc Command
// ============================================================================

interface TscOptions {
  plan: boolean;
  auto: boolean;
  tscArgs: string[];
}

function parseTscOptions(args: string[]): TscOptions {
  const options: TscOptions = {
    plan: false,
    auto: false,
    tscArgs: [],
  };

  // Find -- separator
  const dashDashIndex = args.indexOf("--");
  const beforeDash = dashDashIndex >= 0 ? args.slice(0, dashDashIndex) : args;
  const afterDash = dashDashIndex >= 0 ? args.slice(dashDashIndex + 1) : [];

  // Parse ts-repair options before --
  for (const arg of beforeDash) {
    if (arg === "--plan") {
      options.plan = true;
    } else if (arg === "--auto") {
      options.auto = true;
    }
  }

  // Everything after -- goes to tsc
  options.tscArgs = afterDash;

  return options;
}

function runTsc(global: GlobalOptions, args: string[]): void {
  const options = parseTscOptions(args);

  // Build tsc command line
  const tscArgs = [...options.tscArgs];

  // If no -p in tscArgs, add our project
  const hasProject = tscArgs.some(
    (arg) => arg === "-p" || arg === "--project" || arg.startsWith("-p") || arg.startsWith("--project")
  );
  if (!hasProject) {
    tscArgs.unshift("-p", path.resolve(global.project));
  }

  if (global.verbose) {
    console.error(`Running: tsc ${tscArgs.join(" ")}`);
  }

  // If --auto, run repair and apply AutoFixable fixes first
  if (options.auto) {
    try {
      const projectPath = path.resolve(global.project);
      const plan = repair({ project: projectPath, includeHighRisk: false });

      // Apply AutoFixable steps
      const autoFixable = plan.steps.filter((step) => step.risk === "low" || step.risk === "medium");

      if (autoFixable.length > 0) {
        applyChangesToDisk(autoFixable);
        if (global.verbose) {
          console.error(`Applied ${autoFixable.length} auto-fixes`);
        }
      }
    } catch (e) {
      console.error(`Error during auto-fix: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(EXIT_ERROR);
    }
  }

  // Run tsc
  const projectPath = path.resolve(global.project);
  const diagnostics = runTypeCheck(projectPath);

  // Format diagnostics in tsc-compatible format
  const formatHost: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => ts.sys.newLine,
  };

  if (diagnostics.length > 0) {
    console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
  }

  // If --plan, also emit repair plan
  if (options.plan) {
    try {
      const plan = repair({ project: projectPath, includeHighRisk: false });
      console.log("\n--- Repair Plan ---\n");
      if (global.format === "json") {
        console.log(formatPlanJSON(plan));
      } else {
        console.log(formatPlanText(plan));
      }
    } catch (e) {
      console.error(`Error generating plan: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Exit with tsc-compatible exit code
  process.exit(diagnostics.length > 0 ? EXIT_DIAGNOSTICS : EXIT_SUCCESS);
}

// ============================================================================
// check Command
// ============================================================================

function runCheck(global: GlobalOptions, _args: string[]): void {
  // check is just tsc -- --noEmit
  runTsc(global, ["--", "--noEmit"]);
}

// ============================================================================
// plan Command
// ============================================================================

interface PlanOptions {
  out?: string;
  maxCandidates: number;
  maxPerDiagnostic: number;
  maxVerifications: number;
  scoringStrategy: ScoringStrategy;
}

function parsePlanOptions(args: string[]): PlanOptions {
  const options: PlanOptions = {
    maxCandidates: 20,
    maxPerDiagnostic: 3,
    maxVerifications: 200,
    scoringStrategy: "delta",
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--out" && i + 1 < args.length) {
      options.out = args[++i];
    } else if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
    } else if (arg === "--max-candidates" && i + 1 < args.length) {
      options.maxCandidates = parseInt(args[++i], 10);
    } else if (arg === "--max-per-diagnostic" && i + 1 < args.length) {
      options.maxPerDiagnostic = parseInt(args[++i], 10);
    } else if (arg === "--max-verifications" && i + 1 < args.length) {
      options.maxVerifications = parseInt(args[++i], 10);
    } else if (arg === "--scoring-strategy" && i + 1 < args.length) {
      const strategy = args[++i];
      if (strategy !== "delta" && strategy !== "weighted") {
        console.error(`Error: --scoring-strategy must be 'delta' or 'weighted', got '${strategy}'`);
        process.exit(EXIT_ERROR);
      }
      options.scoringStrategy = strategy as ScoringStrategy;
    } else if (arg.startsWith("--scoring-strategy=")) {
      const strategy = arg.slice("--scoring-strategy=".length);
      if (strategy !== "delta" && strategy !== "weighted") {
        console.error(`Error: --scoring-strategy must be 'delta' or 'weighted', got '${strategy}'`);
        process.exit(EXIT_ERROR);
      }
      options.scoringStrategy = strategy as ScoringStrategy;
    }

    i++;
  }

  return options;
}

function runPlan(global: GlobalOptions, args: string[]): void {
  const options = parsePlanOptions(args);
  const projectPath = path.resolve(global.project);

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: File not found: ${projectPath}`);
    process.exit(EXIT_ERROR);
  }

  // Default format for plan is json
  const format = global.format === "text" ? "text" : "json";

  const logger = global.verbose ? createBudgetLogger() : undefined;

  try {
    const plan = repair(
      {
        project: projectPath,
        maxCandidates: options.maxPerDiagnostic,
        maxCandidatesPerIteration: options.maxCandidates,
        maxVerifications: options.maxVerifications,
        includeHighRisk: false,
        scoringStrategy: options.scoringStrategy,
      },
      logger
    );

    const output = format === "json" ? formatPlanJSON(plan) : formatPlanText(plan);

    if (options.out) {
      fs.writeFileSync(options.out, output, "utf-8");
      if (global.verbose) {
        console.error(`Plan written to ${options.out}`);
      }
    } else {
      console.log(output);
    }

    if (global.verbose && logger) {
      console.error(`\nBudget: ${logger.getSummary().verificationsRun} verifications`);
    }

    process.exit(plan.summary.finalErrors > 0 ? EXIT_DIAGNOSTICS : EXIT_SUCCESS);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(EXIT_ERROR);
  }
}

// ============================================================================
// apply Command
// ============================================================================

interface ApplyOptions {
  planFile?: string;
  auto: boolean;
  allowHighRisk: boolean;
  ids?: string[];
  scoringStrategy: ScoringStrategy;
}

function parseApplyOptions(args: string[]): ApplyOptions {
  const options: ApplyOptions = {
    auto: false,
    allowHighRisk: false,
    scoringStrategy: "delta",
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--plan" && i + 1 < args.length) {
      options.planFile = args[++i];
    } else if (arg.startsWith("--plan=")) {
      options.planFile = arg.slice("--plan=".length);
    } else if (arg === "--auto") {
      options.auto = true;
    } else if (arg === "--allow-high-risk") {
      options.allowHighRisk = true;
    } else if (arg === "--ids" && i + 1 < args.length) {
      options.ids = args[++i].split(",").map((id) => id.trim());
    } else if (arg.startsWith("--ids=")) {
      options.ids = arg.slice("--ids=".length).split(",").map((id) => id.trim());
    } else if (arg === "--scoring-strategy" && i + 1 < args.length) {
      const strategy = args[++i];
      if (strategy !== "delta" && strategy !== "weighted") {
        console.error(`Error: --scoring-strategy must be 'delta' or 'weighted', got '${strategy}'`);
        process.exit(EXIT_ERROR);
      }
      options.scoringStrategy = strategy as ScoringStrategy;
    } else if (arg.startsWith("--scoring-strategy=")) {
      const strategy = arg.slice("--scoring-strategy=".length);
      if (strategy !== "delta" && strategy !== "weighted") {
        console.error(`Error: --scoring-strategy must be 'delta' or 'weighted', got '${strategy}'`);
        process.exit(EXIT_ERROR);
      }
      options.scoringStrategy = strategy as ScoringStrategy;
    }

    i++;
  }

  return options;
}

function runApply(global: GlobalOptions, args: string[]): void {
  const options = parseApplyOptions(args);
  const projectPath = path.resolve(global.project);

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: File not found: ${projectPath}`);
    process.exit(EXIT_ERROR);
  }

  let plan: RepairPlan;

  if (options.planFile) {
    // Load plan from file
    if (!fs.existsSync(options.planFile)) {
      console.error(`Error: Plan file not found: ${options.planFile}`);
      process.exit(EXIT_ERROR);
    }

    try {
      const planContent = fs.readFileSync(options.planFile, "utf-8");
      plan = JSON.parse(planContent) as RepairPlan;
    } catch (e) {
      console.error(`Error: Failed to parse plan file: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(EXIT_ERROR);
    }
  } else if (options.auto) {
    // Generate plan on the fly
    try {
      plan = repair({
        project: projectPath,
        includeHighRisk: options.allowHighRisk,
        scoringStrategy: options.scoringStrategy,
      });
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(EXIT_ERROR);
    }
  } else {
    console.error("Error: Must specify --plan <file> or --auto");
    process.exit(EXIT_ERROR);
  }

  // Filter steps
  let stepsToApply = plan.steps;

  if (options.ids) {
    // Apply only specified IDs
    const idSet = new Set(options.ids);
    stepsToApply = stepsToApply.filter((step) => idSet.has(step.id));

    if (stepsToApply.length === 0) {
      console.error(`Error: No matching repair IDs found`);
      process.exit(EXIT_ERROR);
    }
  } else if (options.auto && !options.allowHighRisk) {
    // In auto mode without --allow-high-risk, only apply low/medium risk
    stepsToApply = stepsToApply.filter((step) => step.risk === "low" || step.risk === "medium");
  }

  if (stepsToApply.length === 0) {
    if (global.verbose) {
      console.error("No repairs to apply");
    }
    // Re-run typecheck to get final exit code
    const diagnostics = runTypeCheck(projectPath);
    process.exit(diagnostics.length > 0 ? EXIT_DIAGNOSTICS : EXIT_SUCCESS);
    return;
  }

  // Apply changes to disk
  try {
    applyChangesToDisk(stepsToApply);

    if (global.verbose) {
      console.error(`Applied ${stepsToApply.length} repairs`);
      for (const step of stepsToApply) {
        console.error(`  ${step.id}: ${step.fixDescription}`);
      }
    }
  } catch (e) {
    console.error(`Error applying repairs: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(EXIT_ERROR);
  }

  // Re-run typecheck to verify
  const diagnostics = runTypeCheck(projectPath);

  if (global.format === "json") {
    console.log(
      JSON.stringify(
        {
          applied: stepsToApply.map((s) => s.id),
          remainingDiagnostics: diagnostics.length,
        },
        null,
        2
      )
    );
  } else if (diagnostics.length > 0) {
    console.log(`Applied ${stepsToApply.length} repairs. ${diagnostics.length} diagnostics remain.`);
  } else {
    console.log(`Applied ${stepsToApply.length} repairs. No diagnostics remain.`);
  }

  process.exit(diagnostics.length > 0 ? EXIT_DIAGNOSTICS : EXIT_SUCCESS);
}

// ============================================================================
// explain Command
// ============================================================================

interface ExplainOptions {
  id?: string;
}

function parseExplainOptions(args: string[]): ExplainOptions {
  const options: ExplainOptions = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--id" && i + 1 < args.length) {
      options.id = args[++i];
    } else if (arg.startsWith("--id=")) {
      options.id = arg.slice("--id=".length);
    }

    i++;
  }

  return options;
}

function runExplain(global: GlobalOptions, args: string[]): void {
  const options = parseExplainOptions(args);
  const projectPath = path.resolve(global.project);

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: File not found: ${projectPath}`);
    process.exit(EXIT_ERROR);
  }

  if (!options.id) {
    console.error("Error: --id is required");
    process.exit(EXIT_ERROR);
  }

  try {
    const plan = repair({
      project: projectPath,
      includeHighRisk: true, // Include all for explain
    });

    const step = plan.steps.find((s) => s.id === options.id);

    if (!step) {
      console.error(`Error: Repair ID '${options.id}' not found in plan`);
      console.error(`Available IDs: ${plan.steps.map((s) => s.id).join(", ") || "(none)"}`);
      process.exit(EXIT_ERROR);
    }

    if (global.format === "json") {
      console.log(JSON.stringify(formatExplanation(step), null, 2));
    } else {
      printExplanation(step);
    }

    process.exit(EXIT_SUCCESS);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(EXIT_ERROR);
  }
}

function formatExplanation(step: VerifiedFix): object {
  return {
    id: step.id,
    fixName: step.fixName,
    fixDescription: step.fixDescription,
    risk: step.risk,
    diagnostic: step.diagnostic,
    verification: {
      errorsBefore: step.errorsBefore,
      errorsAfter: step.errorsAfter,
      delta: step.delta,
    },
    changes: step.changes,
    dependencies: step.dependencies,
  };
}

function printExplanation(step: VerifiedFix): void {
  console.log(`Repair: ${step.id}`);
  console.log(`  Fix: ${step.fixName}`);
  console.log(`  Description: ${step.fixDescription}`);
  console.log(`  Risk: ${step.risk}`);
  console.log();
  console.log(`Target Diagnostic:`);
  console.log(`  ${step.diagnostic.file}:${step.diagnostic.line}:${step.diagnostic.column}`);
  console.log(`  TS${step.diagnostic.code}: ${step.diagnostic.message}`);
  console.log();
  console.log(`Verification:`);
  console.log(`  Errors before: ${step.errorsBefore}`);
  console.log(`  Errors after: ${step.errorsAfter}`);
  console.log(`  Delta: ${step.delta > 0 ? "+" : ""}${step.delta}`);
  console.log();
  console.log(`Dependencies:`);
  console.log(`  Conflicts with: ${step.dependencies.conflictsWith.join(", ") || "(none)"}`);
  console.log(`  Requires: ${step.dependencies.requires.join(", ") || "(none)"}`);
  if (step.dependencies.exclusiveGroup) {
    console.log(`  Exclusive group: ${step.dependencies.exclusiveGroup}`);
  }
  console.log();
  console.log(`Changes:`);
  for (const change of step.changes) {
    console.log(`  ${change.file}:`);
    console.log(`    Replace [${change.start}:${change.end}] with:`);
    const preview = change.newText.length > 60 ? change.newText.slice(0, 60) + "..." : change.newText;
    console.log(`    "${preview.replace(/\n/g, "\\n")}"`);
  }
}

// ============================================================================
// repair Command (new - replaces runPlan with optional apply)
// ============================================================================

interface RepairOptions {
  json: boolean;
  compact: boolean;
  apply: boolean;
  includeHighRisk: boolean;
  trace: boolean;
  maxVerifications?: number;
  maxCandidatesPerIteration?: number;
  scoringStrategy: ScoringStrategy;
}

function parseRepairOptions(args: string[]): { options: RepairOptions; project: string } {
  const options: RepairOptions = {
    json: false,
    compact: false,
    apply: false,
    includeHighRisk: false,
    trace: false,
    scoringStrategy: "delta",
  };

  let project = "./tsconfig.json";
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--compact") {
      options.compact = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--include-high-risk") {
      options.includeHighRisk = true;
    } else if (arg === "--trace") {
      options.trace = true;
    } else if (arg === "--max-verifications" && i + 1 < args.length) {
      options.maxVerifications = parseInt(args[++i], 10);
    } else if (arg === "--max-candidates-per-iteration" && i + 1 < args.length) {
      options.maxCandidatesPerIteration = parseInt(args[++i], 10);
    } else if (arg === "--scoring-strategy" && i + 1 < args.length) {
      const strategy = args[++i];
      if (strategy !== "delta" && strategy !== "weighted") {
        console.error(`Error: --scoring-strategy must be 'delta' or 'weighted', got '${strategy}'`);
        process.exit(EXIT_ERROR);
      }
      options.scoringStrategy = strategy as ScoringStrategy;
    } else if (arg.startsWith("--scoring-strategy=")) {
      const strategy = arg.slice("--scoring-strategy=".length);
      if (strategy !== "delta" && strategy !== "weighted") {
        console.error(`Error: --scoring-strategy must be 'delta' or 'weighted', got '${strategy}'`);
        process.exit(EXIT_ERROR);
      }
      options.scoringStrategy = strategy as ScoringStrategy;
    } else if (!arg.startsWith("-")) {
      project = arg;
    }

    i++;
  }

  return { options, project };
}

function runRepair(global: GlobalOptions, args: string[]): void {
  const startTime = Date.now();

  // Parse repair-specific options
  const { options, project: projectArg } = parseRepairOptions(args);

  // Use global project if not overridden
  const projectPath = path.resolve(projectArg !== "./tsconfig.json" ? projectArg : global.project);

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: File not found: ${projectPath}`);
    process.exit(EXIT_ERROR);
  }

  // Create logger if tracing
  const logger = options.trace ? createBudgetLogger() : undefined;

  try {
    const plan = repair(
      {
        project: projectPath,
        includeHighRisk: options.includeHighRisk,
        maxVerifications: options.maxVerifications,
        maxCandidatesPerIteration: options.maxCandidatesPerIteration,
        scoringStrategy: options.scoringStrategy,
        onProgress: global.verbose ? (msg) => console.error(msg) : undefined,
      },
      logger
    );

    // If --apply, apply the fixes to disk
    if (options.apply) {
      const stepsToApply = options.includeHighRisk
        ? plan.steps
        : plan.steps.filter((s) => s.risk === "low" || s.risk === "medium");

      if (stepsToApply.length > 0) {
        applyChangesToDisk(stepsToApply);
        if (global.verbose) {
          console.error(`Applied ${stepsToApply.length} repairs`);
        }
      }
    }

    // Format output
    if (options.trace) {
      // Output trace log as JSON
      const traceOutput = {
        plan: JSON.parse(formatPlanJSON(plan)),
        trace: {
          events: logger!.getEvents(),
          summary: logger!.getSummary(),
        },
      };
      console.log(JSON.stringify(traceOutput, null, 2));
    } else if (options.json || global.format === "json") {
      console.log(formatPlanJSON(plan));
    } else if (options.compact) {
      console.log(formatPlanCompact(plan));
    } else {
      console.log(formatPlanText(plan));
    }

    const duration = Date.now() - startTime;
    if (global.verbose) {
      console.error(`\nCompleted in ${duration}ms`);
    }

    // Exit with error code if there are remaining errors
    if (plan.summary.finalErrors > 0) {
      process.exit(EXIT_DIAGNOSTICS);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(EXIT_ERROR);
  }
}

// ============================================================================
// preview Command (new)
// ============================================================================

interface PreviewOptions {
  json: boolean;
  includeHighRisk: boolean;
}

function parsePreviewOptions(args: string[]): { options: PreviewOptions; project: string } {
  const options: PreviewOptions = {
    json: false,
    includeHighRisk: false,
  };

  let project = "./tsconfig.json";
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--include-high-risk") {
      options.includeHighRisk = true;
    } else if (!arg.startsWith("-")) {
      project = arg;
    }

    i++;
  }

  return { options, project };
}

function runPreview(global: GlobalOptions, args: string[]): void {
  // Parse preview-specific options
  const { options, project: projectArg } = parsePreviewOptions(args);

  // Use global project if not overridden
  const projectPath = path.resolve(projectArg !== "./tsconfig.json" ? projectArg : global.project);

  if (!fs.existsSync(projectPath)) {
    console.error(`Error: File not found: ${projectPath}`);
    process.exit(EXIT_ERROR);
  }

  try {
    const preview = previewBudgetImpact(projectPath, {
      includeHighRisk: options.includeHighRisk,
    });

    if (options.json || global.format === "json") {
      console.log(formatPreviewJSON(preview));
    } else {
      console.log(formatPreviewText(preview));
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(EXIT_ERROR);
  }
}

// ============================================================================
// mcp-server Command
// ============================================================================

function runMcpServerCommand(): void {
  // Run the MCP server - this function never returns (runs until killed)
  runMcpServer().catch((e) => {
    console.error(`MCP server error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(EXIT_ERROR);
  });
}

// ============================================================================
// Helpers
// ============================================================================

function runTypeCheck(projectPath: string): ts.Diagnostic[] {
  const host = createTypeScriptHost(projectPath);
  return host.getDiagnostics();
}

function applyChangesToDisk(steps: VerifiedFix[]): void {
  // Group changes by file
  const changesByFile = new Map<string, FileChange[]>();

  for (const step of steps) {
    for (const change of step.changes) {
      const existing = changesByFile.get(change.file) ?? [];
      existing.push(change);
      changesByFile.set(change.file, existing);
    }
  }

  // Apply changes to each file (in reverse order to preserve positions)
  for (const [filePath, changes] of changesByFile) {
    let content = fs.readFileSync(filePath, "utf-8");

    // Sort changes by start position descending (apply from end to preserve positions)
    const sortedChanges = [...changes].sort((a, b) => b.start - a.start);

    for (const change of sortedChanges) {
      content = content.slice(0, change.start) + change.newText + content.slice(change.end);
    }

    fs.writeFileSync(filePath, content, "utf-8");
  }
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`
ts-repair - Oracle-Guided TypeScript Repair Engine

Usage:
  ts-repair <command> [options]

Commands:
  tsc [--plan] [--auto] -- [tsc args]   Run tsc with optional repair features
  check                                  Run tsc --noEmit
  plan                                   Generate a verified repair plan
  apply                                  Apply repairs to files
  explain --id <id>                      Explain a repair candidate
  repair                                 Generate plan with optional apply (new)
  preview                                Preview budget impact (new)
  mcp-server                             Run MCP server for agent integration
  help                                   Show this help message
  version                                Show version information

Global Options:
  -p, --project <path>     Path to tsconfig.json (default: ./tsconfig.json)
  --format <text|json>     Output format (default depends on command)
  --verbose                Emit debug and budget information

Command: tsc
  ts-repair tsc -- [tsc args]
  ts-repair tsc --plan -- --noEmit      # Also emit repair plan
  ts-repair tsc --auto -- --noEmit      # Apply AutoFixable repairs first

Command: plan
  ts-repair plan                         # Output to stdout (JSON)
  ts-repair plan --format text           # Output as text
  ts-repair plan --out plan.json         # Write to file
  ts-repair plan --max-verifications 50  # Limit budget
  ts-repair plan --scoring-strategy weighted  # Use weighted scoring

  Options:
    --out <file>                Write plan to file
    --max-candidates <n>        Max candidates per iteration (default: 20)
    --max-per-diagnostic <n>    Max candidates per diagnostic (default: 3)
    --max-verifications <n>     Max speculative typecheck runs (default: 200)
    --scoring-strategy <s>      Scoring strategy: delta (default) or weighted

Command: apply
  ts-repair apply --auto                 # Apply AutoFixable repairs
  ts-repair apply --plan plan.json       # Apply from saved plan
  ts-repair apply --plan plan.json --ids r1,r4  # Apply specific IDs

  Options:
    --plan <file>              Plan file to apply
    --auto                     Generate and apply AutoFixable repairs
    --allow-high-risk          Include AutoFixableHighRisk repairs
    --ids <list>               Comma-separated repair IDs
    --scoring-strategy <s>     Scoring strategy: delta (default) or weighted

Command: explain
  ts-repair explain --id fix-0           # Explain specific repair

  Options:
    --id <id>                  Repair ID to explain (required)

Command: repair
  ts-repair repair                       # Generate repair plan
  ts-repair repair ./tsconfig.json       # Specific project
  ts-repair repair --json                # Output as JSON
  ts-repair repair --apply               # Apply fixes after generating plan
  ts-repair repair --scoring-strategy weighted  # Use weighted scoring

  Options:
    --json                          Output as JSON
    --compact                       Output compact JSON (for agents)
    --apply                         Apply fixes to files
    --include-high-risk             Include high-risk fixes
    --trace                         Output budget event log as JSON
    --max-verifications N           Maximum total verifications (default: 500)
    --max-candidates-per-iteration N  Max candidates per iteration (default: 100)
    --scoring-strategy <s>          Scoring strategy: delta (default) or weighted

Command: preview
  ts-repair preview ./tsconfig.json      # Preview budget impact

  Options:
    --json                     Output as JSON
    --include-high-risk        Include high-risk candidates in estimate

Command: mcp-server
  ts-repair mcp-server                   # Start MCP server for agent integration

  Runs a Model Context Protocol (MCP) server over stdio. This enables
  integration with AI coding assistants like Claude Code, OpenCode, and Codex.

  Tools exposed:
    ts_repair_plan   Generate a verified repair plan
    ts_repair_apply  Apply verified repairs to files
    ts_repair_check  Quick error count check

Exit Codes:
  0  No remaining diagnostics / successful operation
  1  Diagnostics remain
  2  Tool or configuration error

Examples:
  ts-repair check                        # Type check project
  ts-repair plan --format json           # Generate repair plan
  ts-repair apply --auto                 # Apply safe repairs
  ts-repair tsc --auto -- --noEmit       # Fix then check
  ts-repair repair --apply               # Generate plan and apply fixes
  ts-repair repair --scoring-strategy weighted  # Use weighted scoring
`);
}

function showVersion(): void {
  try {
    const pkgPath = path.join(import.meta.dirname ?? ".", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    console.log(`ts-repair version ${pkg.version}`);
  } catch {
    console.log("ts-repair version 0.2.0");
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(EXIT_SUCCESS);
  }

  // Extract command
  const command = args[0];
  const commandArgs = args.slice(1);

  // Parse global options from remaining args
  const { options: global, remaining } = parseGlobalOptions(commandArgs);

  switch (command) {
    case "tsc":
      runTsc(global, remaining);
      break;
    case "check":
      runCheck(global, remaining);
      break;
    case "plan":
      runPlan(global, remaining);
      break;
    case "apply":
      runApply(global, remaining);
      break;
    case "explain":
      runExplain(global, remaining);
      break;
    case "repair":
      runRepair(global, remaining);
      break;
    case "preview":
      runPreview(global, remaining);
      break;
    case "mcp-server":
      runMcpServerCommand();
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      process.exit(EXIT_SUCCESS);
      break;
    case "version":
    case "--version":
    case "-v":
      showVersion();
      process.exit(EXIT_SUCCESS);
      break;
    default:
      console.error(`Error: Unknown command '${command}'`);
      console.error("Run 'ts-repair help' for usage information");
      process.exit(EXIT_ERROR);
  }
}

main();
