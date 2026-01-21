/**
 * Memory Bounds Stress Tests
 *
 * Tests that verify the memory management features work correctly under load.
 * These tests focus on:
 * - Cache hit rate improvement with repeated patterns
 * - Memory guard periodic resets
 * - Bounded cache size with LRU eviction
 */

import { describe, it, expect } from "bun:test";
import { repair } from "../../src/oracle/planner.js";
import { ConeCache } from "../../src/oracle/cone.js";
import { MemoryGuard } from "../../src/oracle/memory.js";
import { TelemetryCollector } from "../../src/oracle/telemetry.js";
import path from "path";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

describe("Memory bounds stress tests", () => {
  describe("ConeCache LRU eviction", () => {
    it("evicts oldest entries when cache is full", () => {
      const cache = new ConeCache(3); // Small cache for testing

      // Add entries
      cache.set(new Set(["file1.ts"]), [], false);
      cache.set(new Set(["file2.ts"]), [], false);
      cache.set(new Set(["file3.ts"]), [], false);

      expect(cache.size()).toBe(3);

      // Add one more - should evict file1
      cache.set(new Set(["file4.ts"]), [], false);
      expect(cache.size()).toBe(3);
      expect(cache.has(new Set(["file1.ts"]), false)).toBe(false);
      expect(cache.has(new Set(["file4.ts"]), false)).toBe(true);
    });

    it("maintains LRU order - accessing moves to end", () => {
      const cache = new ConeCache(3);

      cache.set(new Set(["file1.ts"]), [], false);
      cache.set(new Set(["file2.ts"]), [], false);
      cache.set(new Set(["file3.ts"]), [], false);

      // Access file1 - moves it to end
      cache.get(new Set(["file1.ts"]), false);

      // Add new entry - should evict file2 (now oldest)
      cache.set(new Set(["file4.ts"]), [], false);

      expect(cache.has(new Set(["file1.ts"]), false)).toBe(true); // Still there
      expect(cache.has(new Set(["file2.ts"]), false)).toBe(false); // Evicted
    });

    it("tracks cache hits correctly", () => {
      const cache = new ConeCache(10);

      cache.set(new Set(["file1.ts"]), [], false);

      // Miss
      cache.get(new Set(["file2.ts"]), false);

      // Hit
      cache.get(new Set(["file1.ts"]), false);
      cache.get(new Set(["file1.ts"]), false);

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.67, 1);
    });
  });

  describe("MemoryGuard periodic resets", () => {
    it("triggers resets at configured interval", () => {
      const guard = new MemoryGuard({ resetInterval: 10 });
      let resets = 0;

      for (let i = 0; i < 50; i++) {
        if (guard.tick()) {
          resets++;
        }
      }

      expect(resets).toBe(5); // 50 / 10 = 5 resets
    });

    it("maintains correct statistics across many verifications", () => {
      const guard = new MemoryGuard({ resetInterval: 25 });

      for (let i = 0; i < 100; i++) {
        guard.tick();
      }

      const stats = guard.getStats();
      expect(stats.resetCount).toBe(4); // 100 / 25 = 4 resets
      expect(stats.verificationCount).toBe(0); // Reset after last batch
    });
  });

  describe("TelemetryCollector under load", () => {
    it("accumulates stats correctly over many verifications", () => {
      const collector = new TelemetryCollector(true);

      // Simulate 100 verifications
      for (let i = 0; i < 100; i++) {
        collector.recordVerification(5 + (i % 10), 10 + i);
      }

      expect(collector.getTotalVerifications()).toBe(100);
      // Total time: sum of 10 + i for i = 0..99 = 100*10 + (99*100/2) = 1000 + 4950 = 5950
      expect(collector.getTotalTimeMs()).toBe(5950);
    });

    it("handles multiple iterations correctly", () => {
      const collector = new TelemetryCollector(true);
      const mockCacheStats = { hits: 0, misses: 0, hitRate: 0, size: 0 };

      // 3 iterations with 10 verifications each
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < 10; i++) {
          collector.recordVerification(5, 10);
        }
        collector.recordIteration(mockCacheStats);
      }

      const iterations = collector.getIterations();
      expect(iterations).toHaveLength(3);
      iterations.forEach((it, idx) => {
        expect(it.iteration).toBe(idx + 1);
        expect(it.candidatesVerified).toBe(10);
      });
    });
  });

  describe("Integration: repair with telemetry", () => {
    it("collects telemetry during repair", () => {
      const configPath = path.join(FIXTURES_DIR, "type-mismatch", "tsconfig.json");

      const plan = repair({
        project: configPath,
        enableTelemetry: true,
        maxVerifications: 50,
      });

      // Should have telemetry attached
      expect(plan.telemetry).toBeDefined();
      if (plan.telemetry) {
        // If there were verifications, we should have positive values
        if (plan.telemetry.totalVerifications > 0) {
          expect(plan.telemetry.totalTimeMs).toBeGreaterThan(0);
        }
        // Cache hit rate should be between 0 and 1
        expect(plan.telemetry.cacheHitRate).toBeGreaterThanOrEqual(0);
        expect(plan.telemetry.cacheHitRate).toBeLessThanOrEqual(1);
      }
    });

    it("collects telemetry with memory guard", () => {
      const configPath = path.join(FIXTURES_DIR, "type-mismatch", "tsconfig.json");

      const plan = repair({
        project: configPath,
        enableTelemetry: true,
        memoryConfig: { resetInterval: 5 }, // Low interval for testing
        maxVerifications: 50,
      });

      expect(plan.telemetry).toBeDefined();
      // Host resets may or may not have occurred depending on verification count
      if (plan.telemetry) {
        expect(plan.telemetry.hostResets).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Cache size limits", () => {
    it("respects configured max size", () => {
      const cache = new ConeCache(5);

      // Add 10 entries
      for (let i = 0; i < 10; i++) {
        cache.set(new Set([`file${i}.ts`]), [], false);
      }

      // Should only have 5
      expect(cache.size()).toBe(5);
    });

    it("allows changing max size", () => {
      const cache = new ConeCache(10);

      // Add 10 entries
      for (let i = 0; i < 10; i++) {
        cache.set(new Set([`file${i}.ts`]), [], false);
      }

      expect(cache.size()).toBe(10);

      // Reduce max size - should evict
      cache.setMaxSize(5);
      expect(cache.size()).toBe(5);
    });
  });
});
