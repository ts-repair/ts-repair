# ts-repair Implementation Roadmap

**Version:** 0.2.0 (Oracle-Guided TypeScript Repair)
**Target Runtime:** Node.js / Bun

---

## Overview

This roadmap tracks the implementation of ts-repair as an **oracle-guided TypeScript repair engine**. The system uses the TypeScript compiler as a verification oracle to produce verified, ranked repair plans for agents.

**Priority note:** The vNext roadmap items below are higher priority than the long-term phases that follow. See `docs/VNEXT-REPAIR-FRAMEWORK.md` for the design context and constraints.

---

## vNext: Repair Framework (Higher Priority)

### Phase 0: Foundations ✅ Complete

Unified candidate abstraction and verification infrastructure.

| Component | Status | Notes |
|-----------|--------|-------|
| `CandidateFix` type | ✅ Done | Union type for tsCodeFix + synthetic candidates |
| `wrapTsCodeFix()` helper | ✅ Done | Wrap TS CodeFixAction as CandidateFix |
| `createSyntheticFix()` helper | ✅ Done | Create synthetic candidates with metadata |
| `getFilesModified()` | ✅ Done | Extract modified files from any candidate |
| `getChanges()` | ✅ Done | Extract FileChange[] from any candidate |
| `applyCandidate()` | ✅ Done | Apply candidate to VFS with normalization |
| `normalizeEdits()` | ✅ Done | Sort and dedupe edits for safe application |
| `computeCandidateEditSize()` | ✅ Done | Calculate edit size for scoring |
| `getCandidateKey()` | ✅ Done | Generate unique key for deduplication |
| `deduplicateCandidates()` | ✅ Done | Remove duplicate candidates across sources |
| `VerificationScopeHint` type | ✅ Done | Scope hints: modified, errors, wide |
| `VerificationPolicy` type | ✅ Done | Policy for cone construction and caching |
| `buildCone()` | ✅ Done | Build verification cone from modified files |
| `ConeCache` | ✅ Done | Cache diagnostics by cone signature |
| `verifyWithCone()` | ✅ Done | Unified verification using cone-based approach |
| Policy presets | ✅ Done | DEFAULT_POLICY, STRUCTURAL_POLICY, WIDE_POLICY |
| `mergePolicy()` | ✅ Done | Merge partial policy with defaults |
| Reverse deps lookup | ✅ Done | `getApproximateReverseDeps()` for cone expansion |

**Location:** `src/oracle/candidate.ts`, `src/oracle/cone.ts`, `src/oracle/policy.ts`, `src/output/types.ts`

**Design context:** `docs/VNEXT-REPAIR-FRAMEWORK.md`

### Phase 1: Builder Framework + Routing ✅ Complete

Pluggable builder framework for synthetic repair candidates.

| Component | Status | Notes |
|-----------|--------|-------|
| `SolutionBuilder` interface | ✅ Done | name, description, diagnosticCodes, messagePatterns, matches(), generate() |
| `BuilderContext` interface | ✅ Done | diagnostic, host, filesWithErrors, AST access |
| `BuilderMatchResult` type | ✅ Done | For debugging/logging match results |
| `BuilderRegistry` class | ✅ Done | Register, index, and query builders |
| `register()` | ✅ Done | Add builder with code/pattern indexing |
| `getCandidateBuilders()` | ✅ Done | O(1) lookup by diagnostic code |
| `getMatchingBuilders()` | ✅ Done | Filter by matches() result |
| `generateCandidates()` | ✅ Done | Collect candidates from all matching builders |
| `createBuilderContext()` | ✅ Done | Factory with lazy AST loading |
| `findNodeAtPosition()` | ✅ Done | Helper for AST node lookup |
| `defaultRegistry` singleton | ✅ Done | Global registry for convenience |
| `registerBuilder()` helper | ✅ Done | Register to default registry |
| Planner integration | ✅ Done | `getAllCandidates()` merges TS + builder candidates |
| `pruneCandidatesUnified()` | ✅ Done | Prune CandidateFix[] by risk/size |
| `assessRisk()` with riskHint | ✅ Done | Use builder hint or assess from fixName |
| Classification integration | ✅ Done | `classifySingleDiagnostic()` includes builders |
| `useBuilders` option | ✅ Done | Enable/disable builder candidates (default: true) |
| `builderRegistry` option | ✅ Done | Custom registry support |
| Builder tests | ✅ Done | Comprehensive unit tests for registry and context |

**Location:** `src/oracle/builder.ts`, `src/oracle/planner.ts`, `tests/oracle/builder.test.ts`

**Design context:** `docs/VNEXT-REPAIR-FRAMEWORK.md`

### Phase 2: Overload Repair Builder ✅ Complete

First concrete builder implementation targeting overload mismatch errors.

| Component | Status | Notes |
|-----------|--------|-------|
| Overload mismatch detection | ✅ Done | Detect TS2769 at call expressions |
| Definition lookup | ✅ Done | Find overload signatures across project files |
| Add overload template | ✅ Done | Generate compatible overload signature from impl params |
| Duplicate detection | ✅ Done | Prevent infinite loops by checking existing overloads |
| `scopeHint: "wide"` | ✅ Done | Triggers cone-based verification with reverse deps |
| `riskHint: "high"` | ✅ Done | Requires `--include-high-risk` flag |
| Overload fixtures | ✅ Done | `tests/fixtures/overload-mismatch/` |
| Builder tests | ✅ Done | `tests/oracle/builders/overload.test.ts` |
| CLI integration | ✅ Done | `registerBuiltinBuilders()` in cli.ts |
| Cone-based verification | ✅ Done | `verifyWithCone()` for synthetic candidates |

**Location:** `src/oracle/builders/overload.ts`, `src/oracle/builders/index.ts`

**Design context:** `docs/VNEXT-REPAIR-FRAMEWORK.md`

### Phase 3: Cone Refinement + Guardrails ✅ Complete

Robust verification for structural edits at scale.

| Component | Status | Notes |
|-----------|--------|-------|
| `rankErrorFiles()` | ✅ Done | Score error files by relationship to modified files |
| Top-K error file expansion | ✅ Done | Cap cone size with ranked selection |
| `ConeCache` LRU eviction | ✅ Done | Bounded cache with hit/miss tracking |
| `MemoryGuard` class | ✅ Done | Periodic host reset to prevent memory growth |
| `refreshLanguageService()` | ✅ Done | Enable memory reclamation in TypeScriptHost |
| `TelemetryCollector` class | ✅ Done | Track verifications, timing, cone sizes, cache stats |
| `--telemetry` CLI flag | ✅ Done | Output verification performance stats |
| `enableTelemetry` option | ✅ Done | Enable telemetry in RepairRequest |
| `memoryConfig` option | ✅ Done | Configure memory guard in RepairRequest |
| Memory/telemetry tests | ✅ Done | Unit tests + stress tests |

**Location:** `src/oracle/cone.ts`, `src/oracle/memory.ts`, `src/oracle/telemetry.ts`, `src/oracle/planner.ts`

**Design context:** `docs/VNEXT-REPAIR-FRAMEWORK.md`

### Phase 4: Additional Builders (Benchmark-Driven) ✅ Complete

Additional builders based on benchmark-identified gaps.

| Component | Status | Notes |
|-----------|--------|-------|
| Module extension repair | ✅ Done | TS2835: Add `.js` extensions to ESM imports |
| Generic constraint repair | ✅ Done | TS2344: Add missing members to satisfy constraints |
| Conditional type distribution | ✅ Done | TS2322/2345/2536: Tuple-wrap to disable distribution |
| Instantiation depth | ✅ Done | TS2589: Intersection reset pattern for deep recursion |

**Location:** `src/oracle/builders/`, see `docs/ERROR-CODE-MAPPING.md` for full mapping

**Design context:** `docs/VNEXT-REPAIR-FRAMEWORK.md`

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

### Phase 2.6: CLI Implementation ✅ Complete

Full CLI implementation as specified in [docs/CLI.md](CLI.md).

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| `ts-repair tsc` command | ✅ Done | High | tsc-compatible passthrough with `--plan` and `--auto` flags |
| `ts-repair check` command | ✅ Done | High | Convenience wrapper for `tsc --noEmit` |
| `ts-repair plan` command | ✅ Done | High | Generate verified repair plan |
| `ts-repair apply` command | ✅ Done | High | Apply repairs from plan or `--auto` mode |
| `ts-repair explain` command | ✅ Done | Medium | Explain specific repair candidates |
| `ts-repair repair` command | ✅ Done | High | Combined plan + optional apply |
| `ts-repair preview` command | ✅ Done | Medium | Preview budget impact without verification |
| Global options | ✅ Done | High | `-p/--project`, `--format`, `--verbose` |
| Exit codes | ✅ Done | High | 0=clean, 1=diagnostics remain, 2=tool error |
| `tsr` alias | 📋 Planned | Low | Optional convenience alias |

**Implementation notes:**
- Drop-in compatible with existing `tsc` workflows
- Deterministic and scriptable for agents and CI
- Default format: text for `tsc`/`check`/`repair`, json for `plan`/`apply`
- No workspace mutation without explicit `apply` or `--auto`

### Phase 2.7: Scoring Function ✅ Complete

Configurable scoring strategies for ranking repair candidates.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Delta scoring strategy | ✅ Done | High | Simple `errorsBefore - errorsAfter` (default) |
| Weighted scoring strategy | ✅ Done | Medium | Full weighted formula with penalties |
| resolvedWeight calculation | ✅ Done | Medium | Weighted sum of resolved diagnostics |
| introducedWeight penalty | ✅ Done | Medium | Weighted penalty (K=4 multiplier) |
| editSize penalty | ✅ Done | Medium | Tokens changed (α=0.0015 multiplier) |
| semanticRiskPenalty | ✅ Done | Medium | Risk-based penalty (low=0, medium=0.75, high=2.0) |
| `--scoring-strategy` flag | ✅ Done | Medium | CLI option to select strategy |
| Configurable weights | ✅ Done | Low | Via `scoreWeights` in RepairRequest |

**Scoring Formula (weighted strategy):**

```
score = resolvedWeight - (introducedWeight × K) - (editSize × α) - semanticRiskPenalty
```

**Default weights:**
- `introducedMultiplier` (K): 4
- `editSizeAlpha` (α): 0.0015
- `riskPenalty`: low=0, medium=0.75, high=2.0

**Usage:** `ts-repair repair --scoring-strategy weighted`

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

### Phase 4: Dependency Metadata ✅ Complete

Track relationships between repairs for batching.

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| conflictsWith detection | ✅ Done | Medium | Overlapping edits in same file |
| requires detection | ✅ Done | Medium | Insertions that require prior edit |
| exclusiveGroup detection | ✅ Done | Low | Same diagnostic targets |
| Batch computation | ✅ Done | Medium | Non-conflicting groups via `deriveDependencies()` |
| FixDependencies type | ✅ Done | Medium | Structured dependency metadata per fix |
| Batches in RepairPlan | ✅ Done | Medium | `batches` array of compatible fix groups |

**Implementation notes:**
- Each `VerifiedFix` includes `dependencies: FixDependencies`
- `deriveDependencies()` computes conflicts from overlapping edit ranges
- `RepairPlan.batches` contains arrays of fix IDs that can be applied together
- Agents can apply entire batches without re-verification

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

### Phase 6: Agent Integration ✅ Complete

Make ts-repair consumable by agent frameworks via Model Context Protocol (MCP).

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| MCP server | ✅ Done | High | `ts-repair mcp-server` command |
| ts_repair_plan tool | ✅ Done | High | Generate verified repair plan via MCP |
| ts_repair_apply tool | ✅ Done | High | Apply verified repairs via MCP |
| ts_repair_check tool | ✅ Done | High | Quick error count via MCP |
| Claude Code skill | ✅ Done | High | Skill file in `skills/claude-code/` |
| OpenCode skill | ✅ Done | High | Skill file in `skills/opencode/` |
| Codex CLI skill | ✅ Done | High | Skill file in `skills/codex/` |
| Agent integration docs | ✅ Done | High | `docs/AGENT_INTEGRATION.md` |
| Programmatic API | ✅ Done | High | `import { repair } from 'ts-repair'` (existing) |
| Apply mode | ✅ Done | Medium | `--apply` flag (existing) |
| Watch mode | 📋 Planned | Low | Continuous repair on change |

**Implementation notes:**
- MCP server implemented in `src/mcp/server.ts` using `@modelcontextprotocol/sdk`
- Server communicates over stdio using JSON-RPC (Model Context Protocol)
- Skills teach agents when/how to use ts-repair for TypeScript error fixing
- Compatible with Claude Code, OpenCode, and Codex CLI

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

## Project Structure

```
ts-repair/
├── src/
│   ├── index.ts              # Main entry point, public API
│   ├── cli.ts                # CLI interface
│   ├── oracle/
│   │   ├── vfs.ts            # Virtual file system
│   │   ├── typescript.ts     # TypeScript integration
│   │   ├── logger.ts         # Budget logging
│   │   └── planner.ts        # Repair planning algorithm
│   ├── classify/
│   │   └── disposition.ts    # Diagnostic classification
│   └── output/
│       ├── format.ts         # Output formatting
│       └── types.ts          # Type definitions
├── tests/
│   ├── oracle/               # Oracle behavior tests
│   ├── golden/               # Snapshot-based tests
│   ├── output/               # Output formatting tests
│   └── fixtures/             # Test TypeScript projects
├── docs/
│   ├── PRD.md                # Product requirements
│   ├── ROADMAP.md            # This file
│   └── CLI.md               # CLI reference
├── package.json
├── tsconfig.json
├── CLAUDE.md                 # Development guidance
└── README.md                 # User-facing docs
```

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
| `@modelcontextprotocol/sdk` | MCP server for agent integration |
| `zod` | Schema validation for MCP tools |

### Optional

| Dependency | Purpose |
|------------|---------|
| `glpk.js` or similar | ILP solver for Phase 5 |

---

## Timeline

### vNext Phases (Higher Priority)

| Phase | Status | Notes |
|-------|--------|-------|
| vNext Phase 0 | ✅ Done | Foundations (CandidateFix, cones, policy) |
| vNext Phase 1 | ✅ Done | Builder framework + routing |
| vNext Phase 2 | ✅ Done | Overload repair builder |
| vNext Phase 3 | ✅ Done | Cone refinement + guardrails |
| vNext Phase 4 | ✅ Done | Additional builders (4 total: Module, Constraint, Distribution, Depth) |

### Core Phases

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | ✅ Done | Prototype working |
| Phase 2 | ✅ Done | Production implementation |
| Phase 2.5 | ✅ Done | Budget constraints |
| Phase 2.6 | ✅ Done | CLI implementation (all commands) |
| Phase 2.7 | ✅ Done | Scoring function (delta + weighted) |
| Phase 3 | ✅ Done | Classification |
| Phase 4 | ✅ Done | Dependency metadata + batching |
| Phase 5 | 📋 Planned | Solver (if needed) |
| Phase 6 | ✅ Done | Agent integration (MCP + Skills) |
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

### Observation: Re-export imports vs direct imports

**Severity:** Low

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

*Last updated: January 20, 2026*
*Phases 1-4, 2.5-2.7, 6 complete. vNext Phases 0-4 complete.*
