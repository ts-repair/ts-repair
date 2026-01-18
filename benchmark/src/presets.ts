/**
 * Fixture presets and deterministic recipes for reproducible benchmarks
 */

import type { MangleRecipe } from './types.js';

/**
 * Fixture preset configuration
 */
export interface FixturePreset {
  path: string;
  tsconfig: string;
  description: string;
  linesOfCode: number;
}

/**
 * Available local fixtures
 */
export const FIXTURE_PRESETS: Record<string, FixturePreset> = {
  mini: {
    path: 'fixtures/mini-ts-app',
    tsconfig: 'tsconfig.json',
    description: 'Synthetic ~500 LoC test app',
    linesOfCode: 500,
  },
  tsx: {
    path: 'fixtures/tsx-v4.19.2',
    tsconfig: 'tsconfig.json',
    description: 'tsx v4.19.2 - TypeScript execute (~3.5k LoC)',
    linesOfCode: 3500,
  },
  zod: {
    path: 'fixtures/zod-v3.23.8',
    tsconfig: 'tsconfig.json',
    description: 'zod v3.23.8 - Schema validation (~6.3k LoC)',
    linesOfCode: 6300,
  },
};

/**
 * Recipe sizes
 */
export type RecipeSize = 'small' | 'medium' | 'large';

/**
 * Fixture-specific recipes tuned to each project's characteristics
 */
export const FIXTURE_RECIPES: Record<string, Record<RecipeSize, MangleRecipe>> = {
  mini: {
    small: {
      deleteImport: 1,
      removeAsyncModifier: 1,
      deleteInterfaceProperty: 1,
      removeTypeAnnotation: 2,
      deleteReturnType: 1,
    },
    medium: {
      deleteImport: 2,
      removeAsyncModifier: 2,
      deleteInterfaceProperty: 2,
      removeTypeAnnotation: 3,
      deleteReturnType: 2,
      removeOptionalChaining: 1,
    },
    large: {
      deleteImport: 3,
      removeAsyncModifier: 3,
      deleteInterfaceProperty: 3,
      removeTypeAnnotation: 5,
      deleteReturnType: 3,
      removeOptionalChaining: 2,
      widenToUnknown: 2,
    },
  },
  tsx: {
    // Targets ~30 errors
    small: {
      deleteImport: 2,
      removeAsyncModifier: 2,
      deleteInterfaceProperty: 1,
      removeTypeAnnotation: 3,
      deleteReturnType: 2,
    },
    // Targets ~60 errors
    medium: {
      deleteImport: 4,
      removeAsyncModifier: 3,
      deleteInterfaceProperty: 3,
      removeTypeAnnotation: 5,
      deleteReturnType: 3,
      widenToUnknown: 2,
    },
    // Targets ~100 errors
    large: {
      deleteImport: 6,
      removeAsyncModifier: 5,
      deleteInterfaceProperty: 5,
      removeTypeAnnotation: 8,
      deleteReturnType: 5,
      widenToUnknown: 4,
      removeOptionalChaining: 3,
    },
  },
  zod: {
    // Targets ~30 errors - heavier on "hard" mangles
    small: {
      deleteImport: 1,
      breakUnionType: 3,
      deleteTypeGuard: 2,
      widenToUnknown: 2,
      removeTypeAnnotation: 2,
    },
    // Targets ~60 errors
    medium: {
      deleteImport: 3,
      breakUnionType: 5,
      deleteTypeGuard: 4,
      widenToUnknown: 4,
      deleteInterfaceProperty: 3,
      removeTypeAnnotation: 4,
    },
    // Targets ~100 errors
    large: {
      deleteImport: 5,
      breakUnionType: 8,
      deleteTypeGuard: 6,
      widenToUnknown: 6,
      deleteInterfaceProperty: 5,
      removeTypeAnnotation: 6,
      deleteReturnType: 4,
    },
  },
};

/**
 * Remote repository presets (for cloning)
 */
export interface RepoPreset {
  repo: string;
  tsconfig: string;
  targetDir?: string;
}

export const REPO_PRESETS: Record<string, RepoPreset> = {
  excalidraw: {
    repo: 'https://github.com/excalidraw/excalidraw',
    tsconfig: 'tsconfig.json',
    targetDir: 'packages/excalidraw/src',
  },
  tldraw: {
    repo: 'https://github.com/tldraw/tldraw',
    tsconfig: 'tsconfig.json',
    targetDir: 'packages/tldraw/src',
  },
  payload: {
    repo: 'https://github.com/payloadcms/payload',
    tsconfig: 'tsconfig.json',
    targetDir: 'packages/payload/src',
  },
};

/**
 * Get fixture preset by name
 */
export function getFixturePreset(name: string): FixturePreset | undefined {
  return FIXTURE_PRESETS[name];
}

/**
 * Get recipe for a fixture and size
 */
export function getFixtureRecipe(
  fixture: string,
  size: RecipeSize
): MangleRecipe | undefined {
  return FIXTURE_RECIPES[fixture]?.[size];
}

/**
 * List all available fixture names
 */
export function listFixtures(): string[] {
  return Object.keys(FIXTURE_PRESETS);
}

/**
 * List all available repo preset names
 */
export function listRepoPresets(): string[] {
  return Object.keys(REPO_PRESETS);
}
