/**
 * TypeScript compiler wrapper for running tsc and parsing diagnostics
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import type { Diagnostic, TscResult, ErrorCategory } from './types.js';
import { ERROR_CODE_CATEGORIES } from './types.js';

/**
 * Run tsc --noEmit and return structured diagnostics
 */
export function runTsc(projectPath: string, tsconfigPath: string): TscResult {
  const startTime = Date.now();
  const fullTsconfigPath = path.resolve(projectPath, tsconfigPath);

  try {
    execSync(`npx tsc --noEmit --project "${fullTsconfigPath}"`, {
      cwd: projectPath,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return {
      success: true,
      diagnostics: [],
      wallTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    const stdout = execError.stdout ?? '';
    const stderr = execError.stderr ?? '';
    const output = stdout + stderr;

    const diagnostics = parseTscOutput(output, projectPath);

    return {
      success: diagnostics.length === 0,
      diagnostics,
      wallTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Parse tsc output into structured diagnostics
 * Format: file(line,col): error TS1234: message
 */
export function parseTscOutput(output: string, projectPath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');

  // Pattern: path/to/file.ts(line,col): error TS1234: message
  const pattern = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      const [, file, lineNum, colNum, code, message] = match;
      if (file && lineNum && colNum && code && message) {
        const errorCode = parseInt(code, 10);
        diagnostics.push({
          code: errorCode,
          message: message.trim(),
          file: normalizeFilePath(file, projectPath),
          line: parseInt(lineNum, 10),
          column: parseInt(colNum, 10),
          category: categorizeError(errorCode),
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Normalize file path to be relative to project root
 */
function normalizeFilePath(filePath: string, projectPath: string): string {
  const absolutePath = path.resolve(projectPath, filePath);
  return path.relative(projectPath, absolutePath);
}

/**
 * Categorize an error by its code
 */
function categorizeError(code: number): ErrorCategory {
  return ERROR_CODE_CATEGORIES[code] ?? 'mechanical';
}

/**
 * Get diagnostic counts by category
 */
export function countByCategory(diagnostics: Diagnostic[]): Record<ErrorCategory, number> {
  const counts: Record<ErrorCategory, number> = {
    cascade: 0,
    mechanical: 0,
    judgment: 0,
  };

  for (const d of diagnostics) {
    counts[d.category]++;
  }

  return counts;
}

/**
 * Group diagnostics by file
 */
export function groupByFile(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
  const groups = new Map<string, Diagnostic[]>();

  for (const d of diagnostics) {
    const existing = groups.get(d.file);
    if (existing) {
      existing.push(d);
    } else {
      groups.set(d.file, [d]);
    }
  }

  return groups;
}

/**
 * Get unique files from diagnostics
 */
export function getUniqueFiles(diagnostics: Diagnostic[]): string[] {
  return [...new Set(diagnostics.map((d) => d.file))];
}

/**
 * Format diagnostics for display (similar to tsc output)
 */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((d) => `${d.file}(${d.line},${d.column}): error TS${d.code}: ${d.message}`)
    .join('\n');
}

/**
 * Check if a diagnostic matches another (same location and code)
 */
export function diagnosticsMatch(a: Diagnostic, b: Diagnostic): boolean {
  return a.file === b.file && a.line === b.line && a.column === b.column && a.code === b.code;
}

/**
 * Find diagnostics that were resolved between two sets
 */
export function findResolvedDiagnostics(
  before: Diagnostic[],
  after: Diagnostic[]
): Diagnostic[] {
  return before.filter((b) => !after.some((a) => diagnosticsMatch(a, b)));
}

/**
 * Find diagnostics that were introduced between two sets
 */
export function findIntroducedDiagnostics(
  before: Diagnostic[],
  after: Diagnostic[]
): Diagnostic[] {
  return after.filter((a) => !before.some((b) => diagnosticsMatch(a, b)));
}
