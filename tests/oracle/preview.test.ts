/**
 * Preview Unit Tests
 *
 * Tests for budget impact preview functionality.
 */

import { describe, it, expect } from "bun:test";
import {
  previewBudgetImpact,
  formatPreviewText,
  formatPreviewJSON,
} from "../../src/oracle/preview.js";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("previewBudgetImpact", () => {
  describe("basic functionality", () => {
    it("returns preview for error-free project", () => {
      const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
      const preview = previewBudgetImpact(configPath);

      expect(preview.estimatedVerifications).toBe(0);
      expect(preview.estimatedCandidates).toBe(0);
      expect(preview.diagnosticBreakdown).toHaveLength(0);
    });

    it("returns preview for project with errors", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const preview = previewBudgetImpact(configPath);

      expect(preview.estimatedVerifications).toBeGreaterThan(0);
      expect(preview.estimatedCandidates).toBeGreaterThan(0);
      expect(preview.diagnosticBreakdown.length).toBeGreaterThan(0);
    });

    it("includes diagnostic information in breakdown", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const preview = previewBudgetImpact(configPath);

      if (preview.diagnosticBreakdown.length > 0) {
        const item = preview.diagnosticBreakdown[0];
        expect(item.diagnostic).toBeDefined();
        expect(item.diagnostic.code).toBeDefined();
        expect(item.diagnostic.message).toBeDefined();
        expect(item.diagnostic.file).toBeDefined();
        expect(typeof item.candidateCount).toBe("number");
        expect(typeof item.estimatedCost).toBe("number");
      }
    });
  });

  describe("options", () => {
    it("respects maxCandidates option", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const preview1 = previewBudgetImpact(configPath, { maxCandidates: 1 });
      const preview2 = previewBudgetImpact(configPath, { maxCandidates: 10 });

      // With lower maxCandidates, estimated cost per diagnostic should be lower or equal
      for (let i = 0; i < preview1.diagnosticBreakdown.length; i++) {
        expect(preview1.diagnosticBreakdown[i].estimatedCost).toBeLessThanOrEqual(
          preview2.diagnosticBreakdown[i].estimatedCost
        );
      }
    });

    it("respects includeHighRisk option", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const previewWithHighRisk = previewBudgetImpact(configPath, {
        includeHighRisk: true,
      });
      const previewWithoutHighRisk = previewBudgetImpact(configPath, {
        includeHighRisk: false,
      });

      // Including high-risk should have >= estimated verifications
      expect(previewWithHighRisk.estimatedVerifications).toBeGreaterThanOrEqual(
        previewWithoutHighRisk.estimatedVerifications
      );
    });
  });

  describe("estimation accuracy", () => {
    it("estimatedCandidates includes all candidates", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const preview = previewBudgetImpact(configPath);

      // Sum of candidateCounts should equal estimatedCandidates
      const totalCandidates = preview.diagnosticBreakdown.reduce(
        (sum, item) => sum + item.candidateCount,
        0
      );
      expect(preview.estimatedCandidates).toBe(totalCandidates);
    });

    it("estimatedVerifications is sum of estimatedCosts", () => {
      const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
      const preview = previewBudgetImpact(configPath);

      const totalCost = preview.diagnosticBreakdown.reduce(
        (sum, item) => sum + item.estimatedCost,
        0
      );
      expect(preview.estimatedVerifications).toBe(totalCost);
    });
  });
});

describe("formatPreviewText", () => {
  it("formats preview for console output", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
    const preview = previewBudgetImpact(configPath);
    const text = formatPreviewText(preview);

    expect(text).toContain("Budget Preview");
    expect(text).toContain("Diagnostics:");
    expect(text).toContain("Candidates (total):");
    expect(text).toContain("Estimated verifications:");
    expect(text).toContain("By diagnostic:");
  });

  it("includes diagnostic details in output", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
    const preview = previewBudgetImpact(configPath);
    const text = formatPreviewText(preview);

    // Should include file names and TS error codes
    expect(text).toContain("TS");
    expect(text).toContain("Candidates:");
    expect(text).toContain("Est. cost:");
  });

  it("handles empty preview", () => {
    const configPath = path.join(FIXTURES_DIR, "no-errors/tsconfig.json");
    const preview = previewBudgetImpact(configPath);
    const text = formatPreviewText(preview);

    expect(text).toContain("Diagnostics: 0");
    expect(text).toContain("Candidates (total): 0");
    expect(text).toContain("Estimated verifications: 0");
  });
});

describe("formatPreviewJSON", () => {
  it("returns valid JSON", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
    const preview = previewBudgetImpact(configPath);
    const json = formatPreviewJSON(preview);

    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("includes all preview fields", () => {
    const configPath = path.join(FIXTURES_DIR, "async-await/tsconfig.json");
    const preview = previewBudgetImpact(configPath);
    const json = formatPreviewJSON(preview);
    const parsed = JSON.parse(json);

    expect(parsed.estimatedVerifications).toBe(preview.estimatedVerifications);
    expect(parsed.estimatedCandidates).toBe(preview.estimatedCandidates);
    expect(parsed.diagnosticBreakdown).toHaveLength(
      preview.diagnosticBreakdown.length
    );
  });
});
