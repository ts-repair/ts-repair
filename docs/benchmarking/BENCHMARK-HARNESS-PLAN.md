# Benchmark Harness Implementation Plan

**Date:** January 2026
**Status:** Planning Complete
**Goal:** Compare scoring strategies and measure builder effectiveness

---

## 1. Harness Architecture

### 1.1 Core Components

```
src/benchmark/
  harness.ts          # Main harness orchestrator
  runner.ts           # Single-run executor
  collector.ts        # Metrics collection
  reporter.ts         # Output formatting (JSON, CSV, human-readable)
  corpus.ts           # Test corpus management
  types.ts            # Benchmark-specific type definitions

tests/benchmark/
  harness.test.ts     # Harness unit tests
```

### 1.2 Programmatic API

```typescript
interface BenchmarkConfig {
  corpus: CorpusConfig;
  strategies: ScoringStrategy[];
  includeHighRisk: boolean;
  enableTelemetry: boolean;
  iterations: number; // For timing stability
}

interface BenchmarkRun {
  configPath: string;
  strategy: ScoringStrategy;
  result: RepairPlan;
  timing: TimingMetrics;
  builderStats: BuilderMetrics[];
}

function runBenchmark(config: BenchmarkConfig): BenchmarkResults;
```

### 1.3 Single-Run Execution

Each benchmark run should:
1. Create a fresh TypeScriptHost (no shared state between runs)
2. Enable telemetry collection
3. Run with the specified scoring strategy
4. Capture all metrics before and after

---

## 2. Test Corpus Design

### 2.1 Corpus Categories

**Category A: Synthetic Fixtures (Controlled)**
- Purpose: Known error patterns with predictable outcomes
- Location: `tests/fixtures/`

**Category B: Builder-Specific Fixtures**
- `overload-mismatch/` - OverloadRepairBuilder
- `module-extension/` - ModuleExtensionBuilder
- `generic-constraint/` - GenericConstraintBuilder
- `conditional-distribution/` - ConditionalTypeDistributionBuilder
- `instantiation-depth/` - InstantiationDepthBuilder

**Category C: Real-World Projects (Validation)**
- Snapshots of open-source TypeScript projects with intentional errors

### 2.2 Corpus Manifest

```json
{
  "version": "1.0.0",
  "entries": [
    {
      "name": "async-await",
      "category": "synthetic",
      "configPath": "tests/fixtures/async-await/tsconfig.json",
      "expectedOutcome": {
        "minErrorReduction": 0.8,
        "targetErrorReduction": 1.0,
        "applicableBuilders": []
      }
    }
  ]
}
```

---

## 3. Metrics to Collect

### 3.1 Per-Run Metrics

```typescript
interface RunMetrics {
  // Error metrics
  initialErrors: number;
  finalErrors: number;
  errorReduction: number;

  // Candidate metrics
  candidatesGenerated: number;
  candidatesVerified: number;
  candidatesPruned: number;

  // Timing metrics
  totalTimeMs: number;
  avgVerificationTimeMs: number;

  // Quality metrics
  stepsApplied: number;
  avgDeltaPerStep: number;
  regressionCount: number;
}
```

### 3.2 Per-Builder Metrics

```typescript
interface BuilderMetrics {
  builderName: string;
  diagnosticsMatched: number;
  candidatesGenerated: number;
  candidatesVerified: number;
  candidatesSelected: number;
  fixSuccessRate: number;
  falsePositives: number;
  falsePositiveRate: number;
  avgGenerationTimeMs: number;
}
```

### 3.3 Per-Strategy Metrics

```typescript
interface StrategyMetrics {
  strategy: ScoringStrategy;
  totalFixesApplied: number;
  totalErrorsFixed: number;
  avgErrorReduction: number;
  topCandidateSelectionRate: number;
  totalTimeMs: number;
  timePerErrorFixed: number;
}
```

---

## 4. Output Formats

### 4.1 JSON Output

```json
{
  "timestamp": "2026-01-20T12:00:00Z",
  "version": "0.2.0",
  "strategyComparison": {
    "delta": { "totalErrorsFixed": 156, "avgErrorReduction": 0.87 },
    "weighted": { "totalErrorsFixed": 162, "avgErrorReduction": 0.89 },
    "winner": "weighted",
    "confidence": 0.95
  }
}
```

### 4.2 CSV Output

```csv
fixture,strategy,initial_errors,final_errors,error_reduction,fixes_applied,time_ms
async-await,delta,3,0,1.0,2,450
async-await,weighted,3,0,1.0,2,480
```

### 4.3 Human-Readable Summary

```
═══════════════════════════════════════════════════════════════
           ts-repair Scoring Strategy Benchmark Results
═══════════════════════════════════════════════════════════════

STRATEGY COMPARISON
───────────────────────────────────────────────────────────────
                        delta          weighted      diff
Errors Fixed:           45             48            +3
Fix Success Rate:       87%            92%           +5%
Avg Time/Fixture:       450ms          480ms         +30ms

RECOMMENDATION: Use "weighted" as default
```

---

## 5. Implementation Phases

### Phase 1: Core Infrastructure (6-9 hours)

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1.1 | Define Benchmark Types (`src/benchmark/types.ts`) | 1-2 hrs |
| 1.2 | Implement Single-Run Executor (`src/benchmark/runner.ts`) | 2-3 hrs |
| 1.3 | Implement Metrics Collector (`src/benchmark/collector.ts`) | 3-4 hrs |

### Phase 2: Corpus Management (4-7 hours)

| Task | Description | Est. Time |
|------|-------------|-----------|
| 2.1 | Create Corpus Manifest (`tests/benchmark/corpus.json`) | 1-2 hrs |
| 2.2 | Implement Corpus Loader (`src/benchmark/corpus.ts`) | 1-2 hrs |
| 2.3 | Add/Verify Builder-Specific Fixtures | 2-3 hrs |

### Phase 3: Strategy Comparison (5-8 hours)

| Task | Description | Est. Time |
|------|-------------|-----------|
| 3.1 | Implement Comparison Logic | 2-3 hrs |
| 3.2 | Implement Multiple Iterations | 1-2 hrs |
| 3.3 | Builder Effectiveness Tracking | 2-3 hrs |

### Phase 4: Reporting (4-6 hours)

| Task | Description | Est. Time |
|------|-------------|-----------|
| 4.1 | JSON Output | 1-2 hrs |
| 4.2 | CSV Output | 1 hr |
| 4.3 | Human-Readable Summary | 2-3 hrs |

### Phase 5: CLI Integration (3-5 hours)

| Task | Description | Est. Time |
|------|-------------|-----------|
| 5.1 | Add `ts-repair benchmark` command | 2-3 hrs |
| 5.2 | Add CI Integration | 1-2 hrs |

### Phase 6: Documentation (3-5 hours)

| Task | Description | Est. Time |
|------|-------------|-----------|
| 6.1 | Document Benchmark Methodology | 1-2 hrs |
| 6.2 | Validate Against Existing Benchmarks | 2-3 hrs |

---

## 6. Dependencies

```
Phase 1 (Core Infrastructure)
    ↓
Phase 2 (Corpus Management)
    ↓
Phase 3 (Strategy Comparison)
    ↓
Phase 4 (Reporting)
    ↓
Phase 5 (CLI Integration)
    ↓
Phase 6 (Documentation)
```

---

## 7. Success Criteria

1. **Functional:** Runs both strategies on all corpus fixtures, collects all metrics
2. **Quality:** Results are deterministic, timing variance <10%
3. **Usability:** Single CLI command, clear recommendations
4. **Documentation:** Methodology documented, metrics defined

---

## 8. Critical Files

| File | Purpose |
|------|---------|
| `src/oracle/planner.ts` | Core planning logic, scoring strategies |
| `src/oracle/telemetry.ts` | Existing telemetry to extend |
| `src/output/types.ts` | Type definitions |
| `tests/efficiency/efficiency.test.ts` | Pattern for programmatic runs |
| `src/oracle/builders/index.ts` | All builders to track |

---

**Total Estimated Time:** 25-40 hours
