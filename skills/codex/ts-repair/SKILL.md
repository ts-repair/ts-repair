---
name: ts-repair
description: Fix TypeScript compilation errors using verified repair plans. Use this whenever you encounter TypeScript type errors, when running tsc shows errors, or when the user asks to fix TypeScript issues. ts-repair verifies every fix before suggesting it, ensuring suggestions actually reduce errors.
allowed-tools: Bash, Read, Write, Edit
---

# TypeScript Repair with ts-repair

ts-repair is an oracle-guided repair engine that verifies fixes before suggesting them.

## When to Use

- TypeScript compilation errors (`error TS...`)
- After editing TypeScript files
- When user asks to "fix types" or "fix TypeScript errors"

## Quick Start

### Check for errors:
```bash
ts-repair check -p ./tsconfig.json
```

### Get verified repair plan:
```bash
ts-repair repair -p ./tsconfig.json --json
```

### Apply low-risk fixes automatically:
```bash
ts-repair repair -p ./tsconfig.json --apply
```

## Understanding the Output

### Verified Fixes (steps)
These fixes are **proven** to reduce errors. Apply them directly.

### Remaining Diagnostics by Disposition

| Disposition | Action |
|-------------|--------|
| AutoFixable | Apply with `--apply` flag |
| AutoFixableHighRisk | Review before applying (type assertions, coercions) |
| NeedsJudgment | Multiple valid fixes exist - analyze and choose |
| NoGeneratedCandidate | TypeScript has no fix - requires manual investigation |
| NoVerifiedCandidate | Fixes exist but none reduce errors - investigate root cause |

## Workflow

1. Run `ts-repair repair --json` to get plan
2. Review the `summary` for error reduction stats
3. Apply `steps` directly (all verified)
4. For `remaining` diagnostics:
   - AutoFixable: run with `--apply --include-high-risk`
   - NeedsJudgment: read the candidates and choose
   - NoCandidate: investigate and fix manually

## Installation

If ts-repair is not installed:
```bash
npm install -g ts-repair
# OR use directly
npx ts-repair repair ./tsconfig.json
```

## Fallback

If ts-repair fails or is unavailable:
```bash
tsc --noEmit
```
Then fix errors manually based on raw diagnostics.
