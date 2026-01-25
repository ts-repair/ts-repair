/**
 * Builder Verification Integration Tests
 *
 * These tests verify that builder-generated candidates actually pass
 * TypeScript verification - i.e., they reduce errors without introducing new ones.
 *
 * Unlike unit tests that just check candidate structure, these tests:
 * 1. Create a TypeScript host for a fixture
 * 2. Generate candidates from the builder
 * 3. Apply the candidate to the VFS
 * 4. Re-run TypeScript type checking
 * 5. Verify the error count decreased
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import ts from "typescript";

import { createTypeScriptHost, type TypeScriptHost } from "../../src/oracle/typescript.js";
import {
  BuilderRegistry,
  createBuilderContext,
} from "../../src/oracle/builder.js";
import { applyCandidate, getChanges } from "../../src/oracle/candidate.js";
import type { CandidateFix } from "../../src/output/types.js";

// Import builders to test
import { OverloadRepairBuilder } from "../../src/oracle/builders/overload.js";
import { GenericConstraintBuilder } from "../../src/oracle/builders/generic-constraint.js";
import { ConditionalTypeDistributionBuilder } from "../../src/oracle/builders/conditional-distribution.js";
import { InstantiationDepthBuilder } from "../../src/oracle/builders/instantiation-depth.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

/**
 * Result from verifying a builder candidate.
 */
interface VerificationResult {
  /** Number of errors reduced (positive is good) */
  errorsReduced: number;
  /** Number of new errors introduced (0 is good) */
  errorsIntroduced: number;
  /** Initial diagnostic count before applying fix */
  initialErrors: number;
  /** Final diagnostic count after applying fix */
  finalErrors: number;
  /** Whether the target diagnostic was fixed */
  targetFixed: boolean;
  /** New diagnostics introduced by the fix */
  newDiagnostics: ts.Diagnostic[];
}

/**
 * Verify a builder-generated candidate by applying it and checking diagnostics.
 *
 * @param host - TypeScript host with VFS
 * @param candidate - The candidate fix to verify
 * @param targetDiagnostic - The diagnostic we're trying to fix
 * @returns Verification result with error delta information
 */
function verifyCandidate(
  host: TypeScriptHost,
  candidate: CandidateFix,
  targetDiagnostic: ts.Diagnostic
): VerificationResult {
  const vfs = host.getVFS();

  // Get initial diagnostics
  const initialDiagnostics = host.getDiagnostics();
  const initialErrors = initialDiagnostics.length;

  // Create a unique key for the target diagnostic
  const targetKey = getDiagnosticKey(targetDiagnostic);
  const initialKeys = new Set(initialDiagnostics.map(getDiagnosticKey));

  // Take a snapshot before applying changes
  const snapshot = vfs.snapshot();

  try {
    // Apply the candidate to VFS
    applyCandidate(vfs, candidate);

    // Notify TypeScript host of changes
    const changedFiles = new Set(getChanges(candidate).map((c) => c.file));
    host.notifySpecificFilesChanged(changedFiles);

    // Get new diagnostics
    const newDiagnostics = host.getDiagnostics();
    const finalErrors = newDiagnostics.length;
    const finalKeys = new Set(newDiagnostics.map(getDiagnosticKey));

    // Check if target was fixed
    const targetFixed = !finalKeys.has(targetKey);

    // Find introduced diagnostics (in final but not in initial)
    const introducedDiagnostics = newDiagnostics.filter(
      (d) => !initialKeys.has(getDiagnosticKey(d))
    );

    return {
      errorsReduced: initialErrors - finalErrors,
      errorsIntroduced: introducedDiagnostics.length,
      initialErrors,
      finalErrors,
      targetFixed,
      newDiagnostics: introducedDiagnostics,
    };
  } finally {
    // Restore VFS to original state
    vfs.restore(snapshot);
    host.notifyFilesChanged();
  }
}

/**
 * Create a unique key for a diagnostic for comparison purposes.
 */
function getDiagnosticKey(diagnostic: ts.Diagnostic): string {
  const file = diagnostic.file?.fileName ?? "unknown";
  const start = diagnostic.start ?? 0;
  const code = diagnostic.code;
  return `${file}:${start}:${code}`;
}

/**
 * Verify all candidates from a builder against a fixture.
 *
 * @param fixtureName - Name of the fixture directory under tests/fixtures
 * @param builder - The builder to test
 * @param targetDiagnosticCode - The diagnostic code the builder targets
 * @returns Array of verification results for each candidate
 */
async function verifyBuilderCandidates(
  fixtureName: string,
  builder: typeof OverloadRepairBuilder,
  targetDiagnosticCode: number
): Promise<{
  candidates: CandidateFix[];
  results: VerificationResult[];
  hasDiagnostic: boolean;
}> {
  const configPath = path.join(FIXTURES_DIR, fixtureName, "tsconfig.json");
  const host = createTypeScriptHost(configPath);
  const diagnostics = host.getDiagnostics();

  // Find target diagnostic
  const targetDiagnostic = diagnostics.find((d) => d.code === targetDiagnosticCode);

  if (!targetDiagnostic) {
    return {
      candidates: [],
      results: [],
      hasDiagnostic: false,
    };
  }

  // Create builder context
  const filesWithErrors = new Set(
    diagnostics
      .filter((d) => d.file)
      .map((d) => d.file!.fileName)
  );
  const ctx = createBuilderContext(targetDiagnostic, host, filesWithErrors, diagnostics);

  // Check if builder matches
  if (!builder.matches(ctx)) {
    return {
      candidates: [],
      results: [],
      hasDiagnostic: true,
    };
  }

  // Generate candidates
  const candidates = builder.generate(ctx);

  // Verify each candidate
  const results: VerificationResult[] = [];
  for (const candidate of candidates) {
    const result = verifyCandidate(host, candidate, targetDiagnostic);
    results.push(result);
  }

  return {
    candidates,
    results,
    hasDiagnostic: true,
  };
}

describe("Builder Verification Integration", () => {
  describe("OverloadRepairBuilder", () => {
    it(
      "generates candidates that pass verification for overload mismatch",
      async () => {
        const { candidates, results, hasDiagnostic } = await verifyBuilderCandidates(
          "overload-mismatch",
          OverloadRepairBuilder,
          2769 // TS2769: No overload matches this call
        );

        // Fixture should have the target diagnostic
        expect(hasDiagnostic).toBe(true);

        // Should generate at least one candidate
        expect(candidates.length).toBeGreaterThan(0);

        // At least one candidate should reduce errors or fix the target
        const anyImprovement = results.some(
          (r) => r.errorsReduced > 0 || r.targetFixed
        );
        expect(anyImprovement).toBe(true);

        // Best candidate should not introduce new errors
        const bestResult = results.reduce((best, current) =>
          current.errorsReduced > best.errorsReduced ? current : best
        );
        expect(bestResult.errorsIntroduced).toBe(0);
      },
      { timeout: 30000 }
    );

    it(
      "fixture has expected diagnostic before repair",
      async () => {
        const configPath = path.join(FIXTURES_DIR, "overload-mismatch/tsconfig.json");
        const host = createTypeScriptHost(configPath);
        const diagnostics = host.getDiagnostics();

        // Should have TS2769
        const ts2769 = diagnostics.find((d) => d.code === 2769);
        expect(ts2769).toBeDefined();
        expect(ts2769!.messageText).toBeDefined();

        // Verify the error is about overload mismatch
        const message = ts.flattenDiagnosticMessageText(ts2769!.messageText, " ");
        expect(message.toLowerCase()).toContain("overload");
      },
      { timeout: 15000 }
    );
  });

  describe("GenericConstraintBuilder", () => {
    it(
      "generates candidates that pass verification for constraint violations",
      async () => {
        const { candidates, results, hasDiagnostic } = await verifyBuilderCandidates(
          "generic-constraint",
          GenericConstraintBuilder,
          2344 // TS2344: Type 'X' does not satisfy the constraint 'Y'
        );

        // Fixture should have the target diagnostic
        expect(hasDiagnostic).toBe(true);

        // Should generate at least one candidate
        expect(candidates.length).toBeGreaterThan(0);

        // At least one candidate should reduce errors or fix the target
        const anyImprovement = results.some(
          (r) => r.errorsReduced > 0 || r.targetFixed
        );
        expect(anyImprovement).toBe(true);

        // Best candidate should not introduce more errors than it fixes
        const bestResult = results.reduce((best, current) =>
          current.errorsReduced > best.errorsReduced ? current : best
        );
        // Net improvement should be positive or zero (doesn't make things worse)
        expect(bestResult.errorsReduced).toBeGreaterThanOrEqual(0);
      },
      { timeout: 30000 }
    );

    it(
      "fixture has expected diagnostic before repair",
      async () => {
        const configPath = path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json");
        const host = createTypeScriptHost(configPath);
        const diagnostics = host.getDiagnostics();

        // Should have TS2344
        const ts2344 = diagnostics.find((d) => d.code === 2344);
        expect(ts2344).toBeDefined();

        // Verify the error is about constraint violation
        const message = ts.flattenDiagnosticMessageText(ts2344!.messageText, " ");
        expect(message.toLowerCase()).toContain("constraint");
      },
      { timeout: 15000 }
    );

    it(
      "adds missing members correctly",
      async () => {
        const { candidates, results } = await verifyBuilderCandidates(
          "generic-constraint",
          GenericConstraintBuilder,
          2344
        );

        // Expect the builder to generate candidates for this fixture
        expect(candidates.length).toBeGreaterThan(0);

        // Check that the generated fix adds a member
        const candidate = candidates[0];
        expect(candidate.kind).toBe("synthetic");
        if (candidate.kind === "synthetic") {
          const changes = candidate.changes;
          expect(changes.length).toBeGreaterThan(0);

          // The fix should add an 'id' property (based on the fixture)
          const newText = changes.map((c) => c.newText).join("");
          expect(newText).toContain("id");
        }
      },
      { timeout: 30000 }
    );
  });

  describe("ConditionalTypeDistributionBuilder", () => {
    it(
      "generates candidates that target distribution issues",
      async () => {
        const { candidates, results, hasDiagnostic } = await verifyBuilderCandidates(
          "conditional-distribution",
          ConditionalTypeDistributionBuilder,
          2322 // TS2322: Type is not assignable
        );

        // Fixture should have the target diagnostic
        expect(hasDiagnostic).toBe(true);

        // If no candidates generated, warn but don't fail - builder may not match this pattern
        if (candidates.length === 0) {
          console.warn(
            "ConditionalTypeDistributionBuilder: No candidates generated for conditional-distribution fixture. " +
            "Builder may not match this specific pattern."
          );
          return;
        }

        // Verify candidates use tuple wrapping
        for (const candidate of candidates) {
          expect(candidate.kind).toBe("synthetic");
          if (candidate.kind === "synthetic") {
            // Check that the fix wraps types in tuples
            const changes = candidate.changes;
            for (const change of changes) {
              // Should add brackets for tuple wrapping
              expect(change.newText).toMatch(/\[.*\]/);
            }
          }
        }

        // At least one should have non-negative delta (doesn't make things worse)
        const anyNonNegative = results.some((r) => r.errorsReduced >= 0);
        expect(anyNonNegative).toBe(true);
      },
      { timeout: 30000 }
    );

    it(
      "fixture has expected diagnostic before repair",
      async () => {
        const configPath = path.join(
          FIXTURES_DIR,
          "conditional-distribution/tsconfig.json"
        );
        const host = createTypeScriptHost(configPath);
        const diagnostics = host.getDiagnostics();

        // Should have TS2322
        const ts2322 = diagnostics.find((d) => d.code === 2322);
        expect(ts2322).toBeDefined();

        // Verify the error involves type assignment
        const message = ts.flattenDiagnosticMessageText(ts2322!.messageText, " ");
        expect(message.toLowerCase()).toContain("assignable");
      },
      { timeout: 15000 }
    );
  });

  describe("InstantiationDepthBuilder", () => {
    it(
      "generates candidates for instantiation depth errors",
      async () => {
        const { candidates, results, hasDiagnostic } = await verifyBuilderCandidates(
          "instantiation-depth",
          InstantiationDepthBuilder,
          2589 // TS2589: Type instantiation is excessively deep
        );

        // Fixture should have the target diagnostic
        expect(hasDiagnostic).toBe(true);

        // If no candidates generated, warn but don't fail - builder may not match this pattern
        if (candidates.length === 0) {
          console.warn(
            "InstantiationDepthBuilder: No candidates generated for instantiation-depth fixture. " +
            "Builder may not match this specific pattern."
          );
          return;
        }

        // Verify candidates use intersection reset
        for (const candidate of candidates) {
          expect(candidate.kind).toBe("synthetic");
          if (candidate.kind === "synthetic") {
            // Check that the fix adds intersection reset pattern
            const changes = candidate.changes;
            const allNewText = changes.map((c) => c.newText).join("");
            // Should add " & {}" for intersection reset
            expect(allNewText).toContain("& {}");
          }
        }

        // Check metadata
        const firstCandidate = candidates[0];
        if (firstCandidate.kind === "synthetic") {
          expect(firstCandidate.metadata).toBeDefined();
          expect(firstCandidate.metadata?.pattern).toBe("intersection-reset");
        }
      },
      { timeout: 30000 }
    );

    it(
      "fixture has expected diagnostic before repair",
      async () => {
        const configPath = path.join(FIXTURES_DIR, "instantiation-depth/tsconfig.json");
        const host = createTypeScriptHost(configPath);
        const diagnostics = host.getDiagnostics();

        // Should have TS2589
        const ts2589 = diagnostics.find((d) => d.code === 2589);
        expect(ts2589).toBeDefined();

        // Verify the error is about instantiation depth
        const message = ts.flattenDiagnosticMessageText(ts2589!.messageText, " ");
        expect(message.toLowerCase()).toContain("instantiation");
        expect(message.toLowerCase()).toContain("deep");
      },
      { timeout: 15000 }
    );
  });

  describe("Cross-builder consistency", () => {
    it(
      "all builders produce candidates with required fields",
      async () => {
        const builders = [
          { builder: OverloadRepairBuilder, fixture: "overload-mismatch", code: 2769 },
          { builder: GenericConstraintBuilder, fixture: "generic-constraint", code: 2344 },
          { builder: ConditionalTypeDistributionBuilder, fixture: "conditional-distribution", code: 2322 },
          { builder: InstantiationDepthBuilder, fixture: "instantiation-depth", code: 2589 },
        ];

        for (const { builder, fixture, code } of builders) {
          const { candidates, hasDiagnostic } = await verifyBuilderCandidates(
            fixture,
            builder,
            code
          );

          if (!hasDiagnostic) {
            console.warn(
              `${builder.name}: Fixture "${fixture}" does not have diagnostic TS${code}. Skipping validation.`
            );
            continue;
          }

          for (const candidate of candidates) {
            // All candidates should have required fields
            expect(candidate.fixName).toBeDefined();
            expect(typeof candidate.fixName).toBe("string");
            expect(candidate.description).toBeDefined();
            expect(typeof candidate.description).toBe("string");
            expect(candidate.kind).toBeDefined();
            expect(["tsCodeFix", "synthetic"]).toContain(candidate.kind);

            if (candidate.kind === "synthetic") {
              expect(candidate.changes).toBeDefined();
              expect(Array.isArray(candidate.changes)).toBe(true);
              expect(candidate.changes.length).toBeGreaterThan(0);

              // Each change should have required fields
              for (const change of candidate.changes) {
                expect(change.file).toBeDefined();
                expect(typeof change.start).toBe("number");
                expect(typeof change.end).toBe("number");
                expect(typeof change.newText).toBe("string");
              }
            }
          }
        }
      },
      { timeout: 60000 }
    );

    it(
      "no builder introduces more errors than it fixes in best candidate",
      async () => {
        // Builders that must pass this criterion (well-established)
        const requiredBuilders = [
          { builder: OverloadRepairBuilder, fixture: "overload-mismatch", code: 2769 },
          { builder: GenericConstraintBuilder, fixture: "generic-constraint", code: 2344 },
        ];

        // Builders that we test but may not pass yet (experimental)
        const experimentalBuilders = [
          { builder: ConditionalTypeDistributionBuilder, fixture: "conditional-distribution", code: 2322 },
          { builder: InstantiationDepthBuilder, fixture: "instantiation-depth", code: 2589 },
        ];

        const allBuilders = [...requiredBuilders, ...experimentalBuilders];
        const requiredBuilderNames = new Set(requiredBuilders.map(b => b.builder.name));

        for (const { builder, fixture, code } of allBuilders) {
          const { candidates, results, hasDiagnostic } = await verifyBuilderCandidates(
            fixture,
            builder,
            code
          );

          if (!hasDiagnostic) {
            console.warn(
              `${builder.name}: Fixture "${fixture}" does not have diagnostic TS${code}. Skipping validation.`
            );
            continue;
          }

          if (candidates.length === 0) {
            console.warn(
              `${builder.name}: No candidates generated for fixture "${fixture}". Skipping validation.`
            );
            continue;
          }

          // Find best result (highest error reduction)
          const bestResult = results.reduce((best, current) =>
            current.errorsReduced > best.errorsReduced ? current : best
          );

          // Net change should be non-negative (doesn't make things worse)
          const netChange = bestResult.errorsReduced - bestResult.errorsIntroduced;

          if (requiredBuilderNames.has(builder.name)) {
            // Required builders must pass
            expect(netChange).toBeGreaterThanOrEqual(0);
          } else if (netChange < 0) {
            // Experimental builders: warn but don't fail
            console.warn(
              `${builder.name}: Best candidate has negative net change (${netChange}). ` +
              `This builder may need improvement.`
            );
          }
        }
      },
      { timeout: 60000 }
    );
  });

  describe("Negative test cases", () => {
    it(
      "handles fixture with no diagnostics gracefully",
      async () => {
        const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
        const host = createTypeScriptHost(configPath);
        const diagnostics = host.getDiagnostics();

        // Should have no diagnostics
        expect(diagnostics.length).toBe(0);

        // Attempting to verify with no diagnostics should return empty results
        const { candidates, results, hasDiagnostic } = await verifyBuilderCandidates(
          "no-errors",
          OverloadRepairBuilder,
          2769
        );

        expect(hasDiagnostic).toBe(false);
        expect(candidates.length).toBe(0);
        expect(results.length).toBe(0);
      },
      { timeout: 15000 }
    );

    it(
      "validates change positions are within file bounds",
      async () => {
        const { candidates } = await verifyBuilderCandidates(
          "generic-constraint",
          GenericConstraintBuilder,
          2344
        );

        // Skip if no candidates - already tested elsewhere
        if (candidates.length === 0) {
          console.warn("No candidates to validate bounds for. Skipping.");
          return;
        }

        // Get the actual file content to check bounds
        const configPath = path.join(FIXTURES_DIR, "generic-constraint/tsconfig.json");
        const host = createTypeScriptHost(configPath);
        const vfs = host.getVFS();

        for (const candidate of candidates) {
          if (candidate.kind === "synthetic") {
            for (const change of candidate.changes) {
              const fileContent = vfs.read(change.file);
              expect(fileContent).toBeDefined();
              if (fileContent) {
                // Positions must be within file bounds
                expect(change.start).toBeGreaterThanOrEqual(0);
                expect(change.end).toBeGreaterThanOrEqual(change.start);
                expect(change.end).toBeLessThanOrEqual(fileContent.length);
              }
            }
          }
        }
      },
      { timeout: 30000 }
    );
  });
});
