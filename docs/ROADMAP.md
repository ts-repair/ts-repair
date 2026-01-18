# ts-repair Implementation Roadmap

**Version:** 0.2.0 (Oracle-Guided TypeScript Repair)
**Target Runtime:** Node.js / Bun

---

## Overview

This roadmap tracks the implementation of ts-repair as an **oracle-guided TypeScript repair engine**. The system uses the TypeScript compiler as a verification oracle to produce verified, ranked repair plans for agents.

---

## Implementation Phases

### Phase 1: Core Oracle Loop ✅ Prototype Complete

The greedy oracle loop that speculatively applies fixes and verifies them.

| Component | Status | Notes |
|-----------|--------|-------|
| Virtual File System | ✅ Done | In-memory file state with snapshot/restore |
| TypeScript Integration | ✅ Done | LanguageService + Program creation |
| Diagnostic Collection | ✅ Done | Get all errors from project |
| Code Fix Collection | ✅ Done | Query getCodeFixesAtPosition per diagnostic |
| Speculative Application | ✅ Done | Apply fix → re-check → measure delta |
| Greedy Selection | ✅ Done | Pick best fix (max error reduction) |
| Repair Plan Output | ✅ Done | Structured output with steps and remaining |

**Location:** Core implementation in `src/oracle/`

### Phase 2: Production Implementation ✅ Complete

Production-quality implementation with full test coverage.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Project structure | ✅ Done | High | src/oracle/, src/output/, src/cli.ts |
| CLI interface | ✅ Done | High | `ts-repair repair <tsconfig>` |
| TypeScript host | ✅ Done | High | LanguageService with VFS |
| Error handling | ✅ Done | High | Graceful failures, good errors |
| JSON output format | ✅ Done | High | --json and --compact modes |
| Unit tests | ✅ Done | High | 125 tests across oracle, classify, output |
| Integration tests | ✅ Done | High | Golden tests + fixture projects |

### Phase 2.5: Budget Constraints ✅ Complete

Verification budget as a first-class constraint in the Planner + Verification layers.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Candidates per diagnostic | ✅ Done | High | `maxCandidates` option (default 10) |
| Candidates per iteration | ✅ Done | High | `maxCandidatesPerIteration` option (default 100) |
| Total verification budget | ✅ Done | High | `maxVerifications` option (default 500) |
| Pre-verification pruning | ✅ Done | High | `pruneCandidates()` using risk level + diff size |
| Graceful degradation | ✅ Done | High | `budgetExhausted` flag, remaining → NeedsJudgment |
| Budget counters in output | ✅ Done | Medium | `BudgetStats` in RepairPlan summary |

**Implementation notes:**
- Budget constraints live in Planner (`src/oracle/planner.ts`)
- `pruneCandidates()` scores by risk level (low=30, medium=20, high=10) minus diff size penalty
- When budget exhausted: returns partial plan, remaining diagnostics classified as NeedsJudgment
- Output includes `BudgetStats`: candidatesGenerated, candidatesVerified, verificationBudget, budgetExhausted

### Phase 2.6: CLI Implementation 📋 Planned

Implement the full CLI as specified in [docs/ts_repair_cli_specification.md](ts_repair_cli_specification.md).

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| `ts-repair tsc` command | 📋 Planned | High | tsc-compatible passthrough with `--plan` and `--auto` flags |
| `ts-repair check` command | 📋 Planned | High | Convenience wrapper for `tsc --noEmit` |
| `ts-repair plan` command | 📋 Planned | High | Generate verified repair plan (replaces current `repair`) |
| `ts-repair apply` command | 📋 Planned | High | Apply repairs from plan or `--auto` mode |
| `ts-repair explain` command | 📋 Planned | Medium | Explain specific repair candidates |
| Global options | 📋 Planned | High | `-p/--project`, `--format`, `--verbose` |
| Exit codes | 📋 Planned | High | 0=clean, 1=diagnostics remain, 2=tool error |
| `tsr` alias | 📋 Planned | Low | Optional convenience alias |

**Design notes:**
- Drop-in compatible with existing `tsc` workflows
- Deterministic and scriptable for agents and CI
- Default format: text for `tsc`/`check`, json for `plan`/`apply`
- No workspace mutation without explicit `apply` or `--auto`

### Phase 2.7: Scoring Function 📋 Planned

Implement the weighted scoring function from the PRD for ranking repair candidates.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| resolvedWeight calculation | 📋 Planned | Medium | Weighted sum of resolved diagnostics |
| introducedWeight penalty | 📋 Planned | Medium | Weighted penalty (K multiplier) |
| editSize penalty | 📋 Planned | Medium | Tokens/nodes changed (α multiplier) |
| semanticRiskPenalty | 📋 Planned | Medium | Risk-based penalty |

**Scoring Formula (from PRD):**

```
score = resolvedWeight - (introducedWeight × K) - (editSize × α) - semanticRiskPenalty
```

Where:
- `introducedWeight` is typically a hard or near-hard penalty
- `semanticRiskPenalty` follows: imports < guards < coercions < casts

**Note:** Currently using simpler delta-based ranking. This phase adds the full weighted formula.

### Phase 3: Diagnostic Classification ✅ Complete

Classify diagnostics by disposition to guide agent behavior.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| AutoFixable detection | ✅ Done | High | Verified fix, low/medium risk |
| AutoFixableHighRisk detection | ✅ Done | Medium | Verified fix, high risk |
| NeedsJudgment detection | ✅ Done | Medium | Multiple valid fixes |
| NoGeneratedCandidate | ✅ Done | High | Split: no candidate generator coverage |
| NoVerifiedCandidate | ✅ Done | High | Split: candidates exist but none verified helpful |
| Risk scoring heuristics | ✅ Done | Medium | fixName-based low/medium/high |

**NoCandidate split implementation:**

The `NoCandidate` disposition has been split into two distinct dispositions:

| Disposition | Meaning | Implication |
|-------------|---------|-------------|
| `NoGeneratedCandidate` | TypeScript LS returned 0 candidates | Need to expand recipe/fix coverage |
| `NoVerifiedCandidate` | Candidates exist but none verified helpful | LLM judgment required |

Classification rules (strictly based on observed pipeline state):
- If `getCodeFixes()` returns 0 candidates → `NoGeneratedCandidate`
- If `getCodeFixes()` returns ≥1 candidates but all fail verification → `NoVerifiedCandidate`
- No semantic guessing, no LLM involvement in classification

All output formats (text, JSON, compact) preserve the internal distinction.

### Phase 4: Dependency Metadata

Track relationships between repairs for batching.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| conflictsWith detection | ✅ Done | Medium | Overlapping edits in same file |
| requires detection | ✅ Done | Medium | Insertions that require prior edit |
| exclusiveGroup detection | ✅ Done | Low | Same diagnostic targets |
| Batch computation | ✅ Done | Medium | Non-conflicting groups |

### Phase 5: Solver Integration

Fallback to constraint solver when greedy stalls.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Trigger detection | 📋 Planned | Low | Detect when to invoke solver (see conditions below) |
| ILP model | 📋 Planned | Low | Boolean vars, linear constraints |
| MaxSAT alternative | 📋 Planned | Low | Alternative solver backend |
| Bounded candidate window | 📋 Planned | Low | Control solver cost |

**Solver Trigger Conditions (from PRD):**

The planner MUST invoke the solver when any of these conditions are detected:

| Trigger | Description |
|---------|-------------|
| Mutual Exclusivity (XOR) | Two+ candidates resolve overlapping diagnostics but conflict |
| Prerequisite Dependencies | A candidate requires another to avoid introducing errors |
| Greedy Stall | No candidate has positive score, but diagnostics remain |
| Score Ambiguity | Top score within ε of next-best alternatives |
| Batch Dominance | Multiple lower-ranked candidates together outperform best single |
| Candidate Explosion | Pool exceeds threshold (e.g., 15-20 candidates) |

These conditions are machine-detectable, not heuristic.

### Phase 6: Agent Integration

Make ts-repair consumable by agent frameworks.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| MCP tool | 📋 Planned | High | For Claude Code integration |
| Programmatic API | 📋 Planned | High | `import { repair } from 'ts-repair'` |
| Apply mode | 📋 Planned | Medium | `--apply` to write fixes |
| Watch mode | 📋 Planned | Low | Continuous repair on change |

### Phase 7: Protocol Specification

Generalize and publish the oracle-guided repair protocol as a standalone specification.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Protocol spec document | 📋 Planned | Medium | Language-agnostic repair protocol |
| Wire format definition | 📋 Planned | Medium | JSON schema for repair plans |
| Reference implementation | 📋 Planned | Medium | TypeScript impl as reference |
| Protocol versioning | 📋 Planned | Low | Semantic versioning for protocol |
| Default agent policy | 📋 Planned | Medium | Recommended agent behavior per disposition |

**Default Agent Policy (from PRD):**

The protocol should specify recommended agent behavior for each disposition:

| Disposition | Recommended Action |
|-------------|-------------------|
| AutoFixable | Apply automatically |
| AutoFixableHighRisk | Require explicit opt-in before applying |
| NeedsJudgment | Surface to LLM/human with ranked options |
| NoCandidate | Treat as semantic work item (manual fix required) |

**Prerequisites:** Reproducible benchmarks demonstrating value.

**Goal:** Enable other tools and languages to implement compatible repair engines that speak the same protocol, allowing agents to work with any ts-repair-compatible repair tool.

### Phase 8: Multi-Language Support

Extend oracle-guided repair to other languages beyond TypeScript.

| Language | Status | Priority | Notes |
|----------|--------|----------|-------|
| Rust | 📋 Planned | High | Via rust-analyzer LSP |
| Go | 📋 Planned | Medium | Via gopls LSP |
| Python | 📋 Planned | Medium | Via Pyright/Pylance LSP |

**Prerequisites:** Protocol spec complete, TypeScript implementation stable with benchmarks.

**Approach:** Each language adapter implements:
1. Project loader (cargo, go.mod, pyproject.toml)
2. Language service integration (LSP or native)
3. Diagnostic collection
4. Code action/fix retrieval
5. Verification oracle

The core planner, classifier, and output format remain shared.

### Phase 9: Learning (Optional)

Tune scoring weights from historical verification data. This is explicitly optional per the PRD.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Verification result logging | 📋 Planned | Low | Capture outcomes for analysis |
| Weight tuning pipeline | 📋 Planned | Low | Adjust α, K, risk penalties |
| A/B testing framework | 📋 Planned | Low | Compare weight configurations |

**Prerequisites:** Substantial benchmark corpus with ground truth outcomes.

**Note:** Per PRD anti-goals, LLMs are not used as the primary ranking mechanism. Learning here means tuning numeric weights from empirical data, not ML-based ranking.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ts-repair Repair Engine                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
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
│         │                  │                      │              │
│         ▼                  ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Repair Plan Output                        ││
│  │  • Verified steps (ordered)                                  ││
│  │  • Remaining diagnostics (classified)                        ││
│  │  • Machine-readable changes                                  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure (Target)

```
ts-repair/
├── src/
│   ├── index.ts              # Main entry point, public API
│   ├── cli.ts                # CLI interface
│   ├── oracle/
│   │   ├── vfs.ts            # Virtual file system
│   │   ├── typescript.ts     # TypeScript integration
│   │   ├── verify.ts         # Speculative verification
│   │   └── planner.ts        # Repair planning algorithm
│   ├── classify/
│   │   ├── disposition.ts    # Diagnostic classification
│   │   └── risk.ts           # Risk scoring heuristics
│   ├── solver/
│   │   ├── trigger.ts        # Solver trigger detection
│   │   └── ilp.ts            # ILP solver (optional)
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
│   └── ROADMAP.md            # This file
├── package.json
├── tsconfig.json
├── CLAUDE.md                 # Development guidance
└── README.md                 # User-facing docs
```

---

## Code to Delete

The following components from the old ts-repair (language compiler) should be removed:

| Directory | Reason |
|-----------|--------|
| `src/lexer/` | No longer parsing custom language |
| `src/parser/` | No longer parsing custom language |
| `src/types/` | Using TypeScript's type checker |
| `src/refinements/` | Not doing refinement types |
| `src/canonical/` | Not transforming AST |
| `src/codegen/` | Not generating code |
| `src/ast-json/` | Not using custom AST format |
| `src/diagnostics/` | Replacing with new repair system |
| `tests/lexer/` | Old lexer tests |
| `tests/parser/` | Old parser tests |
| `tests/types/` | Old type checker tests |
| `tests/codegen/` | Old codegen tests |
| `tests/refinements/` | Old refinement tests |
| `tests/golden/` | Old golden tests |
| `tests/evaluation/` | Old evaluation suite |
| `docs/SPEC.md` | Language spec (no longer applicable) |
| `docs/REPAIRS.md` | Old repair system |
| `docs/EFFECTS.md` | Effect tracking (no longer applicable) |
| `docs/REFINEMENTS.md` | Refinement types (no longer applicable) |
| `docs/CODEGEN.md` | Code generation (no longer applicable) |
| `docs/AST-JSON.md` | AST format (no longer applicable) |
| `docs/CLI.md` | Old CLI (will be rewritten) |

**Keep:**
- `.mise.toml` — Toolchain config
- `package.json` — Update dependencies
- `tsconfig.json` — TypeScript config
- `.gitignore` — Git ignore rules

---

## Migration Strategy

1. **Create fresh `src/` structure** with new oracle implementation
2. **Keep old code temporarily** in `src-old/` for reference
3. **Migrate tests incrementally** as new features are built
4. **Delete old code** once new implementation is stable

---

## Success Metrics

### Primary: Agent Iteration Reduction

| Metric | Target | Notes |
|--------|--------|-------|
| Token reduction vs raw diagnostics | > 50% | Measured on benchmark set |
| Iteration reduction | > 50% | Compile cycles to zero errors |
| Compiler invocation reduction | > 50% | Agent re-runs of tsc (from PRD) |
| Auto-fix rate | > 50% | Errors fixed without LLM reasoning |

### Secondary: Reliability

| Metric | Target | Notes |
|--------|--------|-------|
| Plans with no regressions | > 99% | No new errors introduced |
| Verified fixes that work | 100% | By definition (oracle-verified) |
| False positive rate | 0% | Never suggest fix that makes things worse |
| Top-1 plan acceptance rate | > 80% | First suggested plan is accepted (from PRD) |

### Tertiary: Performance

| Metric | Target | Notes |
|--------|--------|-------|
| Time to plan (10 errors) | < 5s | Includes all speculative checks |
| Memory overhead | < 2x project size | VFS overhead |

---

## Dependencies

### Required

| Dependency | Purpose |
|------------|---------|
| `typescript` | TypeScript compiler API |

### Optional

| Dependency | Purpose |
|------------|---------|
| `glpk.js` or similar | ILP solver for Phase 5 |
| `@modelcontextprotocol/sdk` | MCP tool integration |

---

## Timeline

| Phase | Target | Notes |
|-------|--------|-------|
| Phase 1 | ✅ Done | Prototype working |
| Phase 2 | ✅ Done | Production implementation |
| Phase 2.5 | ✅ Done | Budget constraints |
| Phase 2.6 | Planned | CLI implementation |
| Phase 2.7 | Planned | Scoring function (from PRD) |
| Phase 3 | ✅ Done | Classification |
| Phase 4 | Planned | Dependency metadata |
| Phase 5 | Planned | Solver (if needed) |
| Phase 6 | Planned | Agent integration (MCP) |
| Phase 7 | After benchmarks | Protocol specification |
| Phase 8 | After protocol | Multi-language support |
| Phase 9 | Optional | Learning (weight tuning) |

---

## Benchmarking

### Agent Benchmark Plan

Benchmark ts-repair against normal tsc + agent workflows to measure concrete savings:

| Metric | Measurement |
|--------|-------------|
| **Token savings** | Repair plan tokens vs raw tsc output tokens |
| **Round savings** | Iterations to zero errors (ts-repair vs raw tsc) |
| **Time savings** | Wall clock time to fully resolve errors |
| **Success rate** | Percentage of errors resolved automatically |

### Benchmark Methodology

1. **Corpus**: Collect real-world TypeScript projects with known errors
2. **Baseline**: Run agent with raw `tsc` output, measure tokens/rounds
3. **ts-repair**: Run agent with ts-repair repair plans, measure tokens/rounds
4. **Analysis**: Calculate reduction percentages, identify error categories with highest savings

### Publishing Results

- Publish benchmark numbers on website and README
- Include methodology for reproducibility
- Update benchmarks with each major release

---

## Known Issues

Issues discovered during ad-hoc benchmarking (January 2026):

### Bug: AutoFixable items not committed to steps

**Severity:** High
**Location:** `src/oracle/planner.ts`

The planner correctly classifies some diagnostics as `AutoFixable` but fails to include them in the `steps` array of the repair plan. This means `apply --auto` has nothing to apply even when AutoFixable repairs exist.

**Reproduction:** Run `ts-repair plan` on a project with `await` expressions in non-async functions. The plan will show `disposition: "AutoFixable"` but `steps: []`.

**Expected:** AutoFixable items should be committed to steps during planning, or the classification should happen after step generation.

### Issue: Multi-file import chains not fully verified

**Severity:** Medium
**Location:** `src/oracle/verify.ts`

When a missing import (e.g., `HTTPError`) is used in multiple files, adding the import to one file doesn't reduce the total error count because the same symbol is still missing elsewhere. The verification correctly returns delta=0, but this causes the fix to be marked as `NoVerifiedCandidate` when it's actually a correct partial fix.

**Possible solutions:**
1. Group related diagnostics across files before verification
2. Allow fixes with delta=0 if they resolve the specific diagnostic
3. Multi-file batched verification

### Observation: Re-export imports vs direct imports

**Severity:** Low
**Location:** `src/oracle/typescript.ts`

TypeScript's code fix suggestions sometimes prefer re-export paths (e.g., `import { X } from '../index.js'`) over direct paths (e.g., `import { X } from '../errors/X.js'`). Both are correct but direct imports are generally preferred for clarity and tree-shaking.

**Note:** This is TypeScript's behavior, not a ts-repair bug. Could potentially be addressed by ranking fixes that use shorter/direct import paths higher.

---

## Scoring Strategy Benchmark

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Benchmark harness | 📋 Planned | Medium | Compare delta vs weighted on real projects |
| Metrics collection | 📋 Planned | Medium | Fix quality, false positives, performance |
| Default selection | 📋 Planned | Low | Choose default based on benchmark results |
| Document non-default | 📋 Planned | Low | Document when to use the other strategy |

**Goal:** Determine which scoring strategy (delta or weighted) should be the default, and document use cases for the other.

**Metrics to measure:**
- Fix quality (do selected fixes resolve issues without side effects?)
- False positive rate (how often are bad fixes selected?)
- Performance (verification count, time to plan)
- Edge case handling (large projects, many candidates)

---

## Open Questions

1. **Incremental checking** — Can we use TypeScript's incremental APIs to speed up verification?
2. **Parallel verification** — Can we check multiple candidates concurrently?
3. **Caching** — Can we cache verification results across runs?
4. **Project scale** — How does this perform on 1000+ file projects?

---

*Last updated: January 18, 2026*
*Roadmap aligned with PRD: added scoring function (2.7), solver triggers (5), agent policy (7), learning (9).*
*Added Known Issues section from ad-hoc benchmark findings.*
*Added Scoring Strategy Benchmark roadmap item.*
