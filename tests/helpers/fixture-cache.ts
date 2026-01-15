/**
 * Test Fixture Cache
 *
 * Caches TypeScriptHost instances by config path to avoid recreating
 * the expensive TypeScript Language Service for each test.
 *
 * Usage:
 *   const host = getFixtureHost("async-await");
 *   // host is cached and reset to original state
 *
 * The host's VFS is reset before returning, ensuring test isolation.
 */

import path from "path";
import {
  createTypeScriptHost,
  type TypeScriptHost,
} from "../../src/oracle/typescript.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures");

// Cache of hosts by config path
const hostCache = new Map<string, TypeScriptHost>();

/**
 * Get a cached TypeScriptHost for a fixture.
 * The host's VFS is reset to original state before returning.
 *
 * @param fixtureName - Name of the fixture directory (e.g., "async-await")
 * @returns A TypeScriptHost with VFS reset to original state
 */
export function getFixtureHost(fixtureName: string): TypeScriptHost {
  const configPath = path.join(FIXTURES_DIR, fixtureName, "tsconfig.json");

  let host = hostCache.get(configPath);
  if (!host) {
    host = createTypeScriptHost(configPath);
    hostCache.set(configPath, host);
  }

  // Reset VFS to ensure test isolation
  host.reset();

  return host;
}

/**
 * Get the fixtures directory path.
 */
export function getFixturesDir(): string {
  return FIXTURES_DIR;
}

/**
 * Clear the host cache. Call this if you need to force recreation of hosts.
 */
export function clearHostCache(): void {
  hostCache.clear();
}
