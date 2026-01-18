/**
 * MCP Server for ts-repair
 *
 * Exposes ts-repair functionality via Model Context Protocol (MCP).
 * This server can be used with Claude Code, OpenCode, Codex CLI, and other
 * MCP-compatible agents.
 *
 * Usage:
 *   ts-repair mcp-server
 *
 * The server communicates over stdio using JSON-RPC.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { repair } from "../oracle/planner.js";
import { createTypeScriptHost } from "../oracle/typescript.js";
import type { RepairPlan, VerifiedFix, FileChange } from "../output/types.js";
import {
  TOOLS,
  PlanInputSchema,
  ApplyInputSchema,
  CheckInputSchema,
  type PlanInput,
  type ApplyInput,
  type CheckInput,
} from "./tools.js";
import path from "path";
import fs from "fs";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve tsconfig path relative to current working directory
 */
function resolveTsconfig(tsconfig: string): string {
  return path.resolve(process.cwd(), tsconfig);
}

/**
 * Validate that a tsconfig file exists
 */
function validateTsconfig(tsconfig: string): void {
  const resolved = resolveTsconfig(tsconfig);
  if (!fs.existsSync(resolved)) {
    throw new Error(`tsconfig.json not found: ${resolved}`);
  }
}

/**
 * Apply verified fixes to disk
 */
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
// Tool Handlers
// ============================================================================

/**
 * Handle ts_repair_plan tool
 */
async function handlePlan(input: PlanInput): Promise<RepairPlan> {
  const tsconfig = resolveTsconfig(input.tsconfig);
  validateTsconfig(tsconfig);

  const plan = repair({
    project: tsconfig,
    maxVerifications: input.maxVerifications,
    includeHighRisk: input.includeHighRisk ?? false,
  });

  return plan;
}

/**
 * Handle ts_repair_apply tool
 */
async function handleApply(
  input: ApplyInput
): Promise<{ applied: number; remaining: number; appliedIds: string[] }> {
  const tsconfig = resolveTsconfig(input.tsconfig);
  validateTsconfig(tsconfig);

  // Generate a plan first
  const plan = repair({
    project: tsconfig,
    includeHighRisk: input.filter === "all",
  });

  // Filter steps based on risk
  const toApply =
    input.filter === "low-risk"
      ? plan.steps.filter((s) => s.risk === "low" || s.risk === "medium")
      : plan.steps;

  if (toApply.length > 0) {
    applyChangesToDisk(toApply);
  }

  // Re-check to get final error count
  const host = createTypeScriptHost(tsconfig);
  const finalDiagnostics = host.getDiagnostics();

  return {
    applied: toApply.length,
    remaining: finalDiagnostics.length,
    appliedIds: toApply.map((s) => s.id),
  };
}

/**
 * Handle ts_repair_check tool
 */
async function handleCheck(input: CheckInput): Promise<{ errorCount: number }> {
  const tsconfig = resolveTsconfig(input.tsconfig);
  validateTsconfig(tsconfig);

  const host = createTypeScriptHost(tsconfig);
  const diagnostics = host.getDiagnostics();

  return { errorCount: diagnostics.length };
}

// ============================================================================
// Server Setup
// ============================================================================

/**
 * Create and configure the MCP server
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ts-repair",
    version: "0.2.0",
  });

  // Register ts_repair_plan tool
  server.tool(
    TOOLS.ts_repair_plan.name,
    TOOLS.ts_repair_plan.description,
    TOOLS.ts_repair_plan.inputSchema.shape,
    async (args) => {
      try {
        const input = PlanInputSchema.parse(args);
        const plan = await handlePlan(input);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(plan, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register ts_repair_apply tool
  server.tool(
    TOOLS.ts_repair_apply.name,
    TOOLS.ts_repair_apply.description,
    TOOLS.ts_repair_apply.inputSchema.shape,
    async (args) => {
      try {
        const input = ApplyInputSchema.parse(args);
        const result = await handleApply(input);
        return {
          content: [
            {
              type: "text" as const,
              text: `Applied ${result.applied} fixes. ${result.remaining} diagnostics remain.${
                result.appliedIds.length > 0
                  ? `\n\nApplied: ${result.appliedIds.join(", ")}`
                  : ""
              }`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register ts_repair_check tool
  server.tool(
    TOOLS.ts_repair_check.name,
    TOOLS.ts_repair_check.description,
    TOOLS.ts_repair_check.inputSchema.shape,
    async (args) => {
      try {
        const input = CheckInputSchema.parse(args);
        const result = await handleCheck(input);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Run the MCP server over stdio
 */
export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
