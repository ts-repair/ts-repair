# ts-repair

**ts-repair is an oracle-guided agent ↔ compiler protocol that turns TypeScript diagnostics into verified repair plans.**

Instead of giving agents raw compiler errors and hoping they fix them one-by-one, ts-repair asks the compiler a better question:

> *"If I applied this fix, would it actually make things better?"*

ts-repair speculatively applies every candidate fix in-memory, re-runs the TypeScript compiler, and measures the exact diagnostic delta. Only fixes that **provably reduce errors** are surfaced.

---

## What ts-repair Does

* Applies mechanical, compiler-verifiable fixes automatically
* Batches compatible fixes to collapse error cascades
* Stops precisely when only semantic decisions remain
* Tells agents **what is fixed**, **what isn't**, and **why**

---

## What ts-repair Does *Not* Do

* It does not invent new syntax or require a new language
* It does not ask LLMs to reason about ASTs or JSON IRs
* It does not guess developer intent
* It does not promise semantic correctness

ts-repair's only promise is stricter—and more valuable:

> **No fix is suggested unless the compiler verifies that it helps.**

---

## Why This Matters for Agents

Without ts-repair:

* Agents reason about every error
* Try fixes speculatively
* Re-run the compiler after each edit
* Burn tokens on mechanical work

With ts-repair:

* Mechanical fixes are applied instantly
* Only semantic ambiguities reach the LLM
* Iterations and token usage drop ~50%+

ts-repair doesn't replace LLMs—it **frees them to do the work only they can do**.

---

## Example

```
Before: 7 compiler errors

ts-repair:
- 4 errors auto-fixed (verified)
- 3 errors flagged as needing judgment

After:
- Agent reasons about 3 errors instead of 7
```

What the agent receives:

```
═══════════════════════════════════════════════════════════
VERIFIED REPAIR PLAN
═══════════════════════════════════════════════════════════

Errors: 7 → 3
Confidence: 100% verified (no new diagnostics introduced)

APPLY THESE FIXES IN ORDER:

1. fixAwaitInSyncFunction
   File: app.ts:10
   Change: Add 'async' modifier
   Effect: 7 → 6 errors

2. fixMissingImport
   File: app.ts:1
   Change: Add import { useState } from 'react'
   Effect: 6 → 4 errors (resolves 2 downstream)

3. fixMissingMember
   File: app.ts:28
   Change: Add 'email' property to User interface
   Effect: 4 → 3 errors

REMAINING (require judgment):

- TS2345: Argument of type 'string' is not assignable to 'number'
- TS18046: 'data' is of type 'unknown'
- TS2322: Return type mismatch in parseUserId
```

No guessing. No "try this and see." Apply these, in this order, done.

---

## Mental Model

Think of ts-repair as:

> **An optimizing compiler pass whose output is a patch set.**

The compiler is the oracle.
ts-repair is the optimizer.
Agents consume the plan.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                   ts-repair Repair Engine                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   1. Get diagnostics from TypeScript                         │
│                        │                                     │
│                        ▼                                     │
│   2. For each diagnostic, get candidate fixes                │
│      (from TS Language Service codeActions)                  │
│                        │                                     │
│                        ▼                                     │
│   3. For each candidate fix:                                 │
│      ┌─────────────────────────────────────────┐            │
│      │  a. Apply to in-memory copy             │            │
│      │  b. Re-run type checker                 │  ← Oracle  │
│      │  c. Measure: errors removed - added     │            │
│      │  d. Score and rank                      │            │
│      └─────────────────────────────────────────┘            │
│                        │                                     │
│                        ▼                                     │
│   4. Select best fix, commit, repeat                         │
│                        │                                     │
│                        ▼                                     │
│   5. Return verified repair plan                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

The key insight: **TypeScript's incremental type checker is fast**. We can afford to speculatively apply dozens of fixes and re-check each one. The cost is milliseconds of CPU, not LLM tokens.

---

## Diagnostic Disposition

After analysis, each diagnostic is classified:

| State | Meaning | Agent Action |
|-------|---------|--------------|
| **AutoFixable** | Verified fix exists, low risk | Apply automatically |
| **AutoFixableHighRisk** | Verified fix exists, semantic risk | Opt-in apply |
| **NeedsJudgment** | Multiple valid fixes, ambiguous intent | Surface to LLM |
| **NoCandidate** | No fix reduces errors | Treat as semantic work |

This classification is part of the protocol. Agents know exactly what to do with each diagnostic.

---

## Installation

```bash
# Install globally
npm install -g ts-repair

# Or use directly
npx ts-repair repair ./tsconfig.json
```

---

## Usage

### CLI

```bash
# Get a verified repair plan
ts-repair repair ./tsconfig.json

# Output as JSON for programmatic use
ts-repair repair ./tsconfig.json --json

# Apply fixes automatically (AutoFixable only)
ts-repair repair ./tsconfig.json --apply

# Include high-risk fixes
ts-repair repair ./tsconfig.json --apply --include-high-risk
```

### Programmatic API

```typescript
import { repair } from 'ts-repair';

const plan = await repair({
  project: './tsconfig.json',
  maxCandidates: 50,
  allowRegressions: false,
});

console.log(`${plan.initialErrors} → ${plan.finalErrors} errors`);

for (const step of plan.steps) {
  console.log(`Apply: ${step.fix.name} @ ${step.file}:${step.line}`);
  // step.changes contains the actual text edits
}

for (const remaining of plan.remaining) {
  console.log(`Needs judgment: ${remaining.message}`);
}
```

### MCP Tool (for Claude Code, etc.)

ts-repair exposes an MCP tool that agents can call directly:

```json
{
  "tool": "ts_repair",
  "arguments": {
    "project": "./tsconfig.json"
  }
}
```

Returns a structured repair plan that the agent can apply.

---

## Benchmarks

On a test project with 7 TypeScript errors:

| Approach | Iterations | Tokens | Tool Calls |
|----------|------------|--------|------------|
| Raw diagnostics | 8 | ~1560 | 16 |
| **ts-repair** | 4 | ~695 | 9 |
| **Savings** | **50%** | **55%** | **44%** |

ts-repair handles 4/7 errors mechanically (57%). The LLM only reasons about 3 errors that require semantic judgment.

---

## What Gets Fixed Automatically

TypeScript's Language Service provides ~73 built-in code fixes. ts-repair verifies which ones actually help:

| Fix Type | Typical Confidence |
|----------|-------------------|
| Add missing import | High |
| Add async modifier | High |
| Add missing property to interface | Medium-High |
| Add missing parameter | Medium |
| Fix spelling (rename to similar name) | Medium |
| Remove unused code | High |

Fixes that TypeScript suggests but that would **introduce new errors** are rejected.

---

## What Requires Judgment

Some errors have no auto-fix, or multiple valid fixes:

* **Type mismatches** — Convert the argument? Change the parameter? Add assertion?
* **Unknown types** — Add type guard? Cast? Change API?
* **Missing return** — What should it return?

These are surfaced to the LLM with context about what was tried and why it didn't work.

---

## Project Status

ts-repair is experimental and focused on TypeScript.

The protocol is designed to generalize to other typed languages with similar compiler APIs.

See [docs/ROADMAP.md](docs/ROADMAP.md) for implementation status.

---

## Development

```bash
# Clone the repo
git clone https://github.com/ts-repair/ts-repair.git
cd ts-repair

# Install dependencies (using mise for toolchain management)
mise run install

# Run tests
mise run test

# Type check
mise run check
```

---

## Documentation

* [Architecture](docs/ARCHITECTURE.md) — System design and components
* [Product Requirements](docs/PRD.md) — Full specification and design rationale
* [Roadmap](docs/ROADMAP.md) — Implementation phases and status
* [CLAUDE.md](CLAUDE.md) — Development guidance

---

## Contributing

Contributions are welcome—especially:

* Repair recipes for additional TypeScript error patterns
* Verification improvements (faster incremental checking)
* Integrations with other agent frameworks

---

## License

MIT
