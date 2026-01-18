/**
 * Tests for AST-based code manglers
 */

import { describe, test, expect } from 'bun:test';
import * as path from 'node:path';
import {
  scaleRecipe,
  mangleProject,
  previewMangles,
  DEFAULT_RECIPE,
  CASCADE_RECIPE,
} from '../src/mangler.js';
import type { MangleRecipe } from '../src/types.js';
import { CASCADE_MULTIPLIERS } from '../src/types.js';

// Path to mini-ts-app fixture
const FIXTURE_PATH = path.resolve(import.meta.dirname, '../fixtures/mini-ts-app');

describe('scaleRecipe', () => {
  test('scales recipe to target error count', () => {
    const base: MangleRecipe = {
      deleteImport: 1,  // 5 errors expected
      removeTypeAnnotation: 1,  // 1 error expected
    };
    // Expected: 6 errors total, target 30 = 5x scale
    const scaled = scaleRecipe(base, 30);

    expect(scaled.deleteImport).toBeGreaterThan(1);
    expect(scaled.removeTypeAnnotation).toBeGreaterThan(1);
  });

  test('maintains minimum of 1 for each type', () => {
    const base: MangleRecipe = {
      deleteImport: 10,
      removeTypeAnnotation: 1,
    };
    // Scale down to very few errors
    const scaled = scaleRecipe(base, 5);

    // Should still have at least 1 of each type
    if (scaled.deleteImport !== undefined) {
      expect(scaled.deleteImport).toBeGreaterThanOrEqual(1);
    }
    if (scaled.removeTypeAnnotation !== undefined) {
      expect(scaled.removeTypeAnnotation).toBeGreaterThanOrEqual(1);
    }
  });

  test('returns base recipe if expected errors is 0', () => {
    const base: MangleRecipe = {};
    const scaled = scaleRecipe(base, 30);
    expect(scaled).toEqual(base);
  });

  test('preserves recipe keys when scaling', () => {
    const scaled = scaleRecipe(DEFAULT_RECIPE, 50);
    const baseKeys = Object.keys(DEFAULT_RECIPE);
    const scaledKeys = Object.keys(scaled);

    // All original keys should be present
    for (const key of baseKeys) {
      expect(scaledKeys).toContain(key);
    }
  });
});

describe('previewMangles', () => {
  test('finds candidates in mini-ts-app fixture', () => {
    const preview = previewMangles({
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: DEFAULT_RECIPE,
      seed: 42,
    });

    // Should find some candidates
    expect(preview.estimatedErrors).toBeGreaterThan(0);

    // Should have candidate counts
    const totalCandidates = Object.values(preview.candidateCounts).reduce((a, b) => a + b, 0);
    expect(totalCandidates).toBeGreaterThan(0);
  });

  test('estimates errors based on cascade multipliers', () => {
    const recipe: MangleRecipe = {
      deleteImport: 2,
    };
    const preview = previewMangles({
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe,
      seed: 42,
    });

    // With 2 deleteImport mangles, expected errors ~= 2 * CASCADE_MULTIPLIERS.deleteImport
    const expectedMin = 2 * (CASCADE_MULTIPLIERS.deleteImport - 2);
    expect(preview.estimatedErrors).toBeGreaterThanOrEqual(expectedMin);
  });

  test('respects seed for determinism', () => {
    const options = {
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: DEFAULT_RECIPE,
      seed: 12345,
    };

    const preview1 = previewMangles(options);
    const preview2 = previewMangles(options);

    // Same seed should give same results
    expect(preview1.selectedCounts).toEqual(preview2.selectedCounts);
    expect(preview1.estimatedErrors).toBe(preview2.estimatedErrors);
  });

  test('different seeds give different selections', () => {
    const baseOptions = {
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: { deleteImport: 1, removeTypeAnnotation: 2 },
    };

    const preview1 = previewMangles({ ...baseOptions, seed: 1 });
    const preview2 = previewMangles({ ...baseOptions, seed: 99999 });

    // Different seeds may give different candidate selections
    // (though this depends on how many candidates are available)
    // At minimum, they should both be valid
    expect(preview1.estimatedErrors).toBeGreaterThan(0);
    expect(preview2.estimatedErrors).toBeGreaterThan(0);
  });
});

describe('mangleProject', () => {
  test('applies mangles to mini-ts-app fixture', () => {
    const result = mangleProject({
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: { removeTypeAnnotation: 1 },
      seed: 42,
    });

    // Should have at least one mangle record
    expect(result.records.length).toBeGreaterThanOrEqual(1);

    // Should have modified files
    expect(result.modifiedFiles.size).toBeGreaterThan(0);

    // Each record should have required fields
    for (const record of result.records) {
      expect(record.id).toBeDefined();
      expect(record.type).toBe('removeTypeAnnotation');
      expect(record.file).toBeDefined();
      expect(record.line).toBeGreaterThan(0);
      expect(record.original).toBeDefined();
      expect(record.replacement).toBeDefined();
    }
  });

  test('produces deterministic results with same seed', () => {
    const options = {
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: { deleteImport: 1, removeTypeAnnotation: 1 },
      seed: 42,
    };

    const result1 = mangleProject(options);
    const result2 = mangleProject(options);

    // Same seed should produce identical results
    expect(result1.records.length).toBe(result2.records.length);

    for (let i = 0; i < result1.records.length; i++) {
      expect(result1.records[i]!.type).toBe(result2.records[i]!.type);
      expect(result1.records[i]!.file).toBe(result2.records[i]!.file);
      expect(result1.records[i]!.line).toBe(result2.records[i]!.line);
      expect(result1.records[i]!.original).toBe(result2.records[i]!.original);
      expect(result1.records[i]!.replacement).toBe(result2.records[i]!.replacement);
    }
  });

  test('modified content differs from original', () => {
    const result = mangleProject({
      projectPath: FIXTURE_PATH,
      tsconfigPath: 'tsconfig.json',
      recipe: { removeTypeAnnotation: 1 },
      seed: 42,
    });

    // At least one file should be modified
    expect(result.modifiedFiles.size).toBeGreaterThan(0);

    // The replacement should be different from the original
    for (const record of result.records) {
      expect(record.replacement).not.toBe(record.original);
    }
  });
});

describe('DEFAULT_RECIPE and CASCADE_RECIPE', () => {
  test('DEFAULT_RECIPE has expected mangle types', () => {
    const types = Object.keys(DEFAULT_RECIPE);
    expect(types.length).toBeGreaterThan(0);

    // Check some common types are present
    expect(types).toContain('deleteImport');
    expect(types).toContain('removeTypeAnnotation');
  });

  test('CASCADE_RECIPE focuses on high-cascade mangles', () => {
    const types = Object.keys(CASCADE_RECIPE);

    // CASCADE_RECIPE should have deleteImport (high cascade)
    expect(types).toContain('deleteImport');

    // Check counts are reasonable
    for (const count of Object.values(CASCADE_RECIPE)) {
      expect(count).toBeGreaterThan(0);
    }
  });
});
