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

### coneOptions

Options for the Verification Cone of Attention. The cone controls which files are included when measuring the effect of a candidate fix.

Defaults:
- maxConeSize: 50
- enableExpansion: true
- corePathPatterns: ["/types/", "/core/", "/shared/", "/common/", "/lib/", "/utils/", "/interfaces/", "/models/"]
- typeHeavyExtensions: [".d.ts"]
- sharedSymbolThreshold: 3
- maxReverseDependencyDepth: 1

Schema:
- coneOptions.maxConeSize: Maximum number of files to include in the verification cone.
- coneOptions.enableExpansion: Whether to enable adaptive cone expansion for structural fixes.
- coneOptions.corePathPatterns: Path patterns that indicate "core" or "shared" code (triggers expansion).
- coneOptions.typeHeavyExtensions: File extensions that indicate type-heavy files (triggers expansion).
- coneOptions.sharedSymbolThreshold: Minimum importers to trigger expansion.
- coneOptions.maxReverseDependencyDepth: Maximum depth for reverse dependency traversal.

## Notes

- Scoring uses: resolvedWeight - (introducedWeight * K) - (editSize * alpha) - riskPenalty.
- Weights are applied after verification and do not affect candidate pruning.
