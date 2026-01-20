/**
 * Solution Builder Framework
 *
 * Provides infrastructure for pluggable repair builders that generate
 * synthetic fix candidates for specific diagnostic patterns.
 */

import ts from "typescript";
import type {
  SolutionBuilder,
  BuilderContext,
  BuilderMatchResult,
  CandidateFix,
} from "../output/types.js";
import type { TypeScriptHost } from "./typescript.js";

/**
 * Registry for solution builders.
 * Indexes builders by diagnostic code for O(1) routing.
 */
export class BuilderRegistry {
  /** All registered builders */
  private builders: SolutionBuilder[] = [];

  /** Index: diagnostic code -> builders that handle it */
  private byCode: Map<number, SolutionBuilder[]> = new Map();

  /** Catch-all builders (no code/pattern specified) */
  private catchAllBuilders: SolutionBuilder[] = [];

  /**
   * Register a builder and index it by diagnostic codes.
   */
  register(builder: SolutionBuilder): void {
    this.builders.push(builder);

    // Index by diagnostic codes for fast routing
    if (builder.diagnosticCodes && builder.diagnosticCodes.length > 0) {
      for (const code of builder.diagnosticCodes) {
        const existing = this.byCode.get(code) ?? [];
        existing.push(builder);
        this.byCode.set(code, existing);
      }
    } else if (!builder.messagePatterns || builder.messagePatterns.length === 0) {
      // No codes or patterns - this is a catch-all builder
      this.catchAllBuilders.push(builder);
    }
  }

  /**
   * Get all registered builders.
   */
  getAll(): readonly SolutionBuilder[] {
    return this.builders;
  }

  /**
   * Get candidate builders for a diagnostic (fast O(1) by code).
   * Returns builders that:
   * 1. Are indexed for this diagnostic code, OR
   * 2. Have message patterns (checked lazily), OR
   * 3. Are catch-all builders
   */
  getCandidateBuilders(diagnostic: ts.Diagnostic): SolutionBuilder[] {
    const candidates: SolutionBuilder[] = [];
    const seen = new Set<SolutionBuilder>();

    // 1. Get builders indexed by this diagnostic code (O(1))
    const byCode = this.byCode.get(diagnostic.code);
    if (byCode) {
      for (const builder of byCode) {
        candidates.push(builder);
        seen.add(builder);
      }
    }

    // 2. Get builders with message patterns (need to check lazily)
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    for (const builder of this.builders) {
      if (seen.has(builder)) continue;
      if (!builder.messagePatterns || builder.messagePatterns.length === 0) continue;

      // Check if any pattern matches
      for (const pattern of builder.messagePatterns) {
        if (pattern.test(message)) {
          candidates.push(builder);
          seen.add(builder);
          break;
        }
      }
    }

    // 3. Add catch-all builders
    for (const builder of this.catchAllBuilders) {
      if (!seen.has(builder)) {
        candidates.push(builder);
        seen.add(builder);
      }
    }

    return candidates;
  }

  /**
   * Get builders that actually match a diagnostic (calls matches()).
   * More expensive than getCandidateBuilders - use for final filtering.
   */
  getMatchingBuilders(ctx: BuilderContext): SolutionBuilder[] {
    const candidates = this.getCandidateBuilders(ctx.diagnostic);
    return candidates.filter((builder) => builder.matches(ctx));
  }

  /**
   * Get match results for debugging/logging.
   */
  getMatchResults(ctx: BuilderContext): BuilderMatchResult[] {
    const candidates = this.getCandidateBuilders(ctx.diagnostic);
    return candidates.map((builder) => {
      try {
        const matched = builder.matches(ctx);
        return { builder: builder.name, matched };
      } catch (e) {
        return {
          builder: builder.name,
          matched: false,
          reason: `Error: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    });
  }

  /**
   * Generate candidates from all matching builders.
   */
  generateCandidates(ctx: BuilderContext): CandidateFix[] {
    const matching = this.getMatchingBuilders(ctx);
    const candidates: CandidateFix[] = [];

    for (const builder of matching) {
      try {
        const generated = builder.generate(ctx);
        candidates.push(...generated);
      } catch (e) {
        // Skip builders that fail - don't want one bad builder to break everything
        console.error(
          `Warning: Builder ${builder.name} failed to generate candidates:`,
          e
        );
      }
    }

    return candidates;
  }

  /**
   * Clear all registered builders.
   */
  clear(): void {
    this.builders = [];
    this.byCode.clear();
    this.catchAllBuilders = [];
  }
}

/**
 * Find the deepest AST node at a given position.
 */
export function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  position: number
): ts.Node | undefined {
  function findDeepest(node: ts.Node): ts.Node | undefined {
    if (position < node.getStart(sourceFile) || position >= node.getEnd()) {
      return undefined;
    }

    // Check children first to find deepest match
    let deepestChild: ts.Node | undefined;
    ts.forEachChild(node, (child) => {
      const result = findDeepest(child);
      if (result) {
        deepestChild = result;
      }
    });

    return deepestChild ?? node;
  }

  return findDeepest(sourceFile);
}

/**
 * Create a BuilderContext for a diagnostic.
 * Provides lazy AST access and other utilities builders need.
 */
export function createBuilderContext(
  diagnostic: ts.Diagnostic,
  host: TypeScriptHost,
  filesWithErrors: Set<string>,
  currentDiagnostics: ts.Diagnostic[]
): BuilderContext {
  // Lazy-loaded source file cache
  const sourceFileCache = new Map<string, ts.SourceFile | null>();

  // Lazy-loaded node at position
  let nodeAtPosition: ts.Node | undefined | null = null;

  const getSourceFile = (filePath: string): ts.SourceFile | undefined => {
    if (sourceFileCache.has(filePath)) {
      return sourceFileCache.get(filePath) ?? undefined;
    }

    const content = host.getVFS().read(filePath);
    if (!content) {
      sourceFileCache.set(filePath, null);
      return undefined;
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true // setParentNodes
    );
    sourceFileCache.set(filePath, sourceFile);
    return sourceFile;
  };

  const getNodeAtPosition = (): ts.Node | undefined => {
    if (nodeAtPosition !== null) {
      return nodeAtPosition;
    }

    if (!diagnostic.file || diagnostic.start === undefined) {
      nodeAtPosition = undefined;
      return undefined;
    }

    // Try to get from the diagnostic's source file first
    const fileName = diagnostic.file.fileName;
    const sourceFile = getSourceFile(fileName);
    if (!sourceFile) {
      nodeAtPosition = undefined;
      return undefined;
    }

    nodeAtPosition = findNodeAtPosition(sourceFile, diagnostic.start);
    return nodeAtPosition;
  };

  return {
    diagnostic,
    host,
    filesWithErrors,
    currentDiagnostics,
    compilerOptions: host.getOptions(),
    getNodeAtPosition,
    getSourceFile,
  };
}

/**
 * Default global registry for convenience.
 */
export const defaultRegistry = new BuilderRegistry();

/**
 * Convenience function to register a builder in the default registry.
 */
export function registerBuilder(builder: SolutionBuilder): void {
  defaultRegistry.register(builder);
}
