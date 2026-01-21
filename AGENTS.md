# AGENTS.md - Coding Agent Instructions for ts-repair

## CRITICAL RULES

**These rules are non-negotiable. Violating them will break the project.**

### 1. Always Run Tests and Type Checking Before Committing

Before every commit:
```bash
bun run check  # TypeScript type checking must pass
bun test       # All tests must pass
```
Fix any defects before committing. Never commit code that fails type checking or tests.

### 2. No Stubs or TODOs

**Never stub out features or leave TODO comments.** Every feature must be fully implemented before committing. If a feature is too large, break it into smaller, complete pieces. Partial implementations and placeholder code are not acceptable.

### 3. Use Git Worktrees for Development

Make changes in git worktrees, not directly on main:

```bash
# Create a worktree for your feature branch
git worktree add ../ts-repair-feature-name -b feature-name

# Work in the worktree
cd ../ts-repair-feature-name

# After branch is merged, clean up
git worktree remove ../ts-repair-feature-name
git branch -d feature-name
```

**After the branch is merged, always clean up the worktree.**

### 4. Every Fix Must Be Verified

The core value proposition is verified fixes. No heuristic-only fixes. If we can't verify it helps, don't suggest it. A suggested fix that makes things worse is a critical bug.

### 5. Monotonic Progress

Each committed fix must reduce the diagnostic count. If a fix resolves one error but introduces two, it's rejected.

### 6. Deterministic Output

Same input must produce same repair plan. No randomness, no heuristics that vary by run.

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `bun run check` | Type check (must pass before commit) |
| `bun test` | Run all tests |
| `bun test tests/path/to/file.test.ts` | Run single test file |
| `bun test --test-name-pattern "pattern"` | Run tests matching pattern |
| `bun run build` | Build with TypeScript compiler |
| `bun run dev src/cli.ts` | Run CLI in dev mode |
| `ts-repair benchmark` | Run scoring strategy benchmarks |
| `ts-repair benchmark --fixture <name>` | Benchmark specific fixture |

### Running Specific Tests

```bash
# Single test file
bun test tests/oracle/vfs.test.ts

# Tests matching a name pattern
bun test --test-name-pattern "loads files from a valid tsconfig"

# Tests matching describe block
bun test --test-name-pattern "VirtualFS > fromProject"

# Fast tests only (oracle + output)
bun run test:fast

# Slow tests only (golden + efficiency)
bun run test:slow
```

## Project Overview

ts-repair is an oracle-guided TypeScript repair engine. It speculatively applies fixes from the TypeScript Language Service, verifies them against the compiler, and outputs verified repair plans.

Key directories:
- `src/oracle/` - Core repair algorithm (VFS, TypeScript integration, planner)
- `src/output/` - Output formatting and types
- `tests/` - Test suites organized by category
- `tests/fixtures/` - Minimal TypeScript projects for testing

## Code Style

### Imports

1. External packages first (e.g., `typescript`, `path`, `fs`)
2. Internal modules with `.js` extension (required for ESM)
3. Use `type` keyword for type-only imports

```typescript
import ts from "typescript";
import {
  createTypeScriptHost,
  toDiagnosticRef,
  type TypeScriptHost,
} from "./typescript.js";
import type { RepairPlan, VerifiedFix } from "../output/types.js";
```

### Formatting

- 2-space indentation
- Semicolons required
- Double quotes for strings
- Trailing commas in multi-line arrays/objects
- No eslint/prettier config - TypeScript strict mode enforces quality

### Types

- Explicit return types on public functions
- Interfaces for object shapes
- Type aliases for unions: `type ScoringStrategy = "delta" | "weighted"`
- Use `readonly` for immutable data
- Optional properties use `?` suffix

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `vfs.ts`, `fixture-cache.ts` |
| Test files | `*.test.ts` | `vfs.test.ts` |
| Types/Interfaces | PascalCase | `VFSSnapshot`, `TypeScriptHost` |
| Functions | camelCase | `createTypeScriptHost` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_OPTIONS` |
| Local variables | camelCase | `configPath`, `diagnosticsBefore` |

### Exports

- Named exports only (no default exports)
- Re-export from `index.ts` for public API
- Use `export type` for type-only exports

```typescript
// Core API
export { repair, plan } from "./oracle/planner.js";

// Types
export type { RepairPlan, VerifiedFix } from "./output/types.js";
```

### Error Handling

- Throw `Error` with descriptive messages for setup/config errors
- Use try-catch with type narrowing: `e instanceof Error ? e.message : String(e)`
- Continue/skip on non-critical errors (e.g., file parse failures)
- Use early returns for invalid input

### Documentation

- JSDoc block comments for modules (top of file)
- JSDoc for public functions with `@param` and `@returns`
- Section separators using `// ===...===` for major sections
- Inline comments for non-obvious logic

## Testing

### Test Framework

Uses Bun's built-in test runner (`bun:test`).

```typescript
import { describe, it, expect, beforeEach } from "bun:test";

describe("ModuleName", () => {
  describe("functionName", () => {
    it("does something specific", () => {
      // Arrange, Act, Assert
    });
  });
});
```

### Test Categories

| Category | Location | Speed |
|----------|----------|-------|
| Unit tests | `tests/oracle/`, `tests/output/` | Fast |
| Golden tests | `tests/golden/` | Slow |
| Efficiency tests | `tests/efficiency/` | Slow |

### Test Coverage Standards

All code must have comprehensive test coverage including:
- **Happy path** - Normal operation
- **Boundary cases** - Edge conditions, empty inputs, single items, large inputs
- **Error cases** - Invalid inputs, missing files, malformed data

### Fixtures

Test fixtures live in `tests/fixtures/<name>/`:
- Each fixture has `tsconfig.json` + TypeScript files with deliberate errors
- Keep fixtures minimal (1-3 files) and focused on specific error patterns
- Name fixtures by the error pattern they test (e.g., `missing-import/`, `type-mismatch/`)

### Slow Test Timeout

```typescript
it("slow operation", () => { ... }, { timeout: 15000 });
```

## TypeScript Configuration

Key compiler options (from `tsconfig.json`):
- `"strict": true` - All strict checks enabled
- `"noUnusedLocals": true` - No unused variables
- `"noUnusedParameters": true` - No unused parameters
- `"noImplicitReturns": true` - All code paths must return
- `"module": "NodeNext"` - ESM with .js extensions required
