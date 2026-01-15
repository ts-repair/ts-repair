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

### Phase 2.5: Budget Constraints 📋 Planned

Add verification budget as a first-class constraint in the Planner + Verification layers.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Candidates per diagnostic | 📋 Planned | High | Cap candidates considered per diagnostic |
| Candidates per iteration | 📋 Planned | High | Cap total candidates per planning iteration |
| Total verification budget | 📋 Planned | High | Cap total verification runs per plan |
| Pre-verification pruning | 📋 Planned | High | Prune by cheap priors before verification |
| Graceful degradation | 📋 Planned | High | Return partial plan when budget exhausted |
| Budget counters in output | 📋 Planned | Medium | Report usage for tuning thresholds |

**Design notes:**
- Budget constraints live in Planner + Verification layers, NOT in CLI or output formatting
- Candidate generation may emit more than budget; Planner prunes before calling Verification
- Pruning heuristics: fix-kind, locality, diff size, risk class (cheap priors)
- When budget exhausted: return best verified partial plan + remaining classified as NeedsJudgment/NoCandidate
- Output must include budget counters (candidatesGenerated, candidatesVerified, budgetRemaining)

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
| conflictsWith detection | 📋 Planned | Medium | XOR: can't apply together |
| requires detection | 📋 Planned | Medium | Prerequisites |
| exclusiveGroup detection | 📋 Planned | Low | Exactly-one-of |
| Batch computation | 📋 Planned | Medium | Non-conflicting groups |

### Phase 5: Solver Integration

Fallback to constraint solver when greedy stalls.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Trigger detection | 📋 Planned | Low | When to invoke solver |
| ILP model | 📋 Planned | Low | Boolean vars, linear constraints |
| MaxSAT alternative | 📋 Planned | Low | Alternative solver backend |
| Bounded candidate window | 📋 Planned | Low | Control solver cost |

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
| Auto-fix rate | > 50% | Errors fixed without LLM reasoning |

### Secondary: Reliability

| Metric | Target | Notes |
|--------|--------|-------|
| Plans with no regressions | > 99% | No new errors introduced |
| Verified fixes that work | 100% | By definition (oracle-verified) |
| False positive rate | 0% | Never suggest fix that makes things worse |

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
| Phase 3 | Week 2-3 | Classification |
| Phase 4 | Week 3-4 | Dependency metadata |
| Phase 5 | Week 5+ | Solver (if needed) |
| Phase 6 | Week 2+ | Agent integration (parallel) |
| Phase 7 | After benchmarks | Protocol specification |
| Phase 8 | After protocol | Multi-language support |

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

## Open Questions

1. **Incremental checking** — Can we use TypeScript's incremental APIs to speed up verification?
2. **Parallel verification** — Can we check multiple candidates concurrently?
3. **Caching** — Can we cache verification results across runs?
4. **Project scale** — How does this perform on 1000+ file projects?

---

*Last updated: January 17, 2026*
*Phase 3 complete. NoCandidate split into NoGeneratedCandidate/NoVerifiedCandidate. Next: Budget constraints (2.5) or MCP integration (6)*
