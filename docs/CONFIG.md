# Configuration

This document lists supported runtime configuration options for ts-repair.

## RepairRequest options

These options are available via the programmatic API and CLI equivalents.

- project: Path to the target tsconfig.json.
- maxCandidates: Maximum candidates per diagnostic (default: 10).
- maxCandidatesPerIteration: Maximum candidates across diagnostics per iteration (default: 100).
- maxVerifications: Total verification budget across the plan (default: 500).
- allowRegressions: Allow fixes that introduce new diagnostics if net positive (default: false).
- includeHighRisk: Include high-risk fixes in selection (default: false).

### scoreWeights

Tunable weights for candidate ranking. All fields are optional and override defaults.

Defaults:
- introducedMultiplier: 4
- editSizeAlpha: 0.0015
- riskPenalty:
  - low: 0
  - medium: 0.75
  - high: 2.0

Schema:
- scoreWeights.introducedMultiplier: Multiply introducedWeight by K.
- scoreWeights.editSizeAlpha: Multiply editSize by alpha.
- scoreWeights.riskPenalty.low: Penalty for low-risk fixes.
- scoreWeights.riskPenalty.medium: Penalty for medium-risk fixes.
- scoreWeights.riskPenalty.high: Penalty for high-risk fixes.

## Notes

- Scoring uses: resolvedWeight - (introducedWeight * K) - (editSize * alpha) - riskPenalty.
- Weights are applied after verification and do not affect candidate pruning.
