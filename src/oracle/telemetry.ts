/**
 * Verification Telemetry
 *
 * Collects timing, cone size, and cache stats for verification runs.
 * Used to understand performance characteristics and optimize verification.
 */

import type {
  VerificationTelemetry,
  IterationTelemetry,
  CacheStats,
} from "../output/types.js";

/**
 * Collector for verification telemetry data.
 * Tracks verifications, timings, cone sizes, and cache performance.
 */
export class TelemetryCollector {
  private verifications = 0;
  private totalTimeMs = 0;
  private totalConeSize = 0;
  private hostResets = 0;
  private iterations: IterationTelemetry[] = [];
  private enabled: boolean;

  // Per-iteration tracking
  private currentIterationCandidates = 0;
  private currentIterationTime = 0;
  private currentIterationConeSize = 0;
  private currentIterationHits = 0;
  private currentIterationMisses = 0;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  /**
   * Check if telemetry collection is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable telemetry collection.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Record a single verification.
   * @param coneSize Number of files in the verification cone
   * @param timeMs Time spent on this verification in milliseconds
   */
  recordVerification(coneSize: number, timeMs: number): void {
    if (!this.enabled) return;
    this.verifications++;
    this.totalTimeMs += timeMs;
    this.totalConeSize += coneSize;
    this.currentIterationCandidates++;
    this.currentIterationTime += timeMs;
    this.currentIterationConeSize += coneSize;
  }

  /**
   * Record a host reset event.
   */
  recordHostReset(): void {
    if (!this.enabled) return;
    this.hostResets++;
  }

  /**
   * Record cache hit/miss stats for the current iteration.
   * Called before starting verification loop to capture deltas.
   */
  recordCacheStats(hits: number, misses: number): void {
    if (!this.enabled) return;
    this.currentIterationHits = hits;
    this.currentIterationMisses = misses;
  }

  /**
   * Finalize the current iteration and record its stats.
   * Should be called at the end of each planning iteration.
   * @param cacheStats Current cache statistics (to compute delta from last iteration)
   */
  recordIteration(cacheStats: CacheStats): void {
    if (!this.enabled) return;

    // Only record if there were verifications in this iteration
    if (this.currentIterationCandidates === 0) return;

    const avgConeSize =
      this.currentIterationCandidates > 0
        ? this.currentIterationConeSize / this.currentIterationCandidates
        : 0;

    // Compute hit/miss delta since last recordCacheStats call
    const hitsDelta = cacheStats.hits - this.currentIterationHits;
    const missesDelta = cacheStats.misses - this.currentIterationMisses;

    this.iterations.push({
      iteration: this.iterations.length + 1,
      candidatesVerified: this.currentIterationCandidates,
      timeMs: this.currentIterationTime,
      avgConeSize,
      cacheHits: hitsDelta > 0 ? hitsDelta : cacheStats.hits,
      cacheMisses: missesDelta > 0 ? missesDelta : cacheStats.misses,
    });

    // Reset per-iteration counters
    this.currentIterationCandidates = 0;
    this.currentIterationTime = 0;
    this.currentIterationConeSize = 0;
    this.currentIterationHits = cacheStats.hits;
    this.currentIterationMisses = cacheStats.misses;
  }

  /**
   * Get the current iteration number.
   */
  getCurrentIteration(): number {
    return this.iterations.length + 1;
  }

  /**
   * Get a summary of all collected telemetry.
   * @param cacheStats Final cache statistics
   */
  getSummary(cacheStats: CacheStats): VerificationTelemetry {
    return {
      totalVerifications: this.verifications,
      totalTimeMs: this.totalTimeMs,
      avgConeSize:
        this.verifications > 0 ? this.totalConeSize / this.verifications : 0,
      cacheHitRate: cacheStats.hitRate,
      hostResets: this.hostResets,
      iterations: this.iterations.length > 0 ? this.iterations : undefined,
    };
  }

  /**
   * Reset all telemetry data.
   */
  reset(): void {
    this.verifications = 0;
    this.totalTimeMs = 0;
    this.totalConeSize = 0;
    this.hostResets = 0;
    this.iterations = [];
    this.currentIterationCandidates = 0;
    this.currentIterationTime = 0;
    this.currentIterationConeSize = 0;
    this.currentIterationHits = 0;
    this.currentIterationMisses = 0;
  }

  /**
   * Get the total number of verifications recorded.
   */
  getTotalVerifications(): number {
    return this.verifications;
  }

  /**
   * Get the total time spent on verifications.
   */
  getTotalTimeMs(): number {
    return this.totalTimeMs;
  }

  /**
   * Get the number of host resets recorded.
   */
  getHostResets(): number {
    return this.hostResets;
  }

  /**
   * Get all recorded iteration telemetry.
   */
  getIterations(): IterationTelemetry[] {
    return [...this.iterations];
  }
}
