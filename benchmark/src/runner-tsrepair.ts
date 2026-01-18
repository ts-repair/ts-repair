/**
 * ts-repair runner - uses ts-repair to pre-process errors before LLM
 *
 * This runner uses ts-repair to:
 * 1. Generate a verified repair plan
 * 2. Apply auto-fixes immediately (no LLM needed)
 * 3. Only send remaining judgment-required errors to Claude
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  BenchmarkConfig,
  ClaudeClient,
  MangleRecord,
  RoundMetrics,
  RunResult,
} from './types.js';
import { runTsc } from './tsc.js';
import { countTokens } from './token-counter.js';
import { applyFixes } from './runner-vanilla.js';

/**
 * Result from running ts-repair
 */
interface TsRepairPlan {
  summary: {
    initialErrors: number;
    finalErrors: number;
    fixedCount: number;
    remainingCount: number;
  };
  steps: TsRepairFix[];
  remaining: TsRepairDiagnostic[];
}

interface TsRepairFix {
  id: string;
  fixName: string;
  fixDescription: string;
  risk: 'low' | 'medium' | 'high';
  diagnostic: {
    code: number;
    message: string;
    file: string;
    line: number;
  };
  changes: Array<{
    file: string;
    start: number;
    end: number;
    newText: string;
  }>;
}

interface TsRepairDiagnostic {
  code: number;
  message: string;
  file: string;
  line: number;
  column: number;
  disposition: string;
  candidates?: Array<{
    fixName: string;
    description: string;
    delta: number;
    risk: string;
  }>;
}

/**
 * Run ts-repair and get the repair plan
 */
export function runTsRepair(
  projectPath: string,
  tsconfigPath: string,
  includeHighRisk: boolean = false
): TsRepairPlan {
  const fullTsconfigPath = path.resolve(projectPath, tsconfigPath);
  const args = ['ts-repair', 'plan', '--project', fullTsconfigPath, '--format', 'json'];

  if (includeHighRisk) {
    args.push('--include-high-risk');
  }

  try {
    const output = execSync(`npx ${args.join(' ')}`, {
      cwd: projectPath,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return JSON.parse(output) as TsRepairPlan;
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    const stdout = execError.stdout ?? '';

    // ts-repair may exit with code 1 if there are remaining errors
    // but still output a valid plan
    try {
      return JSON.parse(stdout) as TsRepairPlan;
    } catch {
      // If parsing fails, return empty plan
      return {
        summary: { initialErrors: 0, finalErrors: 0, fixedCount: 0, remainingCount: 0 },
        steps: [],
        remaining: [],
      };
    }
  }
}

/**
 * Apply ts-repair fixes to disk
 */
export function applyTsRepairFixes(
  fixes: TsRepairFix[],
  projectPath: string
): string[] {
  const modifiedFiles: string[] = [];

  // Group changes by file
  const changesByFile = new Map<string, TsRepairFix['changes']>();
  for (const fix of fixes) {
    for (const change of fix.changes) {
      const existing = changesByFile.get(change.file);
      if (existing) {
        existing.push(change);
      } else {
        changesByFile.set(change.file, [change]);
      }
    }
  }

  // Apply changes to each file
  for (const [file, changes] of changesByFile) {
    const fullPath = path.resolve(projectPath, file);
    try {
      let content = fs.readFileSync(fullPath, 'utf-8');

      // Sort changes by start position descending to avoid position shifts
      changes.sort((a, b) => b.start - a.start);

      for (const change of changes) {
        content =
          content.slice(0, change.start) +
          change.newText +
          content.slice(change.end);
      }

      fs.writeFileSync(fullPath, content, 'utf-8');
      modifiedFiles.push(file);
    } catch {
      // File may not exist or be writable
    }
  }

  return modifiedFiles;
}

/**
 * Build a prompt with only remaining judgment-required errors
 */
export function buildTsRepairPrompt(
  plan: TsRepairPlan,
  projectPath: string
): string {
  let prompt = `ts-repair has auto-fixed ${plan.summary.fixedCount} errors.\n\n`;
  prompt += `The following ${plan.remaining.length} errors require your judgment:\n\n`;

  // Add remaining diagnostics with context
  for (const d of plan.remaining) {
    prompt += `${d.file}(${d.line},${d.column}): error TS${d.code}: ${d.message}\n`;

    // Include candidate information if available
    if (d.candidates && d.candidates.length > 0) {
      prompt += `  Candidate fixes:\n`;
      for (const c of d.candidates) {
        prompt += `    - ${c.fixName}: ${c.description} (delta: ${c.delta}, risk: ${c.risk})\n`;
      }
    }

    prompt += `  Disposition: ${d.disposition}\n\n`;
  }

  // Only include files with remaining errors
  const relevantFiles = [...new Set(plan.remaining.map((d) => d.file))];
  for (const file of relevantFiles) {
    const fullPath = path.resolve(projectPath, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      prompt += `--- ${file} ---\n${content}\n\n`;
    } catch {
      prompt += `--- ${file} ---\n(Unable to read file)\n\n`;
    }
  }

  prompt += `Provide fixes as JSON array: [{ "file": "path", "line": N, "original": "text to find", "replacement": "new text" }]\n`;
  prompt += `Consider the candidate fixes suggested by ts-repair when making your decisions.\n`;

  return prompt;
}

/**
 * Sum an array of numbers
 */
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * Run the ts-repair benchmark
 */
export async function runTsRepairBenchmark(
  config: BenchmarkConfig,
  projectPath: string,
  claudeClient: ClaudeClient,
  mangles: MangleRecord[]
): Promise<RunResult> {
  const rounds: RoundMetrics[] = [];
  let diagnostics = runTsc(projectPath, config.tsconfigPath).diagnostics;
  const initialCount = diagnostics.length;
  let totalAutoFixed = 0;
  let totalPuntedToLlm = 0;

  while (diagnostics.length > 0 && rounds.length < config.maxRounds) {
    const roundStart = Date.now();

    // Run ts-repair to get verified plan
    const plan = runTsRepair(projectPath, config.tsconfigPath);

    // Apply auto-fixes immediately (no LLM needed)
    const autoFixFiles = applyTsRepairFixes(plan.steps, projectPath);
    totalAutoFixed += plan.summary.fixedCount;

    // If judgment-required errors remain, call Claude
    let promptTokens = 0;
    let completionTokens = 0;
    let llmFixedFiles: string[] = [];

    if (plan.remaining.length > 0) {
      totalPuntedToLlm += plan.remaining.length;

      // Build prompt with ONLY judgment-required errors
      const prompt = buildTsRepairPrompt(plan, projectPath);

      const response = await claudeClient.complete(prompt);
      promptTokens = response.usage.prompt_tokens;
      completionTokens = response.usage.completion_tokens;

      llmFixedFiles = applyFixes(response.fixes, projectPath);
    }

    const newDiagnostics = runTsc(projectPath, config.tsconfigPath).diagnostics;

    rounds.push({
      roundNumber: rounds.length + 1,
      diagnosticsAtStart: diagnostics,
      diagnosticsAtEnd: newDiagnostics,
      promptTokens,
      completionTokens,
      filesModified: [...new Set([...autoFixFiles, ...llmFixedFiles])],
      wallTimeMs: Date.now() - roundStart,
      autoFixedCount: plan.summary.fixedCount,
      puntedToLlmCount: plan.remaining.length,
    });

    // Check for progress
    if (newDiagnostics.length >= diagnostics.length) {
      if (rounds.length >= 3) {
        const lastThree = rounds.slice(-3);
        const noProgress = lastThree.every(
          (r) => r.diagnosticsAtEnd.length >= r.diagnosticsAtStart.length
        );
        if (noProgress) {
          break;
        }
      }
    }

    diagnostics = newDiagnostics;
  }

  return {
    approach: 'ts-repair',
    config,
    mangles,
    initialDiagnosticCount: initialCount,
    finalDiagnosticCount: diagnostics.length,
    rounds,
    totalPromptTokens: sum(rounds.map((r) => r.promptTokens)),
    totalCompletionTokens: sum(rounds.map((r) => r.completionTokens)),
    totalTokens: sum(rounds.map((r) => r.promptTokens + r.completionTokens)),
    totalWallTimeMs: sum(rounds.map((r) => r.wallTimeMs)),
    success: diagnostics.length === 0,
    autoFixed: totalAutoFixed,
    puntedToLlm: totalPuntedToLlm,
  };
}

/**
 * Estimate tokens for ts-repair approach without calling Claude
 * Used for quick comparisons and testing
 */
export function estimateTsRepairTokens(
  projectPath: string,
  tsconfigPath: string,
  maxRounds: number = 10
): {
  estimatedRounds: number;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedAutoFixed: number;
  estimatedPuntedToLlm: number;
} {
  // Run ts-repair once to get initial plan
  const plan = runTsRepair(projectPath, tsconfigPath);

  if (plan.summary.initialErrors === 0) {
    return {
      estimatedRounds: 0,
      estimatedPromptTokens: 0,
      estimatedCompletionTokens: 0,
      estimatedAutoFixed: 0,
      estimatedPuntedToLlm: 0,
    };
  }

  // Build prompt to measure token usage
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let rounds = 0;
  let remaining = plan.remaining.length;
  let autoFixed = plan.summary.fixedCount;
  let puntedToLlm = plan.remaining.length;

  // If there are remaining errors, estimate LLM rounds
  if (remaining > 0) {
    const prompt = buildTsRepairPrompt(plan, projectPath);
    const promptTokens = countTokens(prompt);

    const avgFixRate = 0.5;

    while (remaining > 0 && rounds < maxRounds) {
      // Prompt tokens scale with remaining errors
      const roundPromptTokens = Math.round(
        promptTokens * (remaining / plan.remaining.length)
      );
      totalPromptTokens += roundPromptTokens;

      // Completion tokens: ~50 tokens per fix
      const fixesThisRound = Math.ceil(remaining * avgFixRate);
      totalCompletionTokens += fixesThisRound * 50;

      remaining -= fixesThisRound;
      rounds++;
    }
  }

  return {
    estimatedRounds: rounds,
    estimatedPromptTokens: totalPromptTokens,
    estimatedCompletionTokens: totalCompletionTokens,
    estimatedAutoFixed: autoFixed,
    estimatedPuntedToLlm: puntedToLlm,
  };
}

/**
 * Run ts-repair apply command to apply fixes directly
 */
export function runTsRepairApply(
  projectPath: string,
  tsconfigPath: string,
  autoOnly: boolean = true
): { success: boolean; fixedCount: number } {
  const fullTsconfigPath = path.resolve(projectPath, tsconfigPath);
  const args = ['ts-repair', 'apply', '--project', fullTsconfigPath];

  if (autoOnly) {
    args.push('--auto');
  }

  try {
    execSync(`npx ${args.join(' ')}`, {
      cwd: projectPath,
      stdio: 'pipe',
    });

    // Get count from running plan again
    const plan = runTsRepair(projectPath, tsconfigPath);
    return {
      success: true,
      fixedCount: plan.summary.fixedCount,
    };
  } catch {
    return {
      success: false,
      fixedCount: 0,
    };
  }
}
