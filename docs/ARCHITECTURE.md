# Architecture

ts-repair is an oracle-guided agent ↔ compiler protocol for TypeScript repairs. It converts raw TypeScript diagnostics into a verified, ranked repair plan by speculatively applying candidate fixes in-memory and re-running the TypeScript checker to measure the exact diagnostic delta.

The core design principle is separation of concerns: mechanical, compiler-verifiable work is handled deterministically by ts-repair; semantic intent is surfaced as "NeedsJudgment" with ranked options.

## System Overview

At a high level, ts-repair is an optimizing "repair pass" over a TypeScript project:

- Inputs: `tsconfig.json` (project root), source files, and optional policy settings
- Oracle: TypeScript LanguageService + Program type-checking
- Output: Verified Repair Plan (ordered edits) + per-diagnostic dispositions

The system is a repair framework: it unifies TypeScript codefixes with synthetic candidates, verifies them with a compiler oracle, and preserves a hard line against intentful changes. See `docs/VNEXT-REPAIR-FRAMEWORK.md` for vNext constraints.

## Major Components

### 1) Project Loader
Responsible for loading and normalizing project configuration.

- Reads `tsconfig.json`
- Resolves file list, compiler options, and module resolution context
- Builds a stable project identity for caching (config + file hashes)

### 2) Virtual File System (VFS)
A snapshot-capable in-memory filesystem used for speculative evaluation.

Responsibilities:
- Provide read/write views for TypeScript hosts
- Support fast snapshot/restore for candidate verification
- Track changed files and incremental invalidation

Key properties:
- Deterministic: same inputs yield same file contents
- Cheap branching: cloning is logical (copy-on-write), not full duplication when possible

### 3) TypeScript Oracle
The verification authority. It provides diagnostics and (optionally) tsserver code fixes.

Responsibilities:
- Collect diagnostics (syntactic + semantic)
- Provide code-fix candidates via LanguageService where available
- Re-typecheck after speculative edits (incremental preferred)
- Produce stable, comparable diagnostic identities (code + file + span)

Important: ts-repair does not "trust" a suggested fix. It only trusts the oracle's measured delta after applying it.

### 4) Candidate Generation
Candidate generation is intentionally pluggable and split into sources.

Primary sources:
- TypeScript LanguageService codefixes (`getCodeFixesAtPosition`) for baseline coverage.
- Synthetic solution builders for non-lexical failures (structural edits that are still mechanical).

Output:
- A unified `CandidateFix` set with edits and intended targets (may be multi-diagnostic).

### 5) Verification Engine
The engine that turns candidates into verified claims.

For each candidate:
1. Snapshot VFS state
2. Compute the verification cone for this candidate
3. Collect `before` diagnostics over the cone
4. Apply candidate edits
5. Collect `after` diagnostics over the same cone
6. Compute `verifiedDelta` (resolved vs introduced diagnostics)
7. Restore snapshot

It also derives scoring signals:
- resolvedWeight / introducedWeight (weighted by diagnostic severity/classes)
- editSize (tokens changed or AST nodes affected)
- semanticRisk class (policy-driven classification)

Candidates without `verifiedDelta` are ineligible for selection.

### 6) Verification Cone of Attention
Structural edits can reduce errors in other files, so verification scopes are per-candidate.

Cone construction uses:
- Modified files (always included).
- Files with current errors (structural default).
- Optional wider scope using reverse-deps approximation or top-K error files.

The cone is deterministic and cacheable by signature per iteration. See `docs/VNEXT-REPAIR-FRAMEWORK.md` for scope hints and guards.

### 7) Disposition Classifier
Classifies each diagnostic after candidate generation + verification.

Recommended disposition contract:
- AutoFixable: verified fix exists and at least one is low-risk
- AutoFixableHighRisk: verified fixes exist but all are high-risk
- NeedsJudgment: multiple verified candidates with comparable scores; intent ambiguous
- NoCandidate: no generated candidate verifies (optionally split internally into NoGeneratedCandidate vs NoVerifiedCandidate)

This is the core boundary between deterministic automation and semantic decision-making.

### 8) Planner
Selects an ordered plan of repairs.

Planner modes:
- Greedy default: select the best next candidate under a monotonic objective
- Solver fallback: select an optimal set of candidates under constraints when greedy assumptions break

Greedy properties:
- Prefers candidates with high verified diagnostic reduction
- Penalizes introduced diagnostics heavily (often near-hard constraint)
- Penalizes large diffs and risky repair classes
- Produces a virtual plan by applying chosen candidates in-memory, re-generating candidates, and repeating until convergence or stall

### 9) Solver (Fallback)
A constraint optimizer invoked only when trigger conditions are met.

Model:
- Boolean variable per candidate
- Constraints: conflicts, requires, exclusive groups, overlapping spans
- Objective: maximize verified reduction, minimize introduced diagnostics, minimize risk and edit size

The solver always runs on a bounded candidate window to control cost.

## Candidate Metadata

A candidate is a "patch + verified claim."

Minimum fields the planner/solver require:
- `id`
- `changes[]` (file, span, newText)
- `targets[]` (diagnostic refs; may be 1..N)
- `verifiedDelta` (resolved[], introduced[], remainingCount)
- `editSize`
- `semanticRisk` (low/medium/high or similar)
- `conflictsWith[]` (optional)
- `requires[]` (optional)
- `exclusiveGroup` (optional)
- `filesTouched[]`
- `scopeHint` (optional; guides verification cone)

These fields are derived from deterministic sources and oracle verification, not LLM judgment.

## Solver Trigger Conditions

The planner must invoke the solver when any of the following are detected:

1. Mutual exclusivity (XOR): candidates conflict while addressing overlapping diagnostics.
2. Prerequisites: a candidate requires another to avoid regressions or to become applicable.
3. Greedy stall: no candidate yields positive net improvement but diagnostics remain.
4. Score ambiguity: top scores are within a small epsilon and differ in intent-bearing dimensions.
5. Batch dominance: multiple compatible candidates together outperform the best single candidate due to conflicts.
6. Candidate explosion: candidate pool exceeds a configured threshold and greedy becomes unstable.

These are designed to be machine-detectable, not heuristic vibes.

## Performance Model and Guardrails

ts-repair trades CPU for fewer agent iterations. To keep the system bounded:

- Candidate budget: cap candidates per iteration / per diagnostic / per plan.
- Verification budget: cap typecheck runs per plan; degrade gracefully to "NeedsJudgment" if exhausted.
- Incremental checking: prefer TS incremental program updates for verification.
- Caching: cache verification results keyed by (project state hash, candidate patch hash).
- Bounded solver window: never solve over an unbounded set.
- Cone caps: top-K error file selection to keep verification bounded.

## Outputs

### Verified Repair Plan
The primary output is an ordered plan:

- Project status: diagnostics before → after
- Steps: file edits with spans and text
- For each step: verifiedDelta summary and ordering rationale

### Machine Contract
ts-repair also returns:
- Remaining diagnostics with dispositions
- Candidate set (optionally truncated) for agents that want to choose among "NeedsJudgment" options
- Policy metadata (what was auto-applied vs withheld)

## Integration Surface

ts-repair is designed to be consumed by agent frameworks:

- CLI: `ts-repair repair <path/to/tsconfig> [--apply] [--json]`
- Programmatic API: `repair({ project, policy }) -> RepairResponse`
- MCP tool: for agent environments that prefer tool calls over subprocess execution

Apply mode is intentionally deterministic: apply only what is classified as AutoFixable under the current policy, unless overridden.
