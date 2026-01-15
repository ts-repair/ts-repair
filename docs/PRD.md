# Product Requirements Document (PRD)

## Product Name

Oracle-Guided TypeScript Repair Engine (OGTRE)

## Problem Statement

Modern agents and IDE tooling receive TypeScript compiler diagnostics but lack a reliable, low-iteration way to resolve them autonomously. Existing mechanisms (LSP code actions, raw diagnostics, or LLM-only loops) are:

* Heuristic, not verified
* Cursor-local, not global
* Sequential, not batched
* Prone to cascading errors and iteration thrash

As a result, agents must speculate, apply fixes, re-run the compiler, and repeat—burning tokens and time.

## Goal

Provide an **oracle-driven repair system** that:

* Produces **verified**, **ranked**, and **batchable** repair plans
* Minimizes agent iterations by precomputing monotonic paths to zero diagnostics
* Guarantees no *new compiler diagnostics* are introduced by proposed fixes
* Operates on **TypeScript source text**, while using AST internally for determinism

## Non-Goals

* Guarantee semantic correctness or runtime behavior preservation
* Replace TypeScript compiler or language service
* Perform speculative logic synthesis beyond type-level correctness

## Anti-Goals (Explicitly Out of Scope)

The following are *explicit anti-goals* to prevent scope creep and agent overreach:

* **Do not invent new language syntax or require users to write non-TypeScript code**
* **Do not require LLMs to reason over or emit AST/JSON representations**
* **Do not attempt to infer developer intent beyond compiler-verifiable evidence**
* **Do not apply fixes that introduce new compiler diagnostics unless explicitly allowed**
* **Do not use LLMs as the primary ranking or decision mechanism**
* **Do not attempt whole-program semantic refactoring (logic changes, algorithm changes)**
* **Do not rely on historical training data for correctness claims (verification > learning)**
* **Do not optimize for IDE UX; optimize for agent autonomy and determinism**

---

## High-Level Approach

The system treats the TypeScript compiler as a **truth oracle**.

For each candidate repair, the system:

1. Applies the repair to an in-memory project snapshot
2. Re-runs the TypeScript type checker
3. Measures the diagnostic delta (resolved vs introduced)
4. Uses this verified data to rank and select repairs

Agents receive a **Verified Repair Plan** instead of raw diagnostics or speculative suggestions.

---

## Core Algorithm (Greedy + Solver Hybrid)

### Default Loop (Greedy)

```
while diagnostics > 0:
  generate candidate repairs
  verify each candidate independently
  score candidates
  select best candidate
  commit candidate
```

This loop is fast and sufficient for the majority of cases.

### Solver Fallback

A constraint solver is invoked when greedy assumptions break (see Trigger Conditions below). The solver selects an optimal **set** of repairs under constraints.

---

## Repair Candidate Model

Each repair candidate represents a **verified claim** about compiler behavior.

### Required Metadata

```ts
interface RepairCandidate {
  id: string;

  // Patch
  changes: FileChange[];

  // Diagnostics
  targets: DiagnosticRef[];        // Diagnostics this repair intends to resolve
  verifiedDelta: {
    resolved: DiagnosticRef[];
    introduced: DiagnosticRef[];
    remainingCount: number;
  };

  // Scoring signals
  resolvedWeight: number;          // Weighted sum of resolved diagnostics
  introducedWeight: number;        // Weighted sum of introduced diagnostics
  editSize: number;                // Tokens or AST nodes changed
  semanticRisk: 'low' | 'medium' | 'high';

  // Structural constraints
  conflictsWith?: string[];        // XOR: cannot apply together
  requires?: string[];             // Prerequisites
  exclusiveGroup?: string;         // Exactly-one-of group

  // Bookkeeping
  filesTouched: string[];
}
```

### Notes

* A repair may target **multiple diagnostics** (e.g. import fixes, renames)
* All scoring fields are derived from **verification**, not heuristics alone

---

## Verification Oracle

Verification is mandatory for all candidates:

1. Clone in-memory project state
2. Apply candidate changes
3. Re-run incremental type check
4. Record diagnostic delta

Candidates that introduce new diagnostics may still be retained, but are penalized or restricted by policy.

---

## Scoring Function

Repairs are ranked using a weighted objective:

```
score =
  + resolvedWeight
  - introducedWeight * K
  - editSize * α
  - semanticRiskPenalty
```

Where:

* `introducedWeight` is typically a hard or near-hard penalty
* `semanticRiskPenalty` is heuristic (imports < guards < coercions < casts)

---

## Solver Trigger Conditions

The system MUST invoke the solver when **any** of the following conditions are met:

1. **Mutual Exclusivity (XOR)**

   * Two or more candidates resolve overlapping diagnostics but conflict

2. **Prerequisite Dependencies**

   * A candidate requires another candidate to avoid introducing errors

3. **Greedy Stall**

   * No candidate has a positive score, but diagnostics remain

4. **Score Ambiguity**

   * Top candidate score is within ε of next-best alternatives

5. **Batch Dominance**

   * Multiple lower-ranked candidates together outperform the best single candidate

6. **Candidate Explosion**

   * Candidate pool size exceeds a configurable threshold (e.g. 15–20)

---

## Solver Responsibilities

When invoked, the solver:

* Selects a **set** of candidates (not just one)
* Respects hard constraints:

  * conflictsWith
  * requires
  * exclusiveGroup
* Optimizes for maximum verified diagnostic reduction
* Minimizes edit size and semantic risk

The solver operates over a **bounded candidate window** to control cost.

### Solver Model (ILP / MaxSAT)

* Boolean variable per candidate
* Linear objective
* Linear constraints

SMT is explicitly out of scope for v1.

---

## Repair Plan Output

The primary output is a **Verified Repair Plan**:

```md
Verified Repair Plan

Status: 12 diagnostics → 0 diagnostics
Confidence: Verified by compiler (no new diagnostics)

Apply fixes in this order:
1. Add missing import (removes 7 downstream errors)
2. Fix argument type mismatch
3. Insert null guard
```

Each step includes:

* Target diagnostic(s)
* File changes
* Verified delta
* Reason for ordering

---

## API Surface (Draft)

```ts
interface RepairRequest {
  project: string;           // tsconfig path
  maxCandidates?: number;
  allowRegressions?: boolean;
}

interface RepairResponse {
  plan: RepairPlan;
  remainingDiagnostics: DiagnosticRef[];
}
```

---

## Evaluation Metrics

Success is measured by:

* Reduction in agent iterations to green
* Reduction in compiler invocations by agents
* Percentage of plans with zero introduced diagnostics
* Percentage of top-1 plans accepted/applied

---

## Implementation Phases

### Phase 1: Greedy Oracle Loop

* Candidate generation
* Verification
* Greedy selection

### Phase 2: Dependency Metadata

* conflictsWith / requires detection

### Phase 3: Solver Integration

* ILP/MaxSAT fallback

### Phase 4: Learning (Optional)

* Tune weights from historical verification data

---

## Key Insight

This system is not IDE tooling.
It is an **optimizing compiler pass whose output is a patch set**.

That distinction enables autonomy, reliability, and a defensible moat.

---

## Diagnostic Disposition States

Each diagnostic is classified after candidate generation and verification:

* **AutoFixable** – One or more verified fixes exist; at least one is low semantic risk
* **AutoFixableHighRisk** – Verified fixes exist, but all involve semantic risk (casts, interface expansion, API changes)
* **NeedsJudgment** – Multiple verified fixes exist with comparable scores; intent is ambiguous
* **NoCandidate** – No generated fix reduces diagnostics under verification

These states are part of the protocol contract and guide agent behavior.

---

## Default Agent Policy (Recommended)

* Automatically apply **AutoFixable** repairs
* Surface **NeedsJudgment** repairs to the LLM or human with ranked options
* Require explicit opt-in to apply **AutoFixableHighRisk** repairs
* Treat **NoCandidate** diagnostics as semantic work items
