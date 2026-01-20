/**
 * Corpus Loader
 *
 * Functions to load, filter, and validate the benchmark corpus.
 * The corpus is a collection of TypeScript fixtures used for benchmarking.
 */

import fs from "fs";
import path from "path";
import type { CorpusConfig, CorpusEntry } from "./types.js";

const DEFAULT_CORPUS_PATH = "tests/benchmark/corpus.json";

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Options for filtering corpus entries.
 */
export interface CorpusFilter {
  /** Only include entries from these categories */
  categories?: Array<"synthetic" | "builder-specific" | "real-world">;
  /** Only include entries that apply to these builders */
  builders?: string[];
  /** Exclude entries with more than this many initial errors */
  maxInitialErrors?: number;
  /** Only include entries with these names */
  names?: string[];
}

/**
 * Result of validating a corpus entry.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Summary statistics about the corpus.
 */
export interface CorpusStats {
  /** Total number of entries */
  total: number;
  /** Count of entries by category */
  byCategory: Record<string, number>;
  /** Count of entries by applicable builder */
  byBuilder: Record<string, number>;
  /** Total initial error count (from metadata) */
  totalInitialErrors: number;
  /** Count of entries with metadata */
  entriesWithMetadata: number;
}

// ============================================================================
// Corpus Loading
// ============================================================================

/**
 * Raw corpus entry from JSON (before transformation).
 */
interface RawCorpusEntry {
  name?: unknown;
  category?: unknown;
  configPath?: unknown;
  expectedOutcome?: {
    minErrorReduction?: unknown;
    targetErrorReduction?: unknown;
    applicableBuilders?: unknown;
  };
  metadata?: {
    errorCodes?: unknown;
    fileCount?: unknown;
    initialErrorCount?: unknown;
  };
}

/**
 * Validates and transforms a raw corpus entry from JSON into a typed CorpusEntry.
 * Throws an error if the entry is invalid.
 */
function validateAndTransform(raw: RawCorpusEntry, index: number): CorpusEntry {
  // Validate required fields
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    throw new Error(`Corpus entry at index ${index} has invalid or missing 'name'`);
  }

  const validCategories = ["synthetic", "builder-specific", "real-world"];
  if (typeof raw.category !== "string" || !validCategories.includes(raw.category)) {
    throw new Error(
      `Corpus entry '${raw.name}' has invalid category: '${raw.category}'. ` +
        `Must be one of: ${validCategories.join(", ")}`
    );
  }

  if (typeof raw.configPath !== "string" || raw.configPath.length === 0) {
    throw new Error(`Corpus entry '${raw.name}' has invalid or missing 'configPath'`);
  }

  // Validate expectedOutcome
  if (!raw.expectedOutcome || typeof raw.expectedOutcome !== "object") {
    throw new Error(`Corpus entry '${raw.name}' has invalid or missing 'expectedOutcome'`);
  }

  const { minErrorReduction, targetErrorReduction, applicableBuilders } = raw.expectedOutcome;

  if (typeof minErrorReduction !== "number" || minErrorReduction < 0 || minErrorReduction > 1) {
    throw new Error(
      `Corpus entry '${raw.name}' has invalid 'minErrorReduction': ${minErrorReduction}. ` +
        `Must be a number between 0 and 1`
    );
  }

  if (
    typeof targetErrorReduction !== "number" ||
    targetErrorReduction < 0 ||
    targetErrorReduction > 1
  ) {
    throw new Error(
      `Corpus entry '${raw.name}' has invalid 'targetErrorReduction': ${targetErrorReduction}. ` +
        `Must be a number between 0 and 1`
    );
  }

  if (targetErrorReduction < minErrorReduction) {
    throw new Error(
      `Corpus entry '${raw.name}' has targetErrorReduction (${targetErrorReduction}) ` +
        `less than minErrorReduction (${minErrorReduction})`
    );
  }

  if (!Array.isArray(applicableBuilders)) {
    throw new Error(
      `Corpus entry '${raw.name}' has invalid 'applicableBuilders': must be an array`
    );
  }
  // Note: Empty array is valid for synthetic fixtures that use TS language service only

  for (const builder of applicableBuilders) {
    if (typeof builder !== "string" || builder.length === 0) {
      throw new Error(
        `Corpus entry '${raw.name}' has invalid builder in 'applicableBuilders': ${builder}`
      );
    }
  }

  // Build the entry
  const entry: CorpusEntry = {
    name: raw.name,
    category: raw.category as CorpusEntry["category"],
    configPath: raw.configPath,
    expectedOutcome: {
      minErrorReduction,
      targetErrorReduction,
      applicableBuilders: applicableBuilders as string[],
    },
  };

  // Validate and add optional metadata
  if (raw.metadata && typeof raw.metadata === "object") {
    const metadata: CorpusEntry["metadata"] = {};

    if (raw.metadata.errorCodes !== undefined) {
      if (!Array.isArray(raw.metadata.errorCodes)) {
        throw new Error(`Corpus entry '${raw.name}' has invalid 'metadata.errorCodes': must be an array`);
      }
      for (const code of raw.metadata.errorCodes) {
        if (typeof code !== "number" || !Number.isInteger(code)) {
          throw new Error(
            `Corpus entry '${raw.name}' has invalid error code in 'metadata.errorCodes': ${code}`
          );
        }
      }
      metadata.errorCodes = raw.metadata.errorCodes as number[];
    }

    if (raw.metadata.fileCount !== undefined) {
      if (typeof raw.metadata.fileCount !== "number" || raw.metadata.fileCount < 0) {
        throw new Error(
          `Corpus entry '${raw.name}' has invalid 'metadata.fileCount': ${raw.metadata.fileCount}`
        );
      }
      metadata.fileCount = raw.metadata.fileCount;
    }

    if (raw.metadata.initialErrorCount !== undefined) {
      if (
        typeof raw.metadata.initialErrorCount !== "number" ||
        raw.metadata.initialErrorCount < 0
      ) {
        throw new Error(
          `Corpus entry '${raw.name}' has invalid 'metadata.initialErrorCount': ${raw.metadata.initialErrorCount}`
        );
      }
      metadata.initialErrorCount = raw.metadata.initialErrorCount;
    }

    // Only add metadata if it has properties
    if (Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }
  }

  return entry;
}

/**
 * Loads the benchmark corpus from a JSON file.
 *
 * @param corpusPath - Path to the corpus JSON file. Defaults to tests/benchmark/corpus.json
 * @returns The parsed and validated CorpusConfig
 * @throws Error if the file doesn't exist, is invalid JSON, or contains invalid entries
 */
export function loadCorpus(corpusPath?: string): CorpusConfig {
  const filePath = corpusPath ?? DEFAULT_CORPUS_PATH;

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Corpus file not found: ${filePath}`);
  }

  // Read and parse the file
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read corpus file '${filePath}': ${message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse corpus file '${filePath}' as JSON: ${message}`);
  }

  // Validate top-level structure
  if (!data || typeof data !== "object") {
    throw new Error(`Corpus file '${filePath}' must contain a JSON object`);
  }

  const dataObj = data as Record<string, unknown>;

  if (!Array.isArray(dataObj.entries)) {
    throw new Error(`Corpus file '${filePath}' must have an 'entries' array`);
  }

  // Validate and transform each entry
  const entries = dataObj.entries.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Corpus entry at index ${index} is not an object`);
    }
    return validateAndTransform(entry as RawCorpusEntry, index);
  });

  // Check for duplicate names
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new Error(`Duplicate corpus entry name: '${entry.name}'`);
    }
    names.add(entry.name);
  }

  return { entries };
}

// ============================================================================
// Corpus Filtering
// ============================================================================

/**
 * Filters corpus entries based on the provided filter options.
 *
 * @param corpus - The corpus to filter
 * @param filter - Filter options
 * @returns A new CorpusConfig with filtered entries
 */
export function filterCorpus(corpus: CorpusConfig, filter: CorpusFilter): CorpusConfig {
  let entries = corpus.entries;

  // Filter by category
  if (filter.categories && filter.categories.length > 0) {
    entries = entries.filter((e) => filter.categories!.includes(e.category));
  }

  // Filter by applicable builders
  if (filter.builders && filter.builders.length > 0) {
    entries = entries.filter((e) =>
      e.expectedOutcome.applicableBuilders.some((b) => filter.builders!.includes(b))
    );
  }

  // Filter by max initial errors
  if (filter.maxInitialErrors !== undefined && filter.maxInitialErrors >= 0) {
    entries = entries.filter((e) => {
      // If metadata doesn't include initialErrorCount, include the entry
      // (we can't filter what we don't know)
      if (e.metadata?.initialErrorCount === undefined) {
        return true;
      }
      return e.metadata.initialErrorCount <= filter.maxInitialErrors!;
    });
  }

  // Filter by names
  if (filter.names && filter.names.length > 0) {
    const nameSet = new Set(filter.names);
    entries = entries.filter((e) => nameSet.has(e.name));
  }

  return { entries };
}

// ============================================================================
// Corpus Validation
// ============================================================================

/**
 * Validates that a corpus entry's configPath exists on disk.
 *
 * @param entry - The corpus entry to validate
 * @param basePath - Optional base path to resolve relative configPaths against
 * @returns Validation result with error message if invalid
 */
export function validateCorpusEntry(entry: CorpusEntry, basePath?: string): ValidationResult {
  // Resolve the config path
  const configPath = basePath ? path.resolve(basePath, entry.configPath) : entry.configPath;

  // Check if the config file exists
  if (!fs.existsSync(configPath)) {
    return {
      valid: false,
      error: `Config file not found: ${configPath}`,
    };
  }

  // Check if it's a file (not a directory)
  try {
    const stat = fs.statSync(configPath);
    if (!stat.isFile()) {
      return {
        valid: false,
        error: `Config path is not a file: ${configPath}`,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `Failed to stat config path '${configPath}': ${message}`,
    };
  }

  // Optionally, validate it's valid JSON (tsconfig.json should be valid JSON)
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `Config file is not valid JSON: ${message}`,
    };
  }

  return { valid: true };
}

/**
 * Validates all entries in a corpus.
 *
 * @param corpus - The corpus to validate
 * @param basePath - Optional base path to resolve relative configPaths against
 * @returns Array of validation results, one per entry
 */
export function validateCorpus(
  corpus: CorpusConfig,
  basePath?: string
): Array<{ entry: CorpusEntry; result: ValidationResult }> {
  return corpus.entries.map((entry) => ({
    entry,
    result: validateCorpusEntry(entry, basePath),
  }));
}

// ============================================================================
// Corpus Statistics
// ============================================================================

/**
 * Computes summary statistics about a corpus.
 *
 * @param corpus - The corpus to analyze
 * @returns Statistics including counts by category and builder
 */
export function getCorpusStats(corpus: CorpusConfig): CorpusStats {
  const byCategory: Record<string, number> = {};
  const byBuilder: Record<string, number> = {};
  let totalInitialErrors = 0;
  let entriesWithMetadata = 0;

  for (const entry of corpus.entries) {
    // Count by category
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;

    // Count by builder (each entry can have multiple builders)
    for (const builder of entry.expectedOutcome.applicableBuilders) {
      byBuilder[builder] = (byBuilder[builder] ?? 0) + 1;
    }

    // Sum initial errors from metadata
    if (entry.metadata) {
      entriesWithMetadata++;
      if (entry.metadata.initialErrorCount !== undefined) {
        totalInitialErrors += entry.metadata.initialErrorCount;
      }
    }
  }

  return {
    total: corpus.entries.length,
    byCategory,
    byBuilder,
    totalInitialErrors,
    entriesWithMetadata,
  };
}
