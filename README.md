# ts-repair

**An oracle-guided TypeScript repair engine that saves agents tokens by doing mechanical fixes for them.**

## The Problem

When AI coding agents encounter TypeScript errors, they typically:
1. Read raw compiler output
2. Reason about each error
3. Guess at fixes
4. Recompile to see if it worked
5. Repeat

This burns tokens on mechanical work that the compiler already knows how to fix.

## The Solution

ts-repair asks the TypeScript compiler a better question:

> *"If I applied this fix, would it actually help?"*

The term "oracle-guided" means exactly this: **the TypeScript compiler is the oracle**. Not an LLM, not a heuristic, not a probabilistic model—the actual type checker that will judge your code.

ts-repair speculatively applies candidate fixes in-memory and re-runs the type checker after each one. A fix is "verified" when the compiler confirms it reduces total diagnostics. Fixes that introduce new errors are rejected. Agents receive only what the compiler has validated.

Because candidate fixes can interact—one fix may enable or invalidate another—ts-repair applies them in an order that monotonically reduces total errors. Each committed step is verified to make progress before the next is considered.

**Early stage:** ts-repair is a working prototype. Early testing on real-world codebases (React frontends, Node.js backends, monorepo libraries) shows it eliminates the compile → reason → recompile loop for mechanical fixes.

**Early benchmark results:** In a [controlled test](docs/benchmarking/zod-benchmark-01.md) on the Zod validation library (206 TypeScript errors), ts-repair reduced API costs by 52% ($2.55 → $1.23) and fixing time by 32% compared to manual error fixing. The biggest efficiency gain: replacing 6 compile-check-fix rounds with 1, cutting token usage by 63%. More comprehensive benchmarks are coming soon.

## Quick Example

```
Before: 7 compiler errors

ts-repair:
- 4 errors auto-fixed (verified by the compiler)
- 3 errors flagged as needing judgment

After: Agent reasons about 3 errors instead of 7
```

The agent receives an actionable plan:

```
Errors: 7 → 3

APPLY THESE FIXES:

1. Add 'async' modifier to fetchData (app.ts:10)
2. Add import { useState } from 'react' (app.ts:1)
3. Add 'email' property to User interface (types.ts:28)

REMAINING (require judgment):
- Argument of type 'string' is not assignable to 'number'
- 'data' is of type 'unknown'
```

---

## Quickstart

### CLI

```bash
# Install (Bun)
bun add -g ts-repair

# Install (npm)
npm install -g ts-repair

# Get a repair plan
ts-repair repair ./tsconfig.json

# Apply verified fixes automatically
ts-repair repair ./tsconfig.json --apply

# JSON output for programmatic use
ts-repair repair ./tsconfig.json --json
```

### Agent Integration (MCP)

ts-repair integrates with AI coding assistants via MCP.

**Claude Code** — add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "ts-repair": {
      "command": "bunx",
      "args": ["ts-repair", "mcp-server"]
    }
  }
}
```

Or with npx:
```json
{
  "mcpServers": {
    "ts-repair": {
      "command": "npx",
      "args": ["ts-repair", "mcp-server"]
    }
  }
}
```

See [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) for OpenCode, Codex CLI, and other platforms.

### Programmatic API

```typescript
import { repair } from 'ts-repair';

const plan = await repair({ project: './tsconfig.json' });

console.log(`${plan.initialErrors} → ${plan.finalErrors} errors`);
for (const step of plan.steps) {
  console.log(`Apply: ${step.fixDescription}`);
}
```

---

## How It Works

ts-repair uses TypeScript's Language Service API to:

1. **Collect diagnostics** from your project
2. **Get candidate fixes** for each diagnostic (TypeScript suggests ~73 fix types)
3. **Verify each candidate** by applying it in-memory and re-running the type checker
4. **Select the best fixes** based on error reduction
5. **Classify remaining diagnostics** to tell agents what still needs work

The key insight: TypeScript's incremental type checker is fast. Speculatively testing dozens of fixes costs milliseconds of CPU, not LLM tokens.

### Diagnostic Classification

Classification is a core product feature, not an implementation detail. Every diagnostic in the output carries a machine-readable disposition that tells agents whether they're looking at mechanical work or a judgment call:

| Disposition | Meaning | Agent Action |
|-------------|---------|--------------|
| **AutoFixable** | Verified fix, low risk | Apply automatically |
| **AutoFixableHighRisk** | Verified fix, semantic risk | Opt-in apply |
| **NeedsJudgment** | Multiple valid fixes | Let the agent decide |
| **NoCandidate** | No fix helps | Treat as semantic work |

This distinction is part of the protocol. Agents can implement deterministic behavior: apply mechanical fixes without reasoning, spend tokens only on diagnostics that require judgment.

---

## What Gets Fixed Automatically

TypeScript suggests fixes like:
- Add missing imports
- Add async/await modifiers
- Add missing properties to interfaces
- Fix spelling mistakes (rename to similar)
- Remove unused code

ts-repair verifies which ones actually help. Fixes that would introduce new errors are rejected.

## What Requires Judgment

Some errors have no auto-fix or multiple valid options:
- Type mismatches (convert argument? change parameter? add assertion?)
- Unknown types (add type guard? cast? change API?)
- Missing returns (what should it return?)

These are surfaced to the agent with context about what was tried.

---

## Non-Goals

ts-repair is deliberately limited:

- **Does not infer business logic.** If the compiler can't verify a fix, ts-repair won't suggest it.
- **Does not choose between equally valid semantic alternatives.** When multiple fixes are type-correct, ts-repair surfaces them for the agent to decide.
- **Does not replace TypeScript's type system.** It uses the compiler as-is; it doesn't invent new checks or relax existing ones.

The purpose is to eliminate mechanical compiler-guided work so agents spend tokens only on meaningful reasoning.

---

## Documentation

| Topic | Link |
|-------|------|
| CLI Reference | [docs/CLI.md](docs/CLI.md) |
| Configuration | [docs/CONFIG.md](docs/CONFIG.md) |
| Agent Integration | [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) |
| Benchmarks | [docs/benchmarking/](docs/benchmarking/) |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Roadmap | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Product Requirements | [docs/PRD.md](docs/PRD.md) |

---

## Project Status

ts-repair is **experimental** and focused on TypeScript. The core repair loop is complete and working. See the [roadmap](docs/ROADMAP.md) for implementation status.

**What's done:**
- Oracle-guided repair planning with verification
- Diagnostic classification (AutoFixable, NeedsJudgment, etc.)
- CLI with plan, apply, and repair commands
- MCP server for agent integration
- Budget controls and scoring strategies

**What's coming:**
- Rigorous benchmarks with token/iteration measurements
- Solver integration for complex multi-fix scenarios
- Protocol specification for multi-language support

---

## Development

```bash
git clone https://github.com/ts-repair/ts-repair.git
cd ts-repair

# Uses mise for toolchain management
mise run install   # Install dependencies
mise run check     # Type check
mise run test      # Run tests
```

---

## License

MIT License - Copyright 2026 West Creek Labs

See [LICENSE](LICENSE) for details.
