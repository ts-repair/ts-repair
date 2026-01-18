/**
 * Vanilla TSC runner - simulates the standard Claude + tsc loop
 *
 * This runner presents all TypeScript errors to Claude and asks it to fix them,
 * iterating until all errors are resolved or max rounds is reached.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  BenchmarkConfig,
  ClaudeClient,
  Diagnostic,
  Fix,
  MangleRecord,
  RoundMetrics,
  RunResult,
} from './types.js';
import { runTsc, formatDiagnostics, getUniqueFiles } from './tsc.js';
import { countTokens } from './token-counter.js';

/**
 * Build a prompt with all diagnostics and relevant file contents
 */
export function buildVanillaPrompt(
  diagnostics: Diagnostic[],
  projectPath: string
): string {
  let prompt = `Fix the following TypeScript errors:\n\n`;

  // Add all diagnostics
  prompt += formatDiagnostics(diagnostics);
  prompt += '\n\n';

  // Add relevant file contents (files with errors)
  const relevantFiles = getUniqueFiles(diagnostics);
  for (const file of relevantFiles) {
    const fullPath = path.resolve(projectPath, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      prompt += `--- ${file} ---\n${content}\n\n`;
    } catch {
      // File may not exist or be readable
      prompt += `--- ${file} ---\n(Unable to read file)\n\n`;
    }
  }

  prompt += `Provide fixes as JSON array: [{ "file": "path", "line": N, "original": "text to find", "replacement": "new text" }]\n`;
  prompt += `Only include fixes you are confident about. The "original" field should be the exact text to replace.\n`;

  return prompt;
}

/**
 * Apply fixes to files on disk
 */
export function applyFixes(fixes: Fix[], projectPath: string): string[] {
  const modifiedFiles: string[] = [];

  // Group fixes by file
  const byFile = new Map<string, Fix[]>();
  for (const fix of fixes) {
    const existing = byFile.get(fix.file);
    if (existing) {
      existing.push(fix);
    } else {
      byFile.set(fix.file, [fix]);
    }
  }

  // Apply fixes to each file
  for (const [file, fileFixes] of byFile) {
    const fullPath = path.resolve(projectPath, file);
    try {
      let content = fs.readFileSync(fullPath, 'utf-8');
      let modified = false;

      // Sort fixes by line number descending to avoid position shifts
      fileFixes.sort((a, b) => b.line - a.line);

      for (const fix of fileFixes) {
        const originalIndex = content.indexOf(fix.original);
        if (originalIndex !== -1) {
          content =
            content.slice(0, originalIndex) +
            fix.replacement +
            content.slice(originalIndex + fix.original.length);
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(fullPath, content, 'utf-8');
        modifiedFiles.push(file);
      }
    } catch {
      // File may not exist or be writable
    }
  }

  return modifiedFiles;
}

/**
 * Sum an array of numbers
 */
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * Run the vanilla benchmark (standard Claude + tsc loop)
 */
export async function runVanillaBenchmark(
  config: BenchmarkConfig,
  projectPath: string,
  claudeClient: ClaudeClient,
  mangles: MangleRecord[]
): Promise<RunResult> {
  const rounds: RoundMetrics[] = [];
  let diagnostics = runTsc(projectPath, config.tsconfigPath).diagnostics;
  const initialCount = diagnostics.length;

  while (diagnostics.length > 0 && rounds.length < config.maxRounds) {
    const roundStart = Date.now();

    // Build prompt with ALL diagnostics + relevant file contents
    const prompt = buildVanillaPrompt(diagnostics, projectPath);

    // Call Claude
    const response = await claudeClient.complete(prompt);

    // Apply Claude's suggested fixes
    const filesModified = applyFixes(response.fixes, projectPath);

    // Re-run tsc
    const newDiagnostics = runTsc(projectPath, config.tsconfigPath).diagnostics;

    rounds.push({
      roundNumber: rounds.length + 1,
      diagnosticsAtStart: diagnostics,
      diagnosticsAtEnd: newDiagnostics,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      filesModified,
      wallTimeMs: Date.now() - roundStart,
    });

    // Check for progress
    if (newDiagnostics.length >= diagnostics.length) {
      // No progress made, might be stuck
      if (rounds.length >= 3) {
        // If we've tried 3 times with no progress, break
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
    approach: 'vanilla',
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
  };
}

/**
 * Estimate tokens for vanilla approach without calling Claude
 * Used for quick comparisons and testing
 */
export function estimateVanillaTokens(
  projectPath: string,
  tsconfigPath: string,
  maxRounds: number = 10
): {
  estimatedRounds: number;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
} {
  const diagnostics = runTsc(projectPath, tsconfigPath).diagnostics;

  if (diagnostics.length === 0) {
    return {
      estimatedRounds: 0,
      estimatedPromptTokens: 0,
      estimatedCompletionTokens: 0,
    };
  }

  // Build initial prompt to measure
  const prompt = buildVanillaPrompt(diagnostics, projectPath);
  const promptTokens = countTokens(prompt);

  // Estimate rounds based on typical fix rate (40-60% per round)
  const avgFixRate = 0.5;
  let remaining = diagnostics.length;
  let rounds = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  while (remaining > 0 && rounds < maxRounds) {
    // Prompt tokens scale roughly with remaining errors
    const roundPromptTokens = Math.round(
      promptTokens * (remaining / diagnostics.length)
    );
    totalPromptTokens += roundPromptTokens;

    // Completion tokens: ~50 tokens per fix
    const fixesThisRound = Math.ceil(remaining * avgFixRate);
    totalCompletionTokens += fixesThisRound * 50;

    remaining -= fixesThisRound;
    rounds++;
  }

  return {
    estimatedRounds: rounds,
    estimatedPromptTokens: totalPromptTokens,
    estimatedCompletionTokens: totalCompletionTokens,
  };
}
