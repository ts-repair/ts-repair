# Benchmark Documentation

This directory contains benchmark designs, results, and the harness infrastructure for measuring ts-repair effectiveness.

## Overview

The benchmark harness compares **scoring strategies** and measures **builder effectiveness** across a corpus of TypeScript fixtures with known errors.

## Scoring Strategies

ts-repair supports two scoring strategies for ranking repair candidates:

### Delta Strategy (default)

```
score = errorsBefore - errorsAfter
```

Simple error count difference. Picks the candidate that reduces the most errors.

**Pros:**
- Simple and predictable
- Fast (no additional calculations)
- Good for straightforward fixes

**Cons:**
- Doesn't consider edit size or risk
- May prefer large, risky changes over small, safe ones

### Weighted Strategy

```
score = resolvedWeight - (introducedWeight × K) - (editSize × α) - riskPenalty
```

Where:
- `resolvedWeight` = weighted sum of resolved diagnostics
- `introducedWeight` = weighted penalty for new errors (K = 4 multiplier)
- `editSize` = tokens changed (α = 0.0015 multiplier)
- `riskPenalty` = low=0, medium=0.75, high=2.0

**Pros:**
- Prefers smaller, safer changes
- Penalizes fixes that introduce new errors
- Better for complex codebases

**Cons:**
- More complex to reason about
- May reject valid fixes with larger diffs

## Benchmark Corpus

The corpus is defined in `tests/benchmark/corpus.json` with 13 fixtures:

### Synthetic Fixtures (8)

Standard TypeScript errors fixed by the Language Service:

| Fixture | Error Code | Description |
|---------|------------|-------------|
| `async-await` | TS1308 | Await in non-async function |
| `missing-import` | TS2552 | Missing imports |
| `multi-file-import` | TS2304, TS18046 | Cross-file imports |
| `multiple-errors` | TS2304 | Multiple error types |
| `no-errors` | (none) | Clean code baseline |
| `no-fixes-available` | TS2355, TS2304 | Errors requiring judgment |
| `spelling-error` | TS2339 | Property typos |
| `type-mismatch` | TS2322 | Type assignment errors |

### Builder-Specific Fixtures (5)

Errors requiring custom Solution Builders:

| Fixture | Error Code | Builder |
|---------|------------|---------|
| `conditional-distribution` | TS2322 | ConditionalTypeDistributionBuilder |
| `generic-constraint` | TS2344 | GenericConstraintBuilder |
| `instantiation-depth` | TS2589 | InstantiationDepthBuilder |
| `module-extension` | TS2835 | ModuleExtensionBuilder |
| `overload-mismatch` | TS2769 | OverloadRepairBuilder |

## Running Benchmarks

### Basic Usage

```bash
# Run full benchmark (both strategies, all fixtures)
ts-repair benchmark

# Run with verbose progress
ts-repair benchmark --verbose
```

### Filtering

```bash
# Single strategy
ts-repair benchmark --strategy delta
ts-repair benchmark --strategy weighted

# By category
ts-repair benchmark --category synthetic
ts-repair benchmark --category builder-specific

# By builder
ts-repair benchmark --builder GenericConstraintBuilder

# Specific fixture
ts-repair benchmark --fixture overload-mismatch
```

### Output Formats

```bash
# Text (default) - human-readable tables
ts-repair benchmark --format text

# JSON - machine-readable
ts-repair benchmark --format json

# CSV - spreadsheet-friendly
ts-repair benchmark --format csv

# Save all formats to directory
ts-repair benchmark --output-dir ./results
```

### Options

| Option | Description |
|--------|-------------|
| `--corpus <path>` | Path to corpus manifest (default: tests/benchmark/corpus.json) |
| `--strategy <name>` | delta, weighted, or both (default: both) |
| `--category <name>` | Filter: synthetic, builder-specific, real-world |
| `--builder <name>` | Filter to fixtures for specific builder |
| `--fixture <name>` | Run only named fixture |
| `--iterations <n>` | Runs per fixture for timing stability (default: 1) |
| `--include-high-risk` | Include high-risk fixes |
| `--format <fmt>` | Output: text, json, csv (default: text) |
| `--output <path>` | Write to file |
| `--output-dir <dir>` | Write all formats to directory |
| `--verbose` | Show progress |

## Interpreting Results

### Strategy Comparison

```
STRATEGY COMPARISON
───────────────────────────────────────────────────────────────
                        delta          weighted      diff
Errors Fixed:           45             48            +3
Fix Success Rate:       87%            92%           +5%
Avg Time/Fixture:       450ms          480ms         +30ms
```

- **Errors Fixed**: Total errors resolved across corpus
- **Fix Success Rate**: (errors fixed / initial errors) × 100
- **Avg Time/Fixture**: Mean time per fixture
- **Diff**: weighted - delta (positive = weighted better)

### Builder Effectiveness

```
BUILDER EFFECTIVENESS
───────────────────────────────────────────────────────────────
Builder                  Matches   Success Rate   False Pos
ModuleExtensionBuilder   5         100%           0%
GenericConstraintBuilder 2         50%            0%
```

- **Matches**: Diagnostics this builder matched
- **Success Rate**: (candidates selected / candidates generated) × 100
- **False Pos**: Candidates that made things worse

### Fixture Results

```
FIXTURE RESULTS
───────────────────────────────────────────────────────────────
Fixture                  delta    weighted   Winner
async-await              100%     100%       tie
overload-mismatch        50%      100%       weighted
```

- **Percentages**: Error reduction rate for that fixture
- **Winner**: Strategy that performed better (or tie)

## Metrics Collected

### Per-Run Metrics

| Metric | Description |
|--------|-------------|
| `initialErrors` | Errors before repair |
| `finalErrors` | Errors after repair |
| `errorReduction` | (initial - final) / initial |
| `candidatesGenerated` | Total candidates considered |
| `candidatesVerified` | Candidates that passed verification |
| `stepsApplied` | Repair steps in final plan |
| `regressionCount` | Fixes that introduced new errors |

### Timing Metrics

| Metric | Description |
|--------|-------------|
| `totalMs` | Total wall-clock time |
| `avgVerificationMs` | Mean time per verification |

## Files in This Directory

| File | Description |
|------|-------------|
| `README.md` | This documentation |
| `BENCHMARK-HARNESS-PLAN.md` | Implementation plan for the harness |
| `zod-benchmark-01.md` | Real-world benchmark: Claude Code + ts-repair vs manual |
| `generic-constraint-builder.md` | Design doc for GenericConstraintBuilder |
| `conditional-distribution-builder.md` | Design doc for ConditionalTypeDistributionBuilder |
| `instantiation-depth-builder.md` | Design doc for InstantiationDepthBuilder |

## Adding New Fixtures

1. Create fixture in `tests/fixtures/<name>/`
2. Add `tsconfig.json` with strict settings
3. Add source files with intentional errors
4. Add entry to `tests/benchmark/corpus.json`:

```json
{
  "name": "my-fixture",
  "category": "synthetic",
  "configPath": "tests/fixtures/my-fixture/tsconfig.json",
  "expectedOutcome": {
    "minErrorReduction": 0.5,
    "targetErrorReduction": 1.0,
    "applicableBuilders": []
  },
  "metadata": {
    "errorCodes": [2322],
    "description": "Description of what this tests"
  }
}
```

## Success Criteria

The benchmark harness validates:

1. **Functional**: Both strategies run on all fixtures
2. **Quality**: Results are deterministic (same input = same output)
3. **Timing**: Variance < 10% across runs (use `--iterations 3`)
4. **No regressions**: No fixture gets worse after a change
