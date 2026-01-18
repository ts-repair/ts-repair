/**
 * Tests for fixture presets and recipes
 */

import { describe, test, expect } from 'bun:test';
import {
  FIXTURE_PRESETS,
  FIXTURE_RECIPES,
  REPO_PRESETS,
  getFixturePreset,
  getRepoPreset,
  getFixtureRecipe,
  listFixtures,
  listRepoPresets,
  hasRecipes,
} from '../src/presets.js';

describe('FIXTURE_PRESETS', () => {
  test('contains mini fixture', () => {
    expect(FIXTURE_PRESETS['mini']).toBeDefined();
    expect(FIXTURE_PRESETS['mini']!.path).toBe('fixtures/mini-ts-app');
    expect(FIXTURE_PRESETS['mini']!.tsconfig).toBe('tsconfig.json');
    expect(FIXTURE_PRESETS['mini']!.linesOfCode).toBeGreaterThan(0);
  });

  test('all fixtures have required fields', () => {
    for (const [name, fixture] of Object.entries(FIXTURE_PRESETS)) {
      expect(fixture.path).toBeDefined();
      expect(fixture.tsconfig).toBeDefined();
      expect(fixture.description).toBeDefined();
      expect(fixture.linesOfCode).toBeGreaterThan(0);
    }
  });
});

describe('REPO_PRESETS', () => {
  test('contains tsx and zod presets with tags', () => {
    expect(REPO_PRESETS['tsx']).toBeDefined();
    expect(REPO_PRESETS['tsx']!.tag).toBe('v4.19.2');
    expect(REPO_PRESETS['tsx']!.repo).toContain('github.com');

    expect(REPO_PRESETS['zod']).toBeDefined();
    expect(REPO_PRESETS['zod']!.tag).toBe('v3.23.8');
    expect(REPO_PRESETS['zod']!.repo).toContain('github.com');
  });

  test('contains other exploratory presets', () => {
    expect(REPO_PRESETS['excalidraw']).toBeDefined();
    expect(REPO_PRESETS['tldraw']).toBeDefined();
    expect(REPO_PRESETS['payload']).toBeDefined();
  });

  test('all presets have required fields', () => {
    for (const [name, preset] of Object.entries(REPO_PRESETS)) {
      expect(preset.repo).toBeDefined();
      expect(preset.repo).toMatch(/^https:\/\//);
      expect(preset.tsconfig).toBeDefined();
    }
  });
});

describe('FIXTURE_RECIPES', () => {
  test('has recipes for mini, tsx, and zod', () => {
    expect(FIXTURE_RECIPES['mini']).toBeDefined();
    expect(FIXTURE_RECIPES['tsx']).toBeDefined();
    expect(FIXTURE_RECIPES['zod']).toBeDefined();
  });

  test('each fixture has small, medium, and large recipes', () => {
    for (const [name, recipes] of Object.entries(FIXTURE_RECIPES)) {
      expect(recipes.small).toBeDefined();
      expect(recipes.medium).toBeDefined();
      expect(recipes.large).toBeDefined();
    }
  });

  test('recipes have increasing mangle counts', () => {
    for (const [name, recipes] of Object.entries(FIXTURE_RECIPES)) {
      const smallTotal = Object.values(recipes.small).reduce((a, b) => a + b, 0);
      const mediumTotal = Object.values(recipes.medium).reduce((a, b) => a + b, 0);
      const largeTotal = Object.values(recipes.large).reduce((a, b) => a + b, 0);

      expect(smallTotal).toBeLessThan(mediumTotal);
      expect(mediumTotal).toBeLessThan(largeTotal);
    }
  });

  test('zod recipes emphasize judgment-required mangles', () => {
    const zodRecipes = FIXTURE_RECIPES['zod'];
    expect(zodRecipes).toBeDefined();

    // zod should have breakUnionType and deleteTypeGuard
    expect(zodRecipes!.small.breakUnionType).toBeDefined();
    expect(zodRecipes!.small.deleteTypeGuard).toBeDefined();
  });
});

describe('getFixturePreset', () => {
  test('returns preset for valid name', () => {
    const preset = getFixturePreset('mini');
    expect(preset).toBeDefined();
    expect(preset!.path).toBe('fixtures/mini-ts-app');
  });

  test('returns undefined for invalid name', () => {
    expect(getFixturePreset('nonexistent')).toBeUndefined();
  });
});

describe('getRepoPreset', () => {
  test('returns preset for valid name', () => {
    const preset = getRepoPreset('tsx');
    expect(preset).toBeDefined();
    expect(preset!.repo).toContain('tsx');
  });

  test('returns undefined for invalid name', () => {
    expect(getRepoPreset('nonexistent')).toBeUndefined();
  });
});

describe('getFixtureRecipe', () => {
  test('returns recipe for valid fixture and size', () => {
    const recipe = getFixtureRecipe('mini', 'small');
    expect(recipe).toBeDefined();
    expect(Object.keys(recipe!).length).toBeGreaterThan(0);
  });

  test('returns recipe for tsx preset', () => {
    const recipe = getFixtureRecipe('tsx', 'medium');
    expect(recipe).toBeDefined();
  });

  test('returns undefined for invalid fixture', () => {
    expect(getFixtureRecipe('nonexistent', 'small')).toBeUndefined();
  });
});

describe('listFixtures', () => {
  test('returns array of fixture names', () => {
    const fixtures = listFixtures();
    expect(Array.isArray(fixtures)).toBe(true);
    expect(fixtures).toContain('mini');
  });
});

describe('listRepoPresets', () => {
  test('returns array of preset names', () => {
    const presets = listRepoPresets();
    expect(Array.isArray(presets)).toBe(true);
    expect(presets).toContain('tsx');
    expect(presets).toContain('zod');
    expect(presets).toContain('excalidraw');
  });
});

describe('hasRecipes', () => {
  test('returns true for fixtures with recipes', () => {
    expect(hasRecipes('mini')).toBe(true);
    expect(hasRecipes('tsx')).toBe(true);
    expect(hasRecipes('zod')).toBe(true);
  });

  test('returns false for presets without recipes', () => {
    expect(hasRecipes('excalidraw')).toBe(false);
    expect(hasRecipes('tldraw')).toBe(false);
    expect(hasRecipes('nonexistent')).toBe(false);
  });
});
