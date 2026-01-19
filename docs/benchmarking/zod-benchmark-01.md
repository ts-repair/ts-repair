# Benchmark: Claude Code with ts-repair vs Manual Error Fixing

**Date:** January 2026
**Status:** Early benchmark (more comprehensive benchmarking suite coming soon)

## Summary

| Metric | Manual | ts-repair | Improvement |
|--------|--------|-----------|-------------|
| **Duration** | 13m 23s | 9m 6s | 32% faster |
| **Total Input Tokens** | 3.58M | 1.32M | 63% fewer |
| **Output Tokens*** | ~11.8K | ~9.5K | 19% fewer |
| **API Cost** | $2.55 | $1.23 | **52% cheaper** |
| **Assistant Turns** | 168 | 96 | 43% fewer |
| **Bash Commands** | 27 | 9 | 67% fewer |
| **Iterations/Rounds** | 6 | 1 | 83% fewer |

*\*Output tokens estimated from content length. Costs calculated using Claude Opus 4.5 pricing.*

**Key finding:** ts-repair reduced the compile-check-fix loop from 6 rounds to 1, cutting API costs by 52% ($1.32 saved per run).

---

## Experiment Setup

### Objective

Measure whether ts-repair helps Claude Code fix TypeScript errors more efficiently compared to manual fixing without tool assistance.

### Test Subject

The [Zod](https://github.com/colinhacks/zod) validation library (v4) — a real-world TypeScript project with complex types, generics, and multiple packages in a monorepo structure.

### Errors Introduced

We introduced 5 intentional errors across 4 files, designed to create cascading type failures:

| File | Error | Impact |
|------|-------|--------|
| `v3/types.ts:12` | `errorUtil` → `erorUtil` (typo) | 124 cascading errors |
| `v3/types.ts:27` | `isAsync` → `isAsnc` (typo) | Part of above |
| `v4/classic/schemas.ts:3` | `processors` → `procesors` (typo) | 43 cascading errors |
| `v4/classic/schemas.ts:8` | `./iso.js` → `./ios.js` (wrong path) | Part of above |
| `v4/core/errors.ts:2` | `$constructor` → `$constuctor` (typo) | 6 errors |
| `v4/core/parse.ts:39` | Removed `async` keyword | 5 errors |

**Total: ~206 initial TypeScript errors** from 5 root causes.

### Test Configuration

Two identical copies of the broken Zod repository:
- **Manual session:** Standard Claude Code without ts-repair
- **ts-repair session:** Claude Code with ts-repair skill and CLAUDE.md instructions

Both sessions received the same prompt:
> "Please fix the TypeScript type errors in this project. Don't stop until `tsc --noEmit` shows no errors."

**Important controls:**
- `.git` directories removed to prevent `git diff` shortcuts
- Both started fresh with no prior context
- Same model (Claude Opus 4.5) for both

---

## Results Analysis

### Round Comparison

**Manual Session (6 rounds):**
1. Fixed `erorUtil` → `errorUtil` and `isAsnc` → `isAsync` (209 → 85 errors)
2. Fixed `procesors` → `processors` and `./ios.js` → `./iso.js` (85 → 42 errors)
3. Fixed `$constuctor` → `$constructor` and async/await (42 → 31 errors)
4. Fixed unused variable warnings with `void` expressions (31 → 11 errors)
5. Excluded CJS test fixtures from tsconfig (11 → 1 error)
6. Added `@ts-expect-error` for vitest import (1 → 0 errors)

**ts-repair Session (1 round):**
1. ts-repair identified root causes and proposed 3 verified auto-fixes
2. Applied fixes + manual fixes for remaining issues (206 → 0 errors)

### What Made ts-repair Faster

1. **Replaced repetitive tsc calls:** The manual session ran `tsc --noEmit` repeatedly to check progress. ts-repair's `check` command provided structured error output in one call.

2. **Identified root causes:** ts-repair's analysis surfaced the import/typo errors as high-impact fixes, rather than requiring iterative discovery.

3. **Fewer bash commands:** 67% reduction (27 → 9) by eliminating the compile-grep-count loop.

4. **Structured workflow:** Instead of "fix → compile → see what's left → repeat," the agent applied all fixes in sequence with confidence.

### Where Both Sessions Converged

Both sessions ultimately applied the same fixes:
- Typo corrections in import statements
- Adding async/await keywords
- Suppressing unused variable warnings with `void` or `@ts-expect-error`
- Config adjustments for CJS/ESM module resolution

The difference was in discovery and verification efficiency, not the final solution.

---

## Cost Breakdown

Using [Claude Opus 4.5 pricing](https://docs.anthropic.com/en/docs/about-claude/pricing):

| Token Type | Rate | Manual | ts-repair |
|------------|------|--------|-----------|
| Base input | $5/MTok | 2,459 ($0.01) | 193 ($0.00) |
| Cache write | $6.25/MTok | 77,641 ($0.49) | 56,979 ($0.36) |
| Cache read | $0.50/MTok | 3,504,922 ($1.75) | 1,264,537 ($0.63) |
| Output | $25/MTok | ~11,800 ($0.30) | ~9,500 ($0.24) |
| **Total** | | **$2.55** | **$1.23** |

The 63% reduction in cache reads is the primary cost driver—ts-repair required far fewer repeated context loads because it solved the problem in fewer iterations.

---

## Methodology Notes

### Token Counting

**Input tokens:** Summed from unique API calls (deduplicated by message ID) in session transcripts:
- `input_tokens`: Non-cached input
- `cache_creation_input_tokens`: New context written to cache
- `cache_read_input_tokens`: Cached context reused

**Output tokens:** Estimated from total content length (text, thinking, and tool_use content) divided by 4 (average chars per token). The API's `output_tokens` field in streaming responses records incremental deltas rather than cumulative totals.

### Cost Calculation

Costs calculated using Claude Opus 4.5 API pricing as of January 2026:
- Base input: $5/MTok
- 5-minute cache writes: $6.25/MTok
- Cache reads: $0.50/MTok
- Output: $25/MTok

### Timing

Wall-clock time from session start to final successful `tsc --noEmit` (or equivalent check with ts-repair).

### Limitations

This is a single benchmark with intentionally introduced errors. Results may vary based on:
- Error complexity and distribution
- Project structure and size
- Baseline agent behavior

---

## Files Referenced

- Manual session BENCHMARK.md: Documents the 6-round fixing process
- ts-repair session BENCHMARK.md: Documents the single-round approach
- Session transcripts: `~/.claude/projects/` (JSONL format)

---

## Next Steps

This is an early benchmark. Planned improvements include:

1. **Automated benchmarking suite** — reproducible test harness with multiple error scenarios
2. **Cross-project validation** — testing on React, Express, and other TypeScript frameworks
3. **Token-precise measurements** — detailed breakdown of tokens per fix category
4. **Iteration analysis** — understanding which error types benefit most from ts-repair

---

## Conclusion

In this benchmark, ts-repair reduced:
- **API costs by 52%** ($2.55 → $1.23)
- **Token usage by 63%** (3.58M → 1.32M input tokens)
- **Fixing time by 32%** (13m 23s → 9m 6s)
- **Iterations from 6 to 1**

The primary efficiency gain came from eliminating the iterative compile-check-fix loop. Instead of repeatedly running `tsc`, parsing errors, guessing fixes, and recompiling, ts-repair provided verified fixes upfront—allowing the agent to apply them with confidence in a single pass.

The 67% reduction in bash commands highlights ts-repair's value as a structured error analysis tool—it replaces repeated `tsc | grep | wc` pipelines with a single command that provides actionable repair plans.
