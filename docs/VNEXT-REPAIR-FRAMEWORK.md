# vNext Repair Framework Design

## Summary

This document defines the vNext design for ts-repair: a repair framework that goes beyond lexical fixes by adding synthetic candidate generation, verification cones for structural edits, and a strict no-intent constraint. The system remains oracle-driven and deterministic: candidates are verified by the TypeScript compiler, and only mechanical/type-theoretic edits are proposed.

## Goals

- Expand fix coverage for non-lexical, high fan-out TypeScript failures.
- Preserve monotonic, compiler-verified progress by default.
- Keep performance bounded for large monorepos.
- Output agent-friendly plans with clear risk and rationale.

## Non-Goals

- Do not infer business logic or semantic intent.
- Do not generate runtime adapters or algorithmic changes.
- Do not depend on LLMs for correctness or ranking.

## Constraints: No Intent (Hard Line)

Allowed edits (mechanical/type-theoretic only):

- Widen/narrow types in signatures.
- Add/remove overloads using bounded templates.
- Adjust generic constraints/defaults in bounded ways.
- Toggle conditional distribution patterns.
- Add depth bounds for recursive types.
- Normalize module specifiers or tsconfig flags with known semantics.

Disallowed edits (intentful):

- Runtime logic to adapt values between shapes.
- Choosing between multiple plausible APIs without a mechanical rule.
- Algorithmic refactors or code synthesis.
- Mass suppressions (`@ts-expect-error`) or default `any` escapes.

## Core Model: CandidateFix

All candidates (TS codefix + synthetic) share a single representation:

```ts
type CandidateFix =
  | {
      kind: "tsCodeFix";
      fixName: string;
      description: string;
      action: ts.CodeFixAction;
      scopeHint?: VerificationScopeHint;
      riskHint?: "low" | "medium" | "high";
      tags?: string[];
    }
  | {
      kind: "synthetic";
      fixName: string;
      description: string;
      changes: FileChange[];
      scopeHint?: VerificationScopeHint;
      riskHint?: "low" | "medium" | "high";
      tags?: string[];
      metadata?: Record<string, unknown>;
    };
```

## Verification Cone of Attention

Structural edits can reduce errors in other files. Verification must compare before/after diagnostics over the same cone:

```ts
type VerificationScopeHint = "modified" | "errors" | "wide";
```

Cone construction per candidate:

1. `modifiedFiles = files touched by candidate`.
2. Base cone = `modifiedFiles`.
3. Expand using `scopeHint` or heuristics:
   - `modified`: keep as-is.
   - `errors`: `modifiedFiles ∪ filesWithErrors`.
   - `wide`: `modifiedFiles ∪ filesWithErrors ∪ reverseDeps(modifiedFiles)` (approx) or `topKErrorFiles`.

Verification steps:

1. `before = diagnostics(cone)` (cacheable per iteration + cone signature).
2. Apply candidate edits.
3. `after = diagnostics(cone)`.
4. Restore snapshot.
5. Delta computed on the cone; introduced diagnostics are compared against `before`.

Performance controls:

- Cache `before` diagnostics per cone signature per iteration.
- Cap cone size via top-K error files.
- Host reset guard for memory growth.

## Verification Policy API (vNext)

Focused verification must be policy-based so structural fixes can widen scope while keeping fast paths for lexical changes.

```ts
type VerificationScope = "modified" | "errors" | "wide";

interface VerificationPolicy {
  defaultScope: VerificationScope;
  allowRegressions: boolean;
  maxConeFiles: number;
  maxConeErrors: number;
  coneExpansion: {
    includeErrors: boolean;
    includeReverseDeps: boolean;
    topKErrorFiles: number;
  };
  cacheBeforeDiagnostics: boolean;
  cacheKeyStrategy: "cone" | "cone+iteration";
  hostInvalidation: "modified" | "cone" | "full";
}
```

Policy usage:

- Candidate `scopeHint` is a default input; the policy may widen or cap the cone.
- Post-commit diagnostics should use the policy scope for refresh (not only modified files).
- Host invalidation can widen from `notifySpecificFilesChanged` to `notifyFilesChanged` for wide cones.

Default policy (fast path):

- `defaultScope: "modified"`.
- `includeErrors: true` only for structural edits or candidates tagged with `scopeHint: "errors" | "wide"`.
- `hostInvalidation: "modified"` unless the cone expands beyond modified files.

## Solution Builders

Builders produce small, template-based candidate sets for non-lexical failures.

```ts
interface SolutionBuilder {
  name: string;
  matches(ctx: BuilderContext): boolean;
  generate(ctx: BuilderContext): CandidateFix[];
}
```

Routing is cheap and explainable:

- Diagnostic code/message patterns.
- AST node kind near diagnostic.
- Optional project cues (types/core/config files).

### Initial Builder Set

1. OverloadRepairBuilder
   - Targets overload/call signature mismatch.
   - Candidates: widen params, add overload template, relax constraints.
   - Scope: `errors` or `wide`.
   - Risk: high.

2. GenericConstraintBuilder
   - Targets constraint failures/inference collapse.
   - Candidates: relax `extends`, widen defaults.
   - Scope: `errors`.

3. ConditionalTypeDistributionBuilder
   - Targets distribution issues.
   - Candidates: toggle `T extends U ?` ↔ `[T] extends [U] ?`.
   - Scope: `errors` or `wide`.

4. InstantiationDepthBuilder
   - Targets instantiation depth failures.
   - Candidates: add depth param + bailout branch in recursive types.
   - Scope: `wide`.

5. ModuleConfigBuilder
   - Targets module resolution/config errors.
   - Candidates: config template adjustments, specifier normalization.
   - Scope: `errors`.

All builders:

- Produce bounded candidate sets (1-6).
- Use mechanical templates only.
- Default to high risk unless explicitly safe.

## Planner Integration

Pipeline changes:

1. Collect candidates from TS codefixes and builders.
2. Merge/dedupe/prune using existing risk + diff-size scoring.
3. Verify using cone-of-attention.
4. Score via existing strategies.
5. Update dispositions using synthetic candidate presence.

Disposition updates:

- `NoGeneratedCandidate`: neither TS nor builders produced candidates.
- `NoVerifiedCandidate`: candidates existed but none verified under cone rules.

## Safety Constraints

- Reject candidates that introduce new diagnostics by default.
- Allow regressions only in explicit opt-in mode, with high-risk labeling.
- No runtime logic, no mass suppressions, no default `any`.

## Verification Criteria

1. Monotonic improvement (default): `errorsAfter < errorsBefore` on cone.
2. Target removed: candidate must clear its target diagnostic.
3. No new diagnostics (default): introduced diagnostics reject candidate.
4. Final global check: reduced total errors after plan.

## Instrumentation

- Builder hit rate, candidate count, verification time.
- Cone size distribution and cache hits.
- Verified delta distribution per builder.

## Benchmark v2 Target (tRPC Structural Failure)

Objective: demonstrate ts-repair can resolve a high-fan-out, non-lexical TypeScript failure by repairing a single structural root cause (core overload/constraint/type) that collapses downstream errors in a verified pass. This benchmark is necessary but not sufficient for success.

Workload:

- Repo: tRPC monorepo, two identical broken copies.
- Mutation: single regression in a central polymorphic/overloaded API surface.
- Failure class: type-level construct edit (overload, constraint, conditional type, signature).
- Expected errors: 100-400 cascading call-site failures.

Experimental setup:

- Manual session: Claude Code without ts-repair.
- ts-repair session: Claude Code with ts-repair enabled.
- Controls: same model, no `.git`, fresh sessions, same TypeScript/deps.

Success criteria:

- Structural root-cause fix is proposed and verified.
- Total errors strictly reduced; root diagnostic removed.
- Fewer iterations and compiler checks than manual session.
- Final outcome reached via upstream declaration repair, not scattered local edits.

Metrics captured:

- Time to green, planning iterations, token usage, cache reads/writes.
- Bash/tsc invocations, candidates verified, cone sizes.
- Files touched by final fix and error delta.
- Count of call-site edits vs declaration edits.

## Open Questions

- Best reverse-dependency approximation strategy.
- When to favor AST transforms vs text edits.
- Presentation for high-risk structural fixes to agents.
