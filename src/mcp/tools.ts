/**
 * MCP Tool Definitions
 *
 * Defines the tools exposed by the ts-repair MCP server.
 */

import { z } from "zod";

// ============================================================================
// Tool Schemas
// ============================================================================

/**
 * Schema for ts_repair_plan tool input
 */
export const PlanInputSchema = z.object({
  tsconfig: z
    .string()
    .default("./tsconfig.json")
    .describe("Path to tsconfig.json"),
  maxVerifications: z
    .number()
    .optional()
    .describe("Maximum verification budget (default: 500)"),
  includeHighRisk: z
    .boolean()
    .optional()
    .describe("Include high-risk fixes in the plan (default: false)"),
});

export type PlanInput = z.infer<typeof PlanInputSchema>;

/**
 * Schema for ts_repair_apply tool input
 */
export const ApplyInputSchema = z.object({
  tsconfig: z
    .string()
    .default("./tsconfig.json")
    .describe("Path to tsconfig.json"),
  filter: z
    .enum(["all", "low-risk"])
    .default("low-risk")
    .describe("Filter for which fixes to apply: 'all' or 'low-risk' (default)"),
});

export type ApplyInput = z.infer<typeof ApplyInputSchema>;

/**
 * Schema for ts_repair_check tool input
 */
export const CheckInputSchema = z.object({
  tsconfig: z
    .string()
    .default("./tsconfig.json")
    .describe("Path to tsconfig.json"),
});

export type CheckInput = z.infer<typeof CheckInputSchema>;

// ============================================================================
// Tool Definitions
// ============================================================================

export const TOOLS = {
  ts_repair_plan: {
    name: "ts_repair_plan",
    description:
      "Generate a verified TypeScript repair plan. Returns fixes proven to reduce errors. " +
      "Use this when you encounter TypeScript compilation errors and want to see what fixes are available.",
    inputSchema: PlanInputSchema,
  },
  ts_repair_apply: {
    name: "ts_repair_apply",
    description:
      "Apply verified TypeScript repairs to files. Only applies fixes proven to reduce errors. " +
      "By default only applies low-risk fixes (imports, async/await). Use filter='all' to include high-risk fixes.",
    inputSchema: ApplyInputSchema,
  },
  ts_repair_check: {
    name: "ts_repair_check",
    description:
      "Quick check for TypeScript error count without generating a full repair plan. " +
      "Use this to quickly see how many type errors exist in a project.",
    inputSchema: CheckInputSchema,
  },
} as const;

// ============================================================================
// Tool Input Type Extraction
// ============================================================================

export type ToolName = keyof typeof TOOLS;
