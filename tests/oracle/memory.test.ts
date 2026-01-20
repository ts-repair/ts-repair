/**
 * Memory Guard Tests
 *
 * Tests for the MemoryGuard class that prevents unbounded memory growth
 * during long verification loops.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { MemoryGuard, DEFAULT_MEMORY_CONFIG } from "../../src/oracle/memory.js";

describe("MemoryGuard", () => {
  describe("construction", () => {
    it("uses default config when not specified", () => {
      const guard = new MemoryGuard();
      expect(guard.getResetInterval()).toBe(DEFAULT_MEMORY_CONFIG.resetInterval);
      expect(guard.getMaxCacheSize()).toBe(DEFAULT_MEMORY_CONFIG.maxCacheSize);
    });

    it("accepts partial config", () => {
      const guard = new MemoryGuard({ resetInterval: 25 });
      expect(guard.getResetInterval()).toBe(25);
      expect(guard.getMaxCacheSize()).toBe(DEFAULT_MEMORY_CONFIG.maxCacheSize);
    });

    it("accepts full config", () => {
      const guard = new MemoryGuard({
        resetInterval: 30,
        maxCacheSize: 200,
        logStats: true,
      });
      expect(guard.getResetInterval()).toBe(30);
      expect(guard.getMaxCacheSize()).toBe(200);
    });
  });

  describe("tick()", () => {
    it("returns false before reaching reset interval", () => {
      const guard = new MemoryGuard({ resetInterval: 5 });
      expect(guard.tick()).toBe(false);
      expect(guard.tick()).toBe(false);
      expect(guard.tick()).toBe(false);
      expect(guard.tick()).toBe(false);
    });

    it("returns true when reset interval is reached", () => {
      const guard = new MemoryGuard({ resetInterval: 3 });
      expect(guard.tick()).toBe(false);
      expect(guard.tick()).toBe(false);
      expect(guard.tick()).toBe(true); // 3rd tick triggers reset
    });

    it("resets counter after triggering", () => {
      const guard = new MemoryGuard({ resetInterval: 2 });
      expect(guard.tick()).toBe(false);
      expect(guard.tick()).toBe(true); // Reset triggered
      expect(guard.tick()).toBe(false); // Counter reset
      expect(guard.tick()).toBe(true); // Reset triggered again
    });

    it("increments reset count each time reset is triggered", () => {
      const guard = new MemoryGuard({ resetInterval: 2 });
      expect(guard.getResetCount()).toBe(0);
      guard.tick();
      guard.tick(); // Triggers reset
      expect(guard.getResetCount()).toBe(1);
      guard.tick();
      guard.tick(); // Triggers reset again
      expect(guard.getResetCount()).toBe(2);
    });
  });

  describe("getStats()", () => {
    it("returns correct verification count", () => {
      const guard = new MemoryGuard({ resetInterval: 10 });
      guard.tick();
      guard.tick();
      guard.tick();
      const stats = guard.getStats();
      expect(stats.verificationCount).toBe(3);
    });

    it("returns correct reset count", () => {
      const guard = new MemoryGuard({ resetInterval: 2 });
      guard.tick();
      guard.tick(); // Reset 1
      guard.tick();
      guard.tick(); // Reset 2
      const stats = guard.getStats();
      expect(stats.resetCount).toBe(2);
    });

    it("includes config in stats", () => {
      const guard = new MemoryGuard({
        resetInterval: 25,
        maxCacheSize: 150,
        logStats: false,
      });
      const stats = guard.getStats();
      expect(stats.config.resetInterval).toBe(25);
      expect(stats.config.maxCacheSize).toBe(150);
      expect(stats.config.logStats).toBe(false);
    });
  });

  describe("reset()", () => {
    it("resets verification count to zero", () => {
      const guard = new MemoryGuard({ resetInterval: 10 });
      guard.tick();
      guard.tick();
      guard.tick();
      guard.reset();
      expect(guard.getVerificationCount()).toBe(0);
    });

    it("resets reset count to zero", () => {
      const guard = new MemoryGuard({ resetInterval: 2 });
      guard.tick();
      guard.tick(); // Triggers reset
      expect(guard.getResetCount()).toBe(1);
      guard.reset();
      expect(guard.getResetCount()).toBe(0);
    });
  });

  describe("resetHost()", () => {
    it("calls refreshLanguageService on host", () => {
      const guard = new MemoryGuard();
      let refreshCalled = false;
      const mockHost = {
        refreshLanguageService: () => {
          refreshCalled = true;
        },
      } as any;

      guard.resetHost(mockHost);
      expect(refreshCalled).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles reset interval of 1", () => {
      const guard = new MemoryGuard({ resetInterval: 1 });
      expect(guard.tick()).toBe(true); // Every tick triggers reset
      expect(guard.tick()).toBe(true);
      expect(guard.tick()).toBe(true);
      expect(guard.getResetCount()).toBe(3);
    });

    it("handles large numbers of verifications", () => {
      const guard = new MemoryGuard({ resetInterval: 100 });
      let resetCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (guard.tick()) {
          resetCount++;
        }
      }
      expect(resetCount).toBe(10); // 1000 / 100 = 10 resets
    });
  });
});
