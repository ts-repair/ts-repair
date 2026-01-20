/**
 * Memory Guards
 *
 * Prevents unbounded memory growth during verification loops by periodically
 * resetting the TypeScript host and enforcing cache bounds.
 */

import type { TypeScriptHost } from "./typescript.js";
import type { MemoryGuardConfig } from "../output/types.js";

/**
 * Default memory guard configuration.
 */
export const DEFAULT_MEMORY_CONFIG: MemoryGuardConfig = {
  resetInterval: 50,
  maxCacheSize: 100,
  logStats: false,
};

/**
 * Memory guard that tracks verifications and triggers periodic host resets
 * to prevent unbounded memory growth in long-running verification loops.
 */
export class MemoryGuard {
  private verificationCount = 0;
  private resetCount = 0;
  private config: MemoryGuardConfig;

  constructor(config: Partial<MemoryGuardConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  /**
   * Called after each verification.
   * Returns true if the host should be reset to reclaim memory.
   */
  tick(): boolean {
    this.verificationCount++;
    if (this.verificationCount >= this.config.resetInterval) {
      this.verificationCount = 0;
      this.resetCount++;
      return true;
    }
    return false;
  }

  /**
   * Reset host state to reclaim memory.
   * This refreshes the language service and logs memory stats if enabled.
   */
  resetHost(host: TypeScriptHost): void {
    // Refresh the language service to release cached ASTs and diagnostics
    host.refreshLanguageService();

    if (this.config.logStats) {
      const mem = process.memoryUsage();
      console.error(
        `[memory] Reset #${this.resetCount}: heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB, ` +
          `rss=${Math.round(mem.rss / 1024 / 1024)}MB`
      );
    }
  }

  /**
   * Get the current memory guard statistics.
   */
  getStats(): {
    verificationCount: number;
    resetCount: number;
    config: MemoryGuardConfig;
  } {
    return {
      verificationCount: this.verificationCount,
      resetCount: this.resetCount,
      config: this.config,
    };
  }

  /**
   * Get the number of host resets performed.
   */
  getResetCount(): number {
    return this.resetCount;
  }

  /**
   * Get the current verification count within the reset interval.
   */
  getVerificationCount(): number {
    return this.verificationCount;
  }

  /**
   * Reset the guard state (for testing).
   */
  reset(): void {
    this.verificationCount = 0;
    this.resetCount = 0;
  }

  /**
   * Get the configured reset interval.
   */
  getResetInterval(): number {
    return this.config.resetInterval;
  }

  /**
   * Get the configured max cache size.
   */
  getMaxCacheSize(): number {
    return this.config.maxCacheSize;
  }
}
