/**
 * Telemetry Collector Tests
 *
 * Tests for the TelemetryCollector class that tracks verification timing,
 * cone sizes, and cache performance.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { TelemetryCollector } from "../../src/oracle/telemetry.js";
import type { CacheStats } from "../../src/output/types.js";

describe("TelemetryCollector", () => {
  describe("construction", () => {
    it("is disabled by default when constructed with false", () => {
      const collector = new TelemetryCollector(false);
      expect(collector.isEnabled()).toBe(false);
    });

    it("can be enabled on construction", () => {
      const collector = new TelemetryCollector(true);
      expect(collector.isEnabled()).toBe(true);
    });

    it("starts with zero counters", () => {
      const collector = new TelemetryCollector(true);
      expect(collector.getTotalVerifications()).toBe(0);
      expect(collector.getTotalTimeMs()).toBe(0);
      expect(collector.getHostResets()).toBe(0);
    });
  });

  describe("setEnabled()", () => {
    it("allows enabling telemetry", () => {
      const collector = new TelemetryCollector(false);
      expect(collector.isEnabled()).toBe(false);
      collector.setEnabled(true);
      expect(collector.isEnabled()).toBe(true);
    });

    it("allows disabling telemetry", () => {
      const collector = new TelemetryCollector(true);
      expect(collector.isEnabled()).toBe(true);
      collector.setEnabled(false);
      expect(collector.isEnabled()).toBe(false);
    });
  });

  describe("recordVerification()", () => {
    it("does nothing when disabled", () => {
      const collector = new TelemetryCollector(false);
      collector.recordVerification(5, 100);
      expect(collector.getTotalVerifications()).toBe(0);
      expect(collector.getTotalTimeMs()).toBe(0);
    });

    it("tracks verification count when enabled", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordVerification(3, 50);
      expect(collector.getTotalVerifications()).toBe(2);
    });

    it("tracks total time when enabled", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordVerification(3, 50);
      expect(collector.getTotalTimeMs()).toBe(150);
    });
  });

  describe("recordHostReset()", () => {
    it("does nothing when disabled", () => {
      const collector = new TelemetryCollector(false);
      collector.recordHostReset();
      expect(collector.getHostResets()).toBe(0);
    });

    it("tracks host resets when enabled", () => {
      const collector = new TelemetryCollector(true);
      collector.recordHostReset();
      collector.recordHostReset();
      expect(collector.getHostResets()).toBe(2);
    });
  });

  describe("recordIteration()", () => {
    const mockCacheStats: CacheStats = {
      hits: 10,
      misses: 5,
      hitRate: 0.67,
      size: 15,
    };

    it("does nothing when disabled", () => {
      const collector = new TelemetryCollector(false);
      collector.recordVerification(5, 100);
      collector.recordIteration(mockCacheStats);
      expect(collector.getIterations()).toHaveLength(0);
    });

    it("records iteration stats when enabled", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordVerification(3, 50);
      collector.recordIteration(mockCacheStats);

      const iterations = collector.getIterations();
      expect(iterations).toHaveLength(1);
      expect(iterations[0].iteration).toBe(1);
      expect(iterations[0].candidatesVerified).toBe(2);
      expect(iterations[0].timeMs).toBe(150);
      expect(iterations[0].avgConeSize).toBe(4); // (5 + 3) / 2
    });

    it("resets per-iteration counters after recording", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordIteration(mockCacheStats);

      // Start new iteration
      collector.recordVerification(10, 200);
      collector.recordIteration(mockCacheStats);

      const iterations = collector.getIterations();
      expect(iterations).toHaveLength(2);
      expect(iterations[1].iteration).toBe(2);
      expect(iterations[1].candidatesVerified).toBe(1);
      expect(iterations[1].timeMs).toBe(200);
      expect(iterations[1].avgConeSize).toBe(10);
    });

    it("skips empty iterations", () => {
      const collector = new TelemetryCollector(true);
      collector.recordIteration(mockCacheStats); // No verifications
      expect(collector.getIterations()).toHaveLength(0);
    });
  });

  describe("getSummary()", () => {
    const mockCacheStats: CacheStats = {
      hits: 20,
      misses: 10,
      hitRate: 0.67,
      size: 30,
    };

    it("returns correct total verifications", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordVerification(3, 50);
      collector.recordVerification(7, 150);

      const summary = collector.getSummary(mockCacheStats);
      expect(summary.totalVerifications).toBe(3);
    });

    it("returns correct total time", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordVerification(3, 50);

      const summary = collector.getSummary(mockCacheStats);
      expect(summary.totalTimeMs).toBe(150);
    });

    it("calculates correct average cone size", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(4, 100); // cone = 4
      collector.recordVerification(6, 100); // cone = 6

      const summary = collector.getSummary(mockCacheStats);
      expect(summary.avgConeSize).toBe(5); // (4 + 6) / 2
    });

    it("returns zero average cone size when no verifications", () => {
      const collector = new TelemetryCollector(true);
      const summary = collector.getSummary(mockCacheStats);
      expect(summary.avgConeSize).toBe(0);
    });

    it("includes cache hit rate from cache stats", () => {
      const collector = new TelemetryCollector(true);
      const summary = collector.getSummary(mockCacheStats);
      expect(summary.cacheHitRate).toBe(0.67);
    });

    it("includes host resets count", () => {
      const collector = new TelemetryCollector(true);
      collector.recordHostReset();
      collector.recordHostReset();

      const summary = collector.getSummary(mockCacheStats);
      expect(summary.hostResets).toBe(2);
    });

    it("includes iterations when present", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordIteration(mockCacheStats);

      const summary = collector.getSummary(mockCacheStats);
      expect(summary.iterations).toBeDefined();
      expect(summary.iterations).toHaveLength(1);
    });

    it("excludes iterations when empty", () => {
      const collector = new TelemetryCollector(true);
      const summary = collector.getSummary(mockCacheStats);
      expect(summary.iterations).toBeUndefined();
    });
  });

  describe("reset()", () => {
    it("resets all counters", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordVerification(3, 50);
      collector.recordHostReset();
      collector.recordIteration({ hits: 1, misses: 1, hitRate: 0.5, size: 2 });

      collector.reset();

      expect(collector.getTotalVerifications()).toBe(0);
      expect(collector.getTotalTimeMs()).toBe(0);
      expect(collector.getHostResets()).toBe(0);
      expect(collector.getIterations()).toHaveLength(0);
    });
  });

  describe("getCurrentIteration()", () => {
    it("returns 1 initially", () => {
      const collector = new TelemetryCollector(true);
      expect(collector.getCurrentIteration()).toBe(1);
    });

    it("increments after recording iteration", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 100);
      collector.recordIteration({ hits: 1, misses: 1, hitRate: 0.5, size: 2 });
      expect(collector.getCurrentIteration()).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("handles zero time verifications", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(5, 0);
      expect(collector.getTotalTimeMs()).toBe(0);
    });

    it("handles zero cone size", () => {
      const collector = new TelemetryCollector(true);
      collector.recordVerification(0, 100);
      const summary = collector.getSummary({ hits: 0, misses: 0, hitRate: 0, size: 0 });
      expect(summary.avgConeSize).toBe(0);
    });

    it("handles large numbers", () => {
      const collector = new TelemetryCollector(true);
      for (let i = 0; i < 1000; i++) {
        collector.recordVerification(10, 10);
      }
      expect(collector.getTotalVerifications()).toBe(1000);
      expect(collector.getTotalTimeMs()).toBe(10000);
    });
  });
});
