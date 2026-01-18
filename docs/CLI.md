# CLI Reference

This document defines the command-line interface for ts-repair. The CLI is designed to be:

- **Drop-in compatible** with existing `tsc` workflows
- **Deterministic and scriptable** for agents and CI
- **Minimal** (small surface area, boring defaults)

The CLI exposes two families of commands:
1. `tsc`-compatible checking
2. Repair-native planning and application

---

## Binary Names

- **Primary:** `ts-repair`
- **Optional alias:** `tsr` (documented as a convenience only)

All documentation, configuration, and examples MUST use `ts-repair` as the canonical name.

---

## Command Summary

```
ts-repair tsc -- [tsc args]
ts-repair check [options]
ts-repair plan [options]
ts-repair apply [options]
ts-repair explain [options]
ts-repair repair [options]
ts-repair preview [options]
```

---

## Global Options

```
-p, --project <path>     Path to tsconfig.json (mirrors tsc)
--format <text|json>     Output format (default depends on command)
--verbose                Emit debug and budget information
```

---

## Exit Codes

| Code | Meaning |
|----|--------|
| 0 | No remaining diagnostics / successful apply |
| 1 | Diagnostics remain |
| 2 | Tool or configuration error |

---

## 1. tsc-Compatible Commands

### `ts-repair tsc -- [tsc args]`

Runs the TypeScript compiler through ts-repair.

Behavior:
- Accepts all `tsc` arguments verbatim
- Exit codes match `tsc`
- Diagnostics printed in `tsc`-compatible format by default
- No repairs are applied unless explicitly enabled

Example:
```
ts-repair tsc -- -p tsconfig.json --noEmit
```

Optional flags:
- `--plan` – emit a repair plan in addition to diagnostics
- `--auto` – apply `AutoFixable` repairs before final check

---

### `ts-repair check`

A convenience wrapper around a standard `tsc --noEmit` invocation.

Equivalent to:
```
ts-repair tsc -- -p tsconfig.json --noEmit
```

Example:
```
ts-repair check -p tsconfig.json
```

---

## 2. Repair-Native Commands

### `ts-repair plan`

Generates a **verified repair plan** without mutating the workspace.

Example:
```
ts-repair plan -p tsconfig.json --format json --out plan.json
```

Options:
```
--out <file>             Write plan to file
--max-candidates <n>     Max candidates per iteration (default: 20)
--max-per-diagnostic <n> Max candidates per diagnostic (default: 3)
--max-verifications <n>  Max speculative typecheck runs (default: 200)
```

Output:
- Ordered repair steps
- Per-diagnostic dispositions
- Budget counters
- Remaining diagnostics

Default format: `json`

---

### `ts-repair apply`

Applies verified repairs to the workspace.

Examples:
```
# Apply only AutoFixable repairs
ts-repair apply -p tsconfig.json --auto

# Apply from a saved plan
ts-repair apply --plan plan.json

# Apply selected repair IDs
ts-repair apply --plan plan.json --ids r1,r4,r7
```

Options:
```
--plan <file>            Plan file to apply
--auto                   Apply AutoFixable repairs
--allow-high-risk        Allow AutoFixableHighRisk repairs
--ids <list>             Comma-separated repair IDs
```

Behavior:
- Applies edits deterministically
- Re-runs typecheck after apply
- Returns exit code 0 only if no diagnostics remain

---

### `ts-repair explain`

Explains a specific repair candidate or applied step.

Example:
```
ts-repair explain -p tsconfig.json --id r7
```

Output includes:
- Target diagnostics
- Verified delta (resolved / introduced)
- Conflicts / prerequisites
- Edit summary
- Ranking rationale

---

### `ts-repair repair`

Combined plan generation with optional auto-apply. The primary command for most use cases.

Example:
```
ts-repair repair -p tsconfig.json
ts-repair repair --apply
ts-repair repair --scoring-strategy weighted
```

Options:
```
--json                              Output as JSON
--compact                           Output compact JSON (for agents)
--apply                             Apply fixes to files after planning
--include-high-risk                 Include high-risk fixes
--trace                             Output budget event log as JSON
--max-verifications <n>             Max speculative typecheck runs (default: 500)
--max-candidates-per-iteration <n>  Max candidates per iteration (default: 100)
--scoring-strategy <delta|weighted> Candidate ranking method (default: delta)
```

Behavior:
- Generates a verified repair plan
- If `--apply` is specified, applies low/medium risk fixes to files
- With `--apply --include-high-risk`, applies all fixes including high risk

Default format: `text`

---

### `ts-repair preview`

Previews budget impact without running verifications. Useful for estimating cost before planning.

Example:
```
ts-repair preview -p tsconfig.json
ts-repair preview --json
```

Options:
```
--json                 Output as JSON
--include-high-risk    Include high-risk candidates in estimate
```

Default format: `text`

---

## Scoring Strategies

ts-repair supports two scoring strategies for ranking repair candidates:

### Delta Strategy (Default)

Simple error count difference: `errorsBefore - errorsAfter`

- Fast and predictable
- Prefers fixes that reduce the most errors
- Good for straightforward repairs

### Weighted Strategy

Formula: `resolvedWeight - (introducedWeight × K) - (editSize × α) - riskPenalty`

- Considers diagnostic severity (errors vs warnings)
- Penalizes large edits
- Penalizes high-risk fixes
- Better for nuanced repairs

Use `--scoring-strategy weighted` to enable.

---

## Output Formats

All commands support:

- `--format text` – human-readable
- `--format json` – machine-readable

Defaults:
- `tsc`, `check` → `text`
- `plan`, `apply`, `repair` → `json` (except `repair` defaults to `text`)

---

## Repair Dispositions

Each diagnostic is classified as:

- `AutoFixable`
- `AutoFixableHighRisk`
- `NeedsJudgment`
- `NoCandidate`

Disposition determines default behavior in `apply` and agent integrations.

---

## Compatibility Guarantees

- `ts-repair tsc` preserves `tsc` exit codes and diagnostics by default
- No workspace mutation occurs unless `apply` or `--auto` is used
- Repair plans are deterministic under fixed inputs and budgets

---

## Non-Goals

- Replacing the TypeScript compiler
- Guessing developer intent
- Performing semantic refactors
- Introducing new language syntax

---

## Design Principle

> ts-repair is an optimizing compiler pass whose output is a patch set.

All CLI behavior reflects this principle: verify first, apply second, reason last.

