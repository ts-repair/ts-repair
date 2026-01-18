# ts-repair Benchmark

Benchmark harness for measuring token efficiency of ts-repair vs vanilla tsc when an LLM fixes TypeScript errors.

## Overview

This benchmark validates whether the ~55% token savings observed in initial tests scales to larger codebases with more errors. It works by:

1. **Mangling** - Introducing controlled TypeScript errors using AST-based mutations
2. **Running** - Executing both vanilla (tsc + Claude) and ts-repair (ts-repair + Claude) approaches
3. **Comparing** - Measuring token usage, rounds, and success rates

## Installation

```bash
cd benchmark
npm install
```

## Usage

### Run a Single Benchmark

```bash
# Using a preset repository
npm run dev -- run --preset excalidraw --errors 25 --seed 42

# Using a local project
npm run dev -- run --local ./my-project --errors 30

# Using mock Claude (no API calls)
npm run dev -- run --local ./fixtures/mini-ts-app --errors 10 --mock
```

### Run a Scaling Suite

```bash
# Test multiple error counts
npm run dev -- suite --preset excalidraw --error-counts 10,20,30,50,80 --output results/scaling.json
```

### Quick Token Estimation

```bash
# Estimate without running full benchmark
npm run dev -- estimate --local ./project-with-errors
```

### Preview Mangles

```bash
# See what mutations would be applied
npm run dev -- preview --local ./my-project --errors 25
```

### Analyze Results

```bash
# Analyze existing benchmark results
npm run dev -- analyze results/*.json --output analysis.md
```

### List Presets

```bash
npm run dev -- presets
```

## Mangle Types

The benchmark uses these mutation types to introduce errors:

### High Cascade (ts-repair advantage)

| Type | Description | Expected Cascade |
|------|-------------|------------------|
| `deleteImport` | Remove import statements | 5x errors |
| `removeAsyncModifier` | Remove `async` from functions | 3x errors |
| `deleteInterfaceProperty` | Remove interface properties | 4x errors |

### Medium (Mechanical, localized)

| Type | Description | Expected Cascade |
|------|-------------|------------------|
| `removeTypeAnnotation` | Remove `: Type` annotations | 1x errors |
| `deleteReturnType` | Remove function return types | 1x errors |
| `removeOptionalChaining` | Replace `?.` with `.` | 1x errors |

### Hard (Require LLM judgment)

| Type | Description | Expected Cascade |
|------|-------------|------------------|
| `widenToUnknown` | Change types to `unknown` | 2x errors |
| `deleteTypeGuard` | Remove type guard conditions | 2x errors |
| `breakUnionType` | Keep only first type in union | 1x errors |

## Recipe Configuration

Recipes specify how many of each mangle type to apply:

```bash
# Custom recipe
npm run dev -- run --local ./project --recipe "deleteImport:3,removeAsync:2"

# Cascade-focused (better for ts-repair)
npm run dev -- run --local ./project --cascade --errors 30
```

## Output Formats

Results are exported in multiple formats:

- **JSON** - Full structured data for programmatic analysis
- **CSV** - For graphing and spreadsheet analysis
- **Markdown** - Human-readable documentation

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for real Claude API calls (use `--mock` to skip)

## Example Output

```
═══════════════════════════════════════════════════════════════
                    ts-repair Benchmark Results
═══════════════════════════════════════════════════════════════

Configuration:
  Project: excalidraw
  Initial errors: 25
  Seed: 42

Results Summary:
  ────────────────────────────────────────────────────────────
  Metric                    Vanilla         ts-repair       Savings
  ────────────────────────────────────────────────────────────
  Rounds                    5               2               +60.0%
  Total tokens              125.4K          56.2K           +55.2%
  Prompt tokens             112.1K          48.5K           +56.7%
  Completion tokens         13.3K           7.7K            +42.1%
  ────────────────────────────────────────────────────────────

ts-repair Metrics:
  Auto-fixed: 18 errors (72.0% of total)
  Punted to LLM: 7 errors

═══════════════════════════════════════════════════════════════
  🎉 ts-repair saved 55.2% tokens (69.2K tokens)
═══════════════════════════════════════════════════════════════
```

## Success Criteria

The benchmark aims to answer:

1. **Does 55% savings hold at scale?** - Run suite with 10-80 errors
2. **What's the auto-fix rate?** - Track % errors ts-repair handles without LLM
3. **Which error types benefit most?** - Break down by cascade/mechanical/judgment

## Development

```bash
# Type check
npm run check

# Run with tsx
npm run dev -- <command>

# Build
npm run build
```

## Architecture

```
benchmark/
├── src/
│   ├── types.ts           # Type definitions
│   ├── mangler.ts         # AST-based code mutation
│   ├── tsc.ts             # TypeScript compiler wrapper
│   ├── runner-vanilla.ts  # Vanilla tsc + Claude loop
│   ├── runner-tsrepair.ts # ts-repair + Claude loop
│   ├── token-counter.ts   # tiktoken-based counting
│   ├── reporter.ts        # Results comparison & output
│   ├── cli.ts             # Command-line interface
│   └── index.ts           # Public exports
├── fixtures/              # Test projects
│   └── mini-ts-app/       # ~500 LoC TypeScript app
└── results/               # Benchmark output
```
