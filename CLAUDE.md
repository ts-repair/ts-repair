# ts-repair

## ⚠️ DEVELOPMENT RULES — READ FIRST

### 1. No Stubs or TODOs

**Never stub out features or leave TODO comments.** Every feature must be fully implemented before committing. If a feature is too large, break it into smaller, complete pieces. Partial implementations and placeholder code are not acceptable.

### 2. Always Run Tests Before Committing

Before every commit:
```bash
mise run check    # TypeScript type checking must pass
mise run test     # All tests must pass
```
**Never commit code that fails type checking or tests.** Fix any defects before committing.

### 3. Use Git Worktrees for Development

Make changes in git worktrees, not directly on main:

```bash
# 1. Create a worktree for your feature branch
git worktree add ../ts-repair-feature-name -b feature-name

# 2. Work in the worktree
cd ../ts-repair-feature-name

# 3. Implement, commit, and run tests
mise run check && mise run test

# 4. STOP — Wait for user review before merging
#    Do NOT merge to main automatically

# 5. After user approves, merge to main (from main worktree)
cd ../ts-repair
git merge feature-name

# 6. Clean up worktree and branch
git worktree remove ../ts-repair-feature-name
git branch -d feature-name
```

**Important workflow:**
- After implementing a feature, **wait for user review** before merging
- Only merge to main after the user has reviewed and approved the changes
- After merging, always clean up the worktree and branch

---

## Project Overview

ts-repair is an **oracle-guided TypeScript repair engine** that turns compiler diagnostics into verified repair plans for agents.

The key insight: Instead of giving agents raw errors and hoping they fix them, we **speculatively apply every candidate fix, re-run the type checker, and only surface fixes that provably reduce errors**.

**Core algorithm:**
```
while diagnostics > 0:
  for each diagnostic, get candidate fixes (from TS Language Service)
  for each candidate:
    apply to in-memory copy
    re-run type checker
    measure delta (errors removed - errors introduced)
  select best candidate (max delta)
  commit and repeat
```

**What agents receive:**
- Verified repair plan with ordered steps
- Remaining diagnostics classified by disposition (AutoFixable, NeedsJudgment, NoCandidate)
- Machine-readable changes they can apply directly

**Status:** Prototype complete. See [docs/ROADMAP.md](docs/ROADMAP.md) for implementation plan.

Configuration reference: [docs/CONFIG.md](docs/CONFIG.md).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ts-repair Repair Engine                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────────────┐ │
│  │   Virtual   │   │  TypeScript  │   │   Repair Planner      │ │
│  │ File System │ → │  LS + Oracle │ → │  (Greedy + Solver)    │ │
│  └─────────────┘   └──────────────┘   └───────────────────────┘ │
│         │                  │                      │              │
│         │                  │                      ▼              │
│         │                  │          ┌───────────────────────┐ │
│         │                  │          │   Repair Classifier   │ │
│         │                  │          │  (AutoFix/Judgment)   │ │
│         │                  │          └───────────────────────┘ │
│         ▼                  ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Repair Plan Output                        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
ts-repair/
├── src/
│   ├── index.ts              # Main entry point, public API
│   ├── cli.ts                # CLI interface
│   ├── oracle/
│   │   ├── vfs.ts            # Virtual file system (snapshot/restore)
│   │   ├── typescript.ts     # TypeScript integration
│   │   ├── verify.ts         # Speculative verification
│   │   └── planner.ts        # Repair planning algorithm
│   ├── classify/
│   │   ├── disposition.ts    # Diagnostic classification
│   │   └── risk.ts           # Risk scoring heuristics
│   └── output/
│       ├── format.ts         # Output formatting
│       └── types.ts          # Type definitions
├── tests/
│   ├── oracle/               # Oracle behavior tests
│   ├── classify/             # Classification tests
│   ├── integration/          # Real project tests
│   └── fixtures/             # Test TypeScript projects
├── docs/
│   ├── PRD.md                # Product requirements
│   └── ROADMAP.md            # Implementation status
├── package.json
├── tsconfig.json
└── README.md
```

## Key Concepts

### Virtual File System (VFS)

In-memory file state that supports:
- **snapshot()** — Save current state
- **restore(snapshot)** — Restore to saved state
- **applyChange()** — Apply text edit

This enables speculative application without touching disk.

### TypeScript Integration

We use TypeScript's Language Service API:
- **createLanguageService()** — Create a service instance
- **getSemanticDiagnostics()** — Get type errors
- **getCodeFixesAtPosition()** — Get candidate fixes for a diagnostic

The Language Service is recreated for each verification check to ensure fresh state.

### Verification Oracle

The oracle answers: "If I apply this fix, does it help?"

```typescript
function verify(fix: CodeFixAction): VerificationResult {
  const snapshot = vfs.snapshot();
  applyFix(fix);
  const newDiagnostics = getDiagnostics();
  const delta = oldCount - newDiagnostics.length;
  vfs.restore(snapshot);
  return { delta, newDiagnostics };
}
```

### Diagnostic Disposition

After planning, each remaining diagnostic is classified:

| Disposition | Meaning | Agent Action |
|-------------|---------|--------------|
| **AutoFixable** | Verified fix exists, low risk | Apply automatically |
| **AutoFixableHighRisk** | Verified fix exists, semantic risk | Opt-in apply |
| **NeedsJudgment** | Multiple valid fixes | Surface to LLM |
| **NoCandidate** | No fix helps | Treat as semantic work |

## Build Commands

Use `mise` to run commands (mise manages the toolchain):

```bash
mise run install     # Install dependencies
mise run check       # Type check with TypeScript
mise run test        # Run all tests
mise run dev <file>  # Run in dev mode
```

Or use `mise exec` to run directly:

```bash
mise exec -- bun install
mise exec -- bun test
```

## CLI Commands

```bash
# Get a verified repair plan
ts-repair repair ./tsconfig.json

# Output as JSON
ts-repair repair ./tsconfig.json --json

# Apply fixes automatically
ts-repair repair ./tsconfig.json --apply
```

## Development Notes

### TypeScript Compiler API

Key types and functions:
- `ts.createLanguageService(host)` — Create service
- `ts.LanguageServiceHost` — Interface for file access
- `ts.getCodeFixesAtPosition()` — Get fixes for diagnostic
- `ts.CodeFixAction` — A candidate fix with text changes
- `ts.Diagnostic` — A compiler diagnostic

### Verification is Mandatory

**Never suggest a fix without verification.** The entire value proposition is that fixes are verified to help. A suggested fix that makes things worse is a critical bug.

### Performance Considerations

Each verification requires:
1. Apply changes to VFS
2. Recreate or update Language Service
3. Re-run type checker
4. Measure diagnostic delta

For N errors with M candidate fixes each, this is O(N*M) type-check operations per planning round. TypeScript's incremental checker helps, but this can be expensive on large projects.

Optimizations to consider:
- Parallel verification (different candidates don't conflict)
- Caching verification results
- Early termination when confident fix found

### Risk Scoring

Not all verified fixes are equal. Risk categories (low to high):
1. **Add import** — Almost always correct
2. **Add async/await** — Usually correct
3. **Add missing property** — Might not be the right type
4. **Rename to similar** — Spelling correction, medium risk
5. **Type coercion** — parseInt, String(), etc.
6. **Type assertion** — `as T` — risky, may hide bugs

## Feature Documentation

| Topic | File | Description |
|-------|------|-------------|
| **Architecture** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and components |
| **CLI Reference** | [docs/CLI.md](docs/CLI.md) | Command-line interface reference |
| **Product Requirements** | [docs/PRD.md](docs/PRD.md) | Full specification |
| **Roadmap** | [docs/ROADMAP.md](docs/ROADMAP.md) | Implementation status |

## Implementation Standards

### Every Fix Must Be Verified

No heuristic-only fixes. If we can't verify it helps, don't suggest it.

### Monotonic Progress

Each committed fix must reduce the diagnostic count. If a fix resolves one error but introduces two, it's rejected.

### Deterministic Output

Same input → same repair plan. No randomness, no heuristics that vary by run.

### Clear Classification

Every diagnostic in the output must have a disposition. The agent should never have to guess what to do.

## Testing Requirements

### Test Coverage Standards

All code must have comprehensive test coverage including:
- **Happy path** — Normal operation
- **Boundary cases** — Edge conditions, empty inputs, single items, large inputs
- **Error cases** — Invalid inputs, missing files, malformed data

### Test Categories

| Category | Location | Purpose |
|----------|----------|---------|
| **Unit tests** | `tests/oracle/` | Test individual functions in isolation |
| **Golden tests** | `tests/golden/` | Snapshot-based tests for repair output |
| **Efficiency tests** | `tests/efficiency/` | Verify candidate selection quality |
| **Integration tests** | `tests/integration/` | End-to-end with real TypeScript projects |

### Golden Tests

Golden tests capture expected repair output for known scenarios:
- Each test has a fixture TypeScript project with deliberate errors
- Running the planner produces a repair plan
- The plan is compared against a stored `.expected.json` file
- If output changes, the test fails until the golden file is updated

### Efficiency Tests

Efficiency tests verify the quality of candidate selection:
- Given a diagnostic with N candidate fixes from TypeScript
- Verify we select the best K fixes (by delta)
- Example: "TypeScript suggests 7 fixes, we correctly pick the best 3"
- These tests ensure the greedy selection and ranking work correctly

### Test Fixtures

Test fixtures are minimal TypeScript projects in `tests/fixtures/`:
- Each fixture targets a specific error pattern
- Fixtures should be small (1-3 files) and focused
- Name fixtures by the error pattern they test (e.g., `missing-import/`, `type-mismatch/`)

## Anti-Goals

These are explicitly out of scope:

- **Do not invent new syntax** — We work with TypeScript as-is
- **Do not require AST/JSON reasoning** — Agents work with text and repair plans
- **Do not guess developer intent** — Only suggest what the compiler can verify
- **Do not promise semantic correctness** — We promise type-level correctness only
- **Do not use LLMs for ranking** — Verification is the ranking mechanism
