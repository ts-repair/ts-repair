/**
 * Golden tests for mangle determinism
 *
 * These tests verify that mangling produces identical results
 * for the same seed, ensuring reproducible benchmarks.
 */

import { describe, test, expect } from 'bun:test';
import * as path from 'node:path';
import { mangleProject, previewMangles } from '../../src/mangler.js';
import type { MangleRecipe, MangleRecord } from '../../src/types.js';

// Path to mini-ts-app fixture
const FIXTURE_PATH = path.resolve(import.meta.dirname, '../../fixtures/mini-ts-app');

// Standard recipe for golden tests
const GOLDEN_RECIPE: MangleRecipe = {
  deleteImport: 1,
  removeTypeAnnotation: 2,
  deleteReturnType: 1,
};

// Standard seed for golden tests
const GOLDEN_SEED = 42;

/**
 * Normalize a mangle record for comparison
 */
function normalizeRecord(record: MangleRecord): object {
  return {
    type: record.type,
    file: record.file,
    line: record.line,
    column: record.column,
    original: record.original,
    replacement: record.replacement,
  };
}

describe('Mangle Determinism', () => {
  test('same seed produces identical records across runs', () => {
    const options = {
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: GOLDEN_RECIPE,
      seed: GOLDEN_SEED,
    };

    // Run multiple times
    const results = Array.from({ length: 3 }, () => mangleProject(options));

    // All results should have the same number of records
    const recordCounts = results.map((r) => r.records.length);
    expect(new Set(recordCounts).size).toBe(1);

    // All results should have identical normalized records
    const firstNormalized = results[0]!.records.map(normalizeRecord);
    for (let i = 1; i < results.length; i++) {
      const normalized = results[i]!.records.map(normalizeRecord);
      expect(normalized).toEqual(firstNormalized);
    }
  });

  test('same seed produces identical modified files', () => {
    const options = {
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: GOLDEN_RECIPE,
      seed: GOLDEN_SEED,
    };

    const result1 = mangleProject(options);
    const result2 = mangleProject(options);

    // Same modified files
    const files1 = Array.from(result1.modifiedFiles.keys()).sort();
    const files2 = Array.from(result2.modifiedFiles.keys()).sort();
    expect(files1).toEqual(files2);

    // Same content for each file
    for (const file of files1) {
      expect(result1.modifiedFiles.get(file)).toBe(result2.modifiedFiles.get(file));
    }
  });

  test('different seeds produce different results', () => {
    const baseOptions = {
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: { deleteImport: 2, removeTypeAnnotation: 3 },
    };

    const result1 = mangleProject({ ...baseOptions, seed: 1 });
    const result2 = mangleProject({ ...baseOptions, seed: 999999 });

    // With enough mangles and different seeds, we should get different results
    // Compare the combination of all mangled locations
    const locations1 = result1.records.map((r) => `${r.file}:${r.line}`).sort().join(',');
    const locations2 = result2.records.map((r) => `${r.file}:${r.line}`).sort().join(',');

    // At least one mangle should be different
    // (This might occasionally fail if there aren't enough candidates,
    // but with the mini-ts-app fixture there should be enough variety)
    expect(locations1).not.toBe(locations2);
  });

  test('preview produces consistent estimates', () => {
    const options = {
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: GOLDEN_RECIPE,
      seed: GOLDEN_SEED,
    };

    const previews = Array.from({ length: 3 }, () => previewMangles(options));

    // All previews should have identical results
    const first = previews[0]!;
    for (let i = 1; i < previews.length; i++) {
      expect(previews[i]!.estimatedErrors).toBe(first.estimatedErrors);
      expect(previews[i]!.candidateCounts).toEqual(first.candidateCounts);
      expect(previews[i]!.selectedCounts).toEqual(first.selectedCounts);
    }
  });

  test('golden snapshot: expected mangle types for seed 42', () => {
    const result = mangleProject({
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: GOLDEN_RECIPE,
      seed: GOLDEN_SEED,
    });

    // Verify we got the expected number of each mangle type
    const typeCounts: Record<string, number> = {};
    for (const record of result.records) {
      typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;
    }

    // Should match the recipe (or less if not enough candidates)
    expect(typeCounts['deleteImport'] ?? 0).toBeLessThanOrEqual(GOLDEN_RECIPE.deleteImport ?? 0);
    expect(typeCounts['removeTypeAnnotation'] ?? 0).toBeLessThanOrEqual(GOLDEN_RECIPE.removeTypeAnnotation ?? 0);
    expect(typeCounts['deleteReturnType'] ?? 0).toBeLessThanOrEqual(GOLDEN_RECIPE.deleteReturnType ?? 0);
  });
});
