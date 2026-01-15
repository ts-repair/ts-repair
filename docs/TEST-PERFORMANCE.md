# Test Performance Optimizations

This document describes the test performance optimizations implemented and potential future improvements.

## Current Status

**Before optimizations:** ~226 seconds for 168 tests
**After optimizations:** ~42-48 seconds for 168 tests (~4.7x faster)

## Implemented Optimizations

### 1. LanguageService Caching (Major Impact)

**File:** `src/oracle/typescript.ts`

Previously, every call to `getDiagnostics()` or `getCodeFixes()` created a brand new TypeScript LanguageService. This was extremely expensive since creating a LanguageService involves parsing the entire project.

**Solution:** The LanguageService is now created once per TypeScriptHost and reused. File versions are tracked per-file and incremented when the VFS changes, allowing TypeScript's incremental checker to recompute only what's needed.

Key changes:
- Added `fileVersions` Map to track per-file versions
- Created LanguageService once in `createTypeScriptHost()`
- Added `notifyFilesChanged()` method to bump all versions after VFS restore
- Added `reset()` method for test isolation

### 2. Split Test Scripts

**File:** `package.json`

Added separate scripts for fast and slow tests:
- `test:fast` - Runs oracle and output tests (~42s)
- `test:slow` - Runs golden and efficiency tests (~13s)
- `test` - Runs all tests

### 3. CI Workflow Optimization

**File:** `.github/workflows/ci.yml`

- **PRs:** Run fast tests only for quick feedback
- **Main branch:** Run full test suite including golden and efficiency tests

### 4. Fixture Host Caching Helper

**File:** `tests/helpers/fixture-cache.ts`

Provides `getFixtureHost(fixtureName)` that:
- Caches TypeScriptHost instances by fixture name
- Resets VFS to original state before returning
- Ensures test isolation while avoiding host recreation

## Potential Future Improvements

These optimizations were identified but not implemented. They offer diminishing returns compared to the major gains already achieved.

### 5. Parallel Test File Execution

Bun supports parallel test execution, but tests currently have implicit dependencies on shared state. To enable:

1. Ensure each test file is fully isolated
2. Add `--preload` for shared setup if needed
3. Configure Bun's parallel execution settings

**Estimated impact:** 20-30% reduction

### 6. Planner-Level Host Injection

Currently `plan()` creates its own TypeScriptHost internally. Adding an optional host parameter would allow tests to inject cached hosts:

```typescript
export function plan(
  configPath: string,
  options?: PlanOptions,
  host?: TypeScriptHost  // New optional parameter
): RepairPlan
```

**Estimated impact:** 10-20% for planner-heavy tests

### 7. Verification Result Caching

Track which (fixture, candidate) pairs have been verified:

```typescript
const verificationCache = new Map<string, number>(); // hash -> delta

function verify(fix: CodeFixAction): number {
  const hash = hashFix(fix);
  if (verificationCache.has(hash)) {
    return verificationCache.get(hash)!;
  }
  // ... do actual verification
  verificationCache.set(hash, delta);
  return delta;
}
```

**Estimated impact:** Significant for tests that verify similar candidates

### 8. Pre-computed Fixture Type Information

Store pre-computed diagnostics and candidates for fixtures that don't change:

```
tests/fixtures/async-await/
  tsconfig.json
  index.ts
  .type-cache.json  # Pre-computed diagnostics + candidates
```

Tests can validate against cached data for regression testing, only running full verification for new fixtures.

**Estimated impact:** 50-70% for golden tests, but adds maintenance burden

### 9. Test Filtering by Impact

Add test tags or markers to categorize tests:
- `@fast` - Quick unit tests
- `@golden` - Snapshot tests
- `@perf` - Performance baseline tests

Then run subsets based on what changed:
- TypeScript changes → run all
- Test changes → run affected tests
- Docs changes → skip tests

### 10. Warm TypeScript Module Cache

The TypeScript module is large (~15MB). Consider:
- Pre-loading TypeScript in a setup file
- Using Bun's module cache effectively
- Evaluating if tree-shaking helps

## Measuring Performance

To profile test performance:

```bash
# Time individual test files
time bun test tests/oracle/planner.test.ts

# Time test suites
time bun run test:fast
time bun run test:slow

# Full suite
time bun test
```

## Architecture Notes

The test performance is fundamentally tied to TypeScript compilation cost. Each `getDiagnostics()` call runs the type checker. The O(N×M) verification loop in the planner (N errors × M candidates) means many type checker invocations per `plan()` call.

The LanguageService caching optimization addresses this by:
1. Reusing the compiled program state between calls
2. Using incremental checking (only re-checking changed files)
3. Avoiding repeated module resolution and parsing
