---
name: ts-expert-repair
description: Develop and test complex TypeScript error repairs using the ts-repair builder framework. Use this skill when creating new repair builders, testing complex error patterns, or extending ts-repair's ability to handle advanced TypeScript errors like overload mismatches, generic constraints, recursive types, and distributive conditionals.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# TypeScript Expert Repair Development

This skill guides development and testing of complex TypeScript error repairs using ts-repair's builder framework.

## When to Use

- Creating new solution builders for specific error patterns
- Testing repairs for complex TypeScript errors
- Debugging builder matching or candidate generation
- Extending ts-repair's repair capabilities

## Architecture Overview

ts-repair uses a **builder framework** to generate synthetic repair candidates for errors that TypeScript's Language Service cannot fix automatically.

```
Diagnostic → BuilderRegistry → Matching Builders → Candidates → Verification → Repair Plan
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| BuilderRegistry | `src/oracle/builder.ts` | Routes diagnostics to builders |
| SolutionBuilder | `src/output/types.ts` | Interface for builders |
| Built-in builders | `src/oracle/builders/` | 5 complex error handlers |
| Test fixtures | `tests/fixtures/` | Minimal error scenarios |
| Builder tests | `tests/oracle/builders/` | Unit tests per builder |

## Built-in Builders

| Builder | Error Code | Pattern | Fix Strategy |
|---------|------------|---------|--------------|
| **OverloadRepairBuilder** | TS2769 | "No overload matches this call" | Add permissive overload signature |
| **ModuleExtensionBuilder** | TS2835 | "Relative import needs extension" | Add `.js` extension to import |
| **GenericConstraintBuilder** | TS2344 | "Type 'X' does not satisfy constraint 'Y'" | Add missing members to satisfy constraint |
| **ConditionalTypeDistributionBuilder** | TS2322/2345/2536 | Distributive conditional issues | Wrap in tuples: `[T] extends [U]` |
| **InstantiationDepthBuilder** | TS2589 | "Type instantiation excessively deep" | Add `& {}` intersection reset |

## Creating a New Builder

### 1. Define the Builder Interface

```typescript
// src/oracle/builders/my-builder.ts
import ts from "typescript";
import type { SolutionBuilder, BuilderContext, CandidateFix } from "../../output/types.js";
import { createSyntheticFix } from "../candidate.js";

export const MyBuilder: SolutionBuilder = {
  name: "MyBuilder",
  description: "Repairs [specific error pattern]",
  diagnosticCodes: [XXXX],  // e.g., [2769] for overload errors
  messagePatterns: [/optional regex pattern/],  // Optional fallback matching

  matches(ctx: BuilderContext): boolean {
    // Return true if this builder can handle the diagnostic
    if (ctx.diagnostic.code !== XXXX) return false;
    // Additional checks (AST analysis, etc.)
    return true;
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    // Generate repair candidates
    const candidates: CandidateFix[] = [];

    // Use ctx.getNodeAtPosition() for AST access
    // Use ctx.getSourceFile(path) for file content
    // Use ctx.host for VFS operations

    return candidates;
  },
};
```

### 2. Register the Builder

```typescript
// src/oracle/builders/index.ts
export { MyBuilder } from "./my-builder.js";

export const builtinBuilders = [
  // ... existing builders
  MyBuilder,
] as const;
```

### 3. Create Test Fixture

```
tests/fixtures/my-error-pattern/
├── tsconfig.json
├── source.ts        # File with the target error
└── types.ts         # Supporting type definitions (if needed)
```

Fixture tsconfig.json:
```json
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["*.ts"]
}
```

### 4. Write Unit Tests

```typescript
// tests/oracle/builders/my-builder.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import { BuilderRegistry, createBuilderContext, defaultRegistry } from "../../../src/oracle/builder.js";
import { createTypeScriptHost } from "../../../src/oracle/typescript.js";
import { MyBuilder } from "../../../src/oracle/builders/my-builder.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures");

describe("MyBuilder", () => {
  let registry: BuilderRegistry;

  beforeEach(() => {
    registry = new BuilderRegistry();
    defaultRegistry.clear();
  });

  afterEach(() => {
    defaultRegistry.clear();
  });

  describe("matches()", () => {
    it("matches TSXXXX errors", () => {
      registry.register(MyBuilder);
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "my-error-pattern/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();
      const target = diagnostics.find((d) => d.code === XXXX);
      expect(target).toBeDefined();

      const ctx = createBuilderContext(target!, host, new Set(), diagnostics);
      expect(MyBuilder.matches(ctx)).toBe(true);
    });
  });

  describe("generate()", () => {
    it("generates valid candidates", () => {
      const host = createTypeScriptHost(
        path.join(FIXTURES_DIR, "my-error-pattern/tsconfig.json")
      );
      const diagnostics = host.getDiagnostics();
      const target = diagnostics.find((d) => d.code === XXXX);

      const ctx = createBuilderContext(target!, host, new Set(), diagnostics);
      const candidates = MyBuilder.generate(ctx);

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].kind).toBe("synthetic");
    });
  });
});
```

## Candidate Fix Properties

When creating synthetic fixes, set appropriate hints:

```typescript
createSyntheticFix(
  "fixName",           // Unique identifier
  "Human description", // Shown to users
  [{ file, start, end, newText }],  // FileChange[]
  {
    scopeHint: "modified" | "errors" | "wide",  // Verification scope
    riskHint: "low" | "medium" | "high",        // Risk level
    tags: ["category", "pattern"],              // For filtering
    metadata: { /* custom data */ },            // Builder-specific
  }
);
```

| scopeHint | Meaning | Use When |
|-----------|---------|----------|
| `"modified"` | Only verify modified files | Local fixes (imports, extensions) |
| `"errors"` | Include files with errors | Cross-file type fixes |
| `"wide"` | Include reverse dependencies | Structural changes (overloads) |

| riskHint | Meaning | Behavior |
|----------|---------|----------|
| `"low"` | Safe to auto-apply | Applied with `--apply` |
| `"medium"` | Review recommended | Applied with `--apply` |
| `"high"` | Semantic risk | Requires `--include-high-risk` |

## Testing Commands

```bash
# Run all tests
mise run test

# Run builder tests only
mise exec -- bun test tests/oracle/builders/

# Run specific builder test
mise exec -- bun test tests/oracle/builders/overload.test.ts

# Type check
mise run check

# Test a specific fixture
mise exec -- bun run src/cli.ts repair tests/fixtures/overload-mismatch/tsconfig.json --json
```

## Debugging Workflow

### 1. Check Diagnostic Details

```bash
mise exec -- bun run src/cli.ts repair ./tsconfig.json --json 2>&1 | jq '.remaining'
```

### 2. Verify Builder Matching

Add logging to `BuilderRegistry.getMatchResults()`:

```typescript
const results = registry.getMatchResults(ctx);
console.log("Match results:", JSON.stringify(results, null, 2));
```

### 3. Inspect Generated Candidates

```typescript
const candidates = builder.generate(ctx);
for (const c of candidates) {
  console.log(`Candidate: ${c.description}`);
  console.log(`  Kind: ${c.kind}`);
  console.log(`  Scope: ${c.scopeHint}`);
  console.log(`  Risk: ${c.riskHint}`);
  if (c.kind === "synthetic") {
    console.log(`  Changes:`, JSON.stringify(c.changes, null, 2));
  }
}
```

### 4. Test Verification

Use the planner to verify a candidate actually reduces errors:

```typescript
import { createRepairPlanner } from "../src/oracle/planner.js";

const planner = createRepairPlanner(host, { enableBuilders: true });
const plan = planner.plan();
console.log("Plan steps:", plan.steps.length);
console.log("Remaining:", plan.remaining.length);
```

## Common Patterns

### AST Traversal

```typescript
function findTargetNode(ctx: BuilderContext): ts.Node | undefined {
  const node = ctx.getNodeAtPosition();
  if (!node) return undefined;

  // Walk up to find parent of specific type
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCallExpression(current)) return current;
    current = current.parent;
  }
  return undefined;
}
```

### Finding Declarations

```typescript
function findDeclaration(name: string, ctx: BuilderContext) {
  for (const fileName of ctx.host.getFileNames()) {
    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    function visit(node: ts.Node): ts.Node | undefined {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
        return node;
      }
      return ts.forEachChild(node, visit);
    }

    const found = visit(sourceFile);
    if (found) return { file: fileName, node: found };
  }
  return undefined;
}
```

### Generating Text Edits

```typescript
const change: FileChange = {
  file: targetFile,
  start: insertPosition,
  end: insertPosition,  // Same as start for insertions
  newText: "inserted code",
};
```

## Existing Fixtures Reference

| Fixture | Error Type | Use Case |
|---------|------------|----------|
| `overload-mismatch/` | TS2769 | Function overload testing |
| `generic-constraint/` | TS2344 | Generic constraint failures |
| `conditional-distribution/` | TS2322/2345 | Distributive conditional types |
| `instantiation-depth/` | TS2589 | Recursive type depth |
| `module-extension/` | TS2835 | ESM import extensions |
| `type-mismatch/` | TS2322 | Basic type incompatibility |
| `missing-import/` | TS2304 | Missing imports |
| `async-await/` | TS1308 | Missing async/await |
| `spelling-error/` | TS2551 | Typos in identifiers |

## Adding to README

After creating a new builder, update `skills/README.md` and the builder index export.
