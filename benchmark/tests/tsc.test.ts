/**
 * Tests for TypeScript compiler wrapper
 */

import { describe, test, expect } from 'bun:test';
import * as path from 'node:path';
import {
  runTsc,
  parseTscOutput,
  countByCategory,
  groupByFile,
  getUniqueFiles,
  formatDiagnostics,
  diagnosticsMatch,
  findResolvedDiagnostics,
  findIntroducedDiagnostics,
} from '../src/tsc.js';
import type { Diagnostic } from '../src/types.js';

// Path to mini-ts-app fixture
const FIXTURE_PATH = path.resolve(import.meta.dirname, '../fixtures/mini-ts-app');

describe('runTsc', () => {
  test('runs tsc on mini-ts-app fixture with no errors', () => {
    const result = runTsc(FIXTURE_PATH, 'tsconfig.json');

    // Clean fixture should have no errors
    expect(result.diagnostics).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  test('returns wall time', () => {
    const result = runTsc(FIXTURE_PATH, 'tsconfig.json');
    expect(result.wallTimeMs).toBeGreaterThan(0);
  });
});

describe('parseTscOutput', () => {
  test('parses single error', () => {
    const output = "src/index.ts(10,5): error TS2304: Cannot find name 'User'.";
    const diagnostics = parseTscOutput(output, '/project');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.file).toContain('src/index.ts');
    expect(diagnostics[0]!.line).toBe(10);
    expect(diagnostics[0]!.column).toBe(5);
    expect(diagnostics[0]!.code).toBe(2304);
    expect(diagnostics[0]!.message).toContain("Cannot find name 'User'");
  });

  test('parses multiple errors', () => {
    const output = `
src/index.ts(10,5): error TS2304: Cannot find name 'User'.
src/utils.ts(20,10): error TS2345: Argument of type 'string' is not assignable.
    `.trim();

    const diagnostics = parseTscOutput(output, '/project');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]!.file).toContain('index.ts');
    expect(diagnostics[1]!.file).toContain('utils.ts');
  });

  test('handles empty output', () => {
    expect(parseTscOutput('', '/project')).toHaveLength(0);
    expect(parseTscOutput('   ', '/project')).toHaveLength(0);
  });

  test('ignores non-error lines', () => {
    const output = `
Some random text
src/index.ts(10,5): error TS2304: Cannot find name 'User'.
More random text
    `.trim();

    const diagnostics = parseTscOutput(output, '/project');
    expect(diagnostics).toHaveLength(1);
  });

  test('assigns category to diagnostics', () => {
    const output = "src/index.ts(10,5): error TS2304: Cannot find name 'User'.";
    const diagnostics = parseTscOutput(output, '/project');

    expect(diagnostics[0]!.category).toBeDefined();
  });
});

describe('countByCategory', () => {
  const diagnostics: Diagnostic[] = [
    { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Not found', category: 'cascade' },
    { file: 'b.ts', line: 1, column: 1, code: 2345, message: 'Type mismatch', category: 'mechanical' },
    { file: 'c.ts', line: 1, column: 1, code: 2322, message: 'Assignment', category: 'mechanical' },
  ];

  test('counts diagnostics by category', () => {
    const counts = countByCategory(diagnostics);
    expect(counts.cascade).toBe(1);
    expect(counts.mechanical).toBe(2);
    expect(counts.judgment).toBe(0);
  });
});

describe('groupByFile', () => {
  const diagnostics: Diagnostic[] = [
    { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error 1', category: 'cascade' },
    { file: 'a.ts', line: 2, column: 1, code: 2305, message: 'Error 2', category: 'cascade' },
    { file: 'b.ts', line: 1, column: 1, code: 2306, message: 'Error 3', category: 'mechanical' },
  ];

  test('groups diagnostics by file', () => {
    const grouped = groupByFile(diagnostics);

    expect(grouped.size).toBe(2);
    expect(grouped.get('a.ts')).toHaveLength(2);
    expect(grouped.get('b.ts')).toHaveLength(1);
  });
});

describe('getUniqueFiles', () => {
  const diagnostics: Diagnostic[] = [
    { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error 1', category: 'cascade' },
    { file: 'a.ts', line: 2, column: 1, code: 2305, message: 'Error 2', category: 'cascade' },
    { file: 'b.ts', line: 1, column: 1, code: 2306, message: 'Error 3', category: 'mechanical' },
  ];

  test('returns unique file paths', () => {
    const files = getUniqueFiles(diagnostics);
    expect(files).toHaveLength(2);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.ts');
  });

  test('returns empty array for empty input', () => {
    expect(getUniqueFiles([])).toHaveLength(0);
  });
});

describe('formatDiagnostics', () => {
  test('formats diagnostics for display', () => {
    const diagnostics: Diagnostic[] = [
      { file: 'src/index.ts', line: 10, column: 5, code: 2304, message: "Cannot find name 'User'", category: 'cascade' },
    ];

    const formatted = formatDiagnostics(diagnostics);
    expect(formatted).toContain('src/index.ts');
    expect(formatted).toContain('10');
    expect(formatted).toContain('TS2304');
  });

  test('handles multiple diagnostics', () => {
    const diagnostics: Diagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error 1', category: 'cascade' },
      { file: 'b.ts', line: 2, column: 2, code: 2345, message: 'Error 2', category: 'mechanical' },
    ];

    const formatted = formatDiagnostics(diagnostics);
    expect(formatted).toContain('a.ts');
    expect(formatted).toContain('b.ts');
  });
});

describe('diagnosticsMatch', () => {
  test('matches identical diagnostics', () => {
    const d1: Diagnostic = { file: 'a.ts', line: 10, column: 5, code: 2304, message: 'Error', category: 'cascade' };
    const d2: Diagnostic = { file: 'a.ts', line: 10, column: 5, code: 2304, message: 'Error', category: 'cascade' };

    expect(diagnosticsMatch(d1, d2)).toBe(true);
  });

  test('does not match different files', () => {
    const d1: Diagnostic = { file: 'a.ts', line: 10, column: 5, code: 2304, message: 'Error', category: 'cascade' };
    const d2: Diagnostic = { file: 'b.ts', line: 10, column: 5, code: 2304, message: 'Error', category: 'cascade' };

    expect(diagnosticsMatch(d1, d2)).toBe(false);
  });

  test('does not match different lines', () => {
    const d1: Diagnostic = { file: 'a.ts', line: 10, column: 5, code: 2304, message: 'Error', category: 'cascade' };
    const d2: Diagnostic = { file: 'a.ts', line: 11, column: 5, code: 2304, message: 'Error', category: 'cascade' };

    expect(diagnosticsMatch(d1, d2)).toBe(false);
  });

  test('does not match different codes', () => {
    const d1: Diagnostic = { file: 'a.ts', line: 10, column: 5, code: 2304, message: 'Error', category: 'cascade' };
    const d2: Diagnostic = { file: 'a.ts', line: 10, column: 5, code: 2345, message: 'Error', category: 'cascade' };

    expect(diagnosticsMatch(d1, d2)).toBe(false);
  });
});

describe('findResolvedDiagnostics', () => {
  test('finds diagnostics that were resolved', () => {
    const before: Diagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error 1', category: 'cascade' },
      { file: 'b.ts', line: 2, column: 1, code: 2345, message: 'Error 2', category: 'mechanical' },
    ];
    const after: Diagnostic[] = [
      { file: 'b.ts', line: 2, column: 1, code: 2345, message: 'Error 2', category: 'mechanical' },
    ];

    const resolved = findResolvedDiagnostics(before, after);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.file).toBe('a.ts');
  });

  test('returns empty array when nothing resolved', () => {
    const diagnostics: Diagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error', category: 'cascade' },
    ];

    const resolved = findResolvedDiagnostics(diagnostics, diagnostics);
    expect(resolved).toHaveLength(0);
  });
});

describe('findIntroducedDiagnostics', () => {
  test('finds newly introduced diagnostics', () => {
    const before: Diagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error 1', category: 'cascade' },
    ];
    const after: Diagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error 1', category: 'cascade' },
      { file: 'b.ts', line: 2, column: 1, code: 2345, message: 'Error 2', category: 'mechanical' },
    ];

    const introduced = findIntroducedDiagnostics(before, after);
    expect(introduced).toHaveLength(1);
    expect(introduced[0]!.file).toBe('b.ts');
  });

  test('returns empty array when nothing introduced', () => {
    const diagnostics: Diagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, code: 2304, message: 'Error', category: 'cascade' },
    ];

    const introduced = findIntroducedDiagnostics(diagnostics, diagnostics);
    expect(introduced).toHaveLength(0);
  });
});
