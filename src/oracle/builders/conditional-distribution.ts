/**
 * Conditional Type Distribution Builder
 *
 * Generates candidates for TS2322, TS2345, TS2536 caused by distributive
 * conditional types. Repairs by wrapping naked type parameters in tuples
 * to disable distribution: T extends U ? X : Y -> [T] extends [U] ? X : Y
 *
 * This builder correlates diagnostics with conditional types by:
 * 1. Finding the type context at the diagnostic location
 * 2. Extracting type references from that context
 * 3. Tracing type flow (return types, parameters, etc.)
 * 4. Analyzing error messages for distribution patterns
 * 5. Scoring confidence to avoid false positives
 */

import ts from "typescript";

/**
 * Score weights for distribution pattern matching.
 * Higher weights indicate stronger evidence of distribution issues.
 *
 * Key insight: Distribution issues specifically involve UNION TYPES being
 * distributed over conditional types. Just mentioning a conditional type
 * name is weak evidence - we need to see unions or 'never' (which results
 * from distribution collapsing unions).
 */
const SCORE_WEIGHTS = {
  /** Error message mentions a known conditional type name (weak evidence alone) */
  ERROR_MENTIONS_TYPE: 1,
  /** Error involves 'never' type (strong signal - often results from distribution) */
  INVOLVES_NEVER: 3,
  /** Error message contains union type pattern (strong signal - distribution involves unions) */
  UNION_PATTERN: 4,
  /** Error mentions 'extends' keyword */
  EXTENDS_KEYWORD: 1,
  /** Error may contain conditional type syntax (? and :) */
  CONDITIONAL_SYNTAX: 1,
  /** Conditional type is traced/referenced from diagnostic context */
  TYPE_TRACED: 2,
  /** Conditional type mentioned in error message (fallback) */
  TYPE_MENTIONED: 1,
  /** Conditional type in same file as diagnostic */
  SAME_FILE: 1,
} as const;

/**
 * Confidence thresholds for matching decisions.
 *
 * We require strong evidence (score >= 5) to avoid false positives.
 * Just mentioning a conditional type (1 point) + being traced (2 points) = 3
 * is not enough. We need additional signals like union patterns or 'never'.
 */
const CONFIDENCE_THRESHOLDS = {
  /** Minimum score to consider it likely distribution-related */
  MEDIUM: 5,
  /** Score threshold for fallback inclusion of conditionals */
  FALLBACK_MINIMUM: 5,
} as const;

import type {
  SolutionBuilder,
  BuilderContext,
  CandidateFix,
  FileChange,
} from "../../output/types.js";
import type { TypeScriptHost } from "../typescript.js";
import { createSyntheticFix } from "../candidate.js";

/**
 * Information about a conditional type that may need repair.
 */
interface ConditionalTypeInfo {
  /** The source file containing the conditional type */
  sourceFile: ts.SourceFile;
  /** The file name */
  fileName: string;
  /** The conditional type node */
  conditionalType: ts.ConditionalTypeNode;
  /** The type alias declaration containing this conditional (if any) */
  typeAlias?: ts.TypeAliasDeclaration;
  /** Start position of check type (the T in T extends U) */
  checkTypeStart: number;
  /** End position of check type */
  checkTypeEnd: number;
  /** Start position of extends type (the U in T extends U) */
  extendsTypeStart: number;
  /** End position of extends type */
  extendsTypeEnd: number;
  /** Whether the check type is a naked type parameter */
  isNakedTypeParameter: boolean;
  /** Whether already wrapped in tuple */
  isAlreadyWrapped: boolean;
}

/**
 * Confidence level for matching a conditional type to a diagnostic.
 */
interface DistributionMatchResult {
  /** Confidence score (0-10) */
  score: number;
  /** Evidence supporting the match */
  evidence: string[];
  /** The conditional types that are relevant */
  relevantConditionals: ConditionalTypeInfo[];
}

/**
 * Check if a type node is a "naked" type parameter (not wrapped in tuple/array).
 * A naked type parameter is a bare type parameter without any wrapper like Array<T> or [T].
 *
 * @param node - The type node to check
 * @param typeAlias - Optional containing type alias to verify the identifier is actually a type parameter
 */
function isNakedTypeParameter(
  node: ts.TypeNode,
  typeAlias?: ts.TypeAliasDeclaration
): boolean {
  // A naked type parameter is a simple TypeReference to a type parameter
  if (!ts.isTypeReferenceNode(node)) return false;

  // Must be a simple identifier (not qualified name like Foo.Bar)
  if (!ts.isIdentifier(node.typeName)) return false;

  // Must not have type arguments (e.g., T<U> is not naked)
  if (node.typeArguments !== undefined) return false;

  // If we have the containing type alias, verify it's actually a type parameter
  if (typeAlias?.typeParameters) {
    const paramNames = typeAlias.typeParameters.map((p) => p.name.text);
    return paramNames.includes(node.typeName.text);
  }

  // Without type alias context, we can't verify it's a type parameter
  // Be conservative and return false to avoid false positives
  return false;
}

/**
 * Check if a type is already wrapped in a tuple (e.g., [T]).
 */
function isWrappedInTuple(node: ts.TypeNode): boolean {
  if (ts.isTupleTypeNode(node)) {
    return node.elements.length === 1;
  }
  return false;
}

/**
 * Find the nearest ancestor type alias declaration.
 */
function findAncestorTypeAlias(
  node: ts.Node
): ts.TypeAliasDeclaration | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isTypeAliasDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Find conditional types in a source file that may be causing distribution issues.
 */
function findConditionalTypes(
  sourceFile: ts.SourceFile,
  fileName: string
): ConditionalTypeInfo[] {
  const results: ConditionalTypeInfo[] = [];

  function visit(node: ts.Node): void {
    if (ts.isConditionalTypeNode(node)) {
      const checkType = node.checkType;
      const extendsType = node.extendsType;
      const typeAlias = findAncestorTypeAlias(node);

      const info: ConditionalTypeInfo = {
        sourceFile,
        fileName,
        conditionalType: node,
        typeAlias,
        checkTypeStart: checkType.getStart(sourceFile),
        checkTypeEnd: checkType.getEnd(),
        extendsTypeStart: extendsType.getStart(sourceFile),
        extendsTypeEnd: extendsType.getEnd(),
        // Pass typeAlias to verify the identifier is actually a type parameter
        isNakedTypeParameter: isNakedTypeParameter(checkType, typeAlias),
        isAlreadyWrapped:
          isWrappedInTuple(checkType) && isWrappedInTuple(extendsType),
      };

      results.push(info);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Cache for conditional types in the project.
 * WeakMap keyed by the TypeScript host ensures cache is invalidated
 * when the host changes (e.g., different project or file changes).
 */
const conditionalTypeCache = new WeakMap<
  TypeScriptHost,
  ConditionalTypeInfo[]
>();

/**
 * Get all conditional types in the project (cached for performance).
 * Uses WeakMap cache keyed by the host to avoid re-scanning on every call.
 */
function getAllConditionalTypes(ctx: BuilderContext): ConditionalTypeInfo[] {
  // Check cache first
  const cached = conditionalTypeCache.get(ctx.host);
  if (cached !== undefined) {
    return cached;
  }

  // Scan all files for conditional types
  const results: ConditionalTypeInfo[] = [];

  for (const fileName of ctx.host.getFileNames()) {
    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    const conditionals = findConditionalTypes(sourceFile, fileName);
    for (const info of conditionals) {
      if (info.isNakedTypeParameter && !info.isAlreadyWrapped) {
        results.push(info);
      }
    }
  }

  // Cache the results
  conditionalTypeCache.set(ctx.host, results);
  return results;
}

/**
 * Extract type names referenced in the diagnostic's type context.
 */
function extractTypeReferencesFromContext(ctx: BuilderContext): Set<string> {
  const typeNames = new Set<string>();
  const node = ctx.getNodeAtPosition();
  if (!node) return typeNames;

  // Walk up to find enclosing type context (function, variable declaration, etc.)
  let current: ts.Node | undefined = node;
  while (current) {
    // Check for type annotations and return types
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current) || ts.isMethodDeclaration(current)) {
      // Extract return type references
      if (current.type) {
        collectTypeReferences(current.type, typeNames);
      }
      // Extract parameter type references
      for (const param of current.parameters) {
        if (param.type) {
          collectTypeReferences(param.type, typeNames);
        }
      }
      break;
    }

    if (ts.isVariableDeclaration(current)) {
      if (current.type) {
        collectTypeReferences(current.type, typeNames);
      }
      break;
    }

    if (ts.isPropertyDeclaration(current) || ts.isPropertySignature(current)) {
      if (current.type) {
        collectTypeReferences(current.type, typeNames);
      }
      break;
    }

    if (ts.isCallExpression(current)) {
      // Extract type arguments from call
      if (current.typeArguments) {
        for (const typeArg of current.typeArguments) {
          collectTypeReferences(typeArg, typeNames);
        }
      }
      break;
    }

    if (ts.isReturnStatement(current)) {
      // Find enclosing function and get its return type
      let fn = current.parent;
      while (fn && !ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn) &&
             !ts.isArrowFunction(fn) && !ts.isMethodDeclaration(fn)) {
        fn = fn.parent;
      }
      if (fn && (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) ||
                 ts.isArrowFunction(fn) || ts.isMethodDeclaration(fn))) {
        if (fn.type) {
          collectTypeReferences(fn.type, typeNames);
        }
      }
      break;
    }

    current = current.parent;
  }

  return typeNames;
}

/**
 * Recursively collect type reference names from a type node.
 */
function collectTypeReferences(typeNode: ts.TypeNode, names: Set<string>): void {
  if (ts.isTypeReferenceNode(typeNode)) {
    // Get the type name
    if (ts.isIdentifier(typeNode.typeName)) {
      names.add(typeNode.typeName.text);
    } else if (ts.isQualifiedName(typeNode.typeName)) {
      // For qualified names like Namespace.Type, collect the full path
      names.add(typeNode.typeName.right.text);
    }
    // Also collect from type arguments
    if (typeNode.typeArguments) {
      for (const arg of typeNode.typeArguments) {
        collectTypeReferences(arg, names);
      }
    }
  } else if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
    for (const subType of typeNode.types) {
      collectTypeReferences(subType, names);
    }
  } else if (ts.isArrayTypeNode(typeNode)) {
    collectTypeReferences(typeNode.elementType, names);
  } else if (ts.isTupleTypeNode(typeNode)) {
    for (const element of typeNode.elements) {
      collectTypeReferences(element, names);
    }
  } else if (ts.isConditionalTypeNode(typeNode)) {
    collectTypeReferences(typeNode.checkType, names);
    collectTypeReferences(typeNode.extendsType, names);
    collectTypeReferences(typeNode.trueType, names);
    collectTypeReferences(typeNode.falseType, names);
  } else if (ts.isFunctionTypeNode(typeNode)) {
    if (typeNode.type) {
      collectTypeReferences(typeNode.type, names);
    }
    for (const param of typeNode.parameters) {
      if (param.type) {
        collectTypeReferences(param.type, names);
      }
    }
  } else if (ts.isParenthesizedTypeNode(typeNode)) {
    collectTypeReferences(typeNode.type, names);
  } else if (ts.isIndexedAccessTypeNode(typeNode)) {
    collectTypeReferences(typeNode.objectType, names);
    collectTypeReferences(typeNode.indexType, names);
  } else if (ts.isMappedTypeNode(typeNode)) {
    if (typeNode.type) {
      collectTypeReferences(typeNode.type, names);
    }
  }
}

/**
 * Pattern to detect TypeScript 'never' type in error messages.
 * Matches:
 * - 'never' (quoted type name)
 * - : never (type annotation)
 * - never, or never] (in union/tuple contexts)
 * Does NOT match:
 * - Natural language "never" (e.g., "This should never happen")
 */
const NEVER_TYPE_PATTERN = /'never'|:\s*never\b|\bnever\s*[,\]|)]/;

/**
 * Analyze the error message for distribution-related patterns.
 */
function analyzeErrorMessageForDistribution(
  message: string,
  conditionalTypeNames: Set<string>
): { score: number; evidence: string[] } {
  let score = 0;
  const evidence: string[] = [];

  // Check for conditional type names in the message
  for (const typeName of conditionalTypeNames) {
    if (message.includes(typeName)) {
      score += SCORE_WEIGHTS.ERROR_MENTIONS_TYPE;
      evidence.push(`Error mentions conditional type '${typeName}'`);
    }
  }

  // Check for 'never' type in error (common with distribution)
  // Use specific pattern to avoid matching natural language "never"
  if (NEVER_TYPE_PATTERN.test(message)) {
    score += SCORE_WEIGHTS.INVOLVES_NEVER;
    evidence.push("Error involves 'never' type (common with distribution)");
  }

  // Check for union type patterns that suggest distribution
  // Distribution issues involve union types, so finding unions in the error
  // is strong evidence. We check multiple patterns:
  // - Parenthesized unions: (A | B)
  // - Quoted unions: 'A | B' or "A | B"
  // - Array unions: A[] | B[]
  const unionPatterns = [
    /\([^)]+\s*\|\s*[^)]+\)/,           // (A | B)
    /'[^']+\s*\|\s*[^']+'/,             // 'A | B'
    /"[^"]+\s*\|\s*[^"]+"/,             // "A | B"
    /\w+\[\]\s*\|\s*\w+\[\]/,           // A[] | B[]
  ];
  for (const pattern of unionPatterns) {
    if (pattern.test(message)) {
      score += SCORE_WEIGHTS.UNION_PATTERN;
      evidence.push("Error involves union type pattern (strong distribution signal)");
      break; // Only count once even if multiple patterns match
    }
  }

  // Check for extends pattern mentions
  if (message.includes("extends")) {
    score += SCORE_WEIGHTS.EXTENDS_KEYWORD;
    evidence.push("Error mentions 'extends' keyword");
  }

  // Check for conditional type pattern in error message
  if (message.includes("?") && message.includes(":")) {
    score += SCORE_WEIGHTS.CONDITIONAL_SYNTAX;
    evidence.push("Error may contain conditional type syntax");
  }

  return { score, evidence };
}

/**
 * Check if a conditional type is referenced in the diagnostic context.
 */
function isConditionalTypeReferenced(
  conditionalInfo: ConditionalTypeInfo,
  referencedTypes: Set<string>,
  message: string
): boolean {
  const typeAliasName = conditionalInfo.typeAlias?.name?.text;

  // Direct reference check
  if (typeAliasName && referencedTypes.has(typeAliasName)) {
    return true;
  }

  // Check if the type alias name appears in the error message
  if (typeAliasName && message.includes(typeAliasName)) {
    return true;
  }

  return false;
}

/**
 * Cache for distribution match results.
 * Keyed by diagnostic to avoid recomputing for matches() then generate().
 * WeakMap ensures entries are garbage collected when diagnostic is no longer referenced.
 */
const distributionMatchCache = new WeakMap<
  ts.Diagnostic,
  DistributionMatchResult
>();

/**
 * Evaluate the match between a diagnostic and distribution issues.
 * Returns a scored result with evidence.
 *
 * Results are cached to avoid double computation between matches() and generate().
 */
function evaluateDistributionMatch(ctx: BuilderContext): DistributionMatchResult {
  // Check cache first to avoid double computation
  const cached = distributionMatchCache.get(ctx.diagnostic);
  if (cached !== undefined) {
    return cached;
  }

  const result: DistributionMatchResult = {
    score: 0,
    evidence: [],
    relevantConditionals: [],
  };

  // Get the error message
  const message = ts.flattenDiagnosticMessageText(
    ctx.diagnostic.messageText,
    " "
  );

  // Get all conditional types in the project
  const allConditionals = getAllConditionalTypes(ctx);
  if (allConditionals.length === 0) {
    return result;
  }

  // Extract type references from the diagnostic context
  const referencedTypes = extractTypeReferencesFromContext(ctx);

  // Build a set of conditional type names for message analysis
  const conditionalTypeNames = new Set<string>();
  for (const info of allConditionals) {
    if (info.typeAlias?.name?.text) {
      conditionalTypeNames.add(info.typeAlias.name.text);
    }
  }

  // Analyze error message
  const messageAnalysis = analyzeErrorMessageForDistribution(
    message,
    conditionalTypeNames
  );
  result.score += messageAnalysis.score;
  result.evidence.push(...messageAnalysis.evidence);

  // Find conditionals that are actually referenced
  for (const conditionalInfo of allConditionals) {
    const isReferenced = isConditionalTypeReferenced(
      conditionalInfo,
      referencedTypes,
      message
    );

    if (isReferenced) {
      result.relevantConditionals.push(conditionalInfo);
      result.score += SCORE_WEIGHTS.TYPE_TRACED;
      const typeName = conditionalInfo.typeAlias?.name?.text ?? "anonymous";
      result.evidence.push(`Conditional type '${typeName}' is referenced in context`);
    }
  }

  // Additional scoring for diagnostic file match
  const diagnosticFile = ctx.diagnostic.file?.fileName;
  if (diagnosticFile) {
    for (const conditionalInfo of result.relevantConditionals) {
      // Check if the conditional type is in the same file as the diagnostic
      if (conditionalInfo.fileName === diagnosticFile) {
        result.score += SCORE_WEIGHTS.SAME_FILE;
        result.evidence.push("Conditional type in same file as diagnostic");
        break;
      }
    }
  }

  // If no specific conditionals are referenced but the message strongly suggests
  // distribution issues, include all conditionals with lower confidence
  if (
    result.relevantConditionals.length === 0 &&
    messageAnalysis.score >= CONFIDENCE_THRESHOLDS.FALLBACK_MINIMUM
  ) {
    // Only include conditionals whose type alias appears in the message
    for (const conditionalInfo of allConditionals) {
      const typeName = conditionalInfo.typeAlias?.name?.text;
      if (typeName && message.includes(typeName)) {
        result.relevantConditionals.push(conditionalInfo);
        result.score += SCORE_WEIGHTS.TYPE_MENTIONED;
        result.evidence.push(`Conditional type '${typeName}' mentioned in error`);
      }
    }
  }

  // Cache the result to avoid recomputing in generate() after matches()
  distributionMatchCache.set(ctx.diagnostic, result);
  return result;
}

/**
 * Generate a tuple-wrapping fix for a conditional type.
 */
function generateTupleWrapFix(info: ConditionalTypeInfo): CandidateFix | undefined {
  const {
    sourceFile,
    fileName,
    checkTypeStart,
    checkTypeEnd,
    extendsTypeStart,
    extendsTypeEnd,
  } = info;

  // Defensive check: ensure sourceFile.text is available
  if (!sourceFile.text) {
    return undefined;
  }

  // Get the original text for check and extends types
  const checkTypeText = sourceFile.text.slice(checkTypeStart, checkTypeEnd);
  const extendsTypeText = sourceFile.text.slice(extendsTypeStart, extendsTypeEnd);

  // Create changes to wrap both types in tuples
  // IMPORTANT: Apply changes in reverse order (end to start) to preserve positions
  const changes: FileChange[] = [
    // Wrap extends type first (it's later in the file)
    {
      file: fileName,
      start: extendsTypeStart,
      end: extendsTypeEnd,
      newText: `[${extendsTypeText}]`,
    },
    // Then wrap check type
    {
      file: fileName,
      start: checkTypeStart,
      end: checkTypeEnd,
      newText: `[${checkTypeText}]`,
    },
  ];

  const typeAliasName = info.typeAlias?.name?.text ?? "conditional type";
  const description = `Disable distribution in ${typeAliasName}: [${checkTypeText}] extends [${extendsTypeText}]`;

  return createSyntheticFix(
    "disableConditionalDistribution",
    description,
    changes,
    {
      scopeHint: "wide", // Changes propagate to consumers
      riskHint: "high", // Structural type change
      tags: ["conditional-type", "distribution", "structural"],
      metadata: {
        typeAliasName,
        originalCheckType: checkTypeText,
        originalExtendsType: extendsTypeText,
      },
    }
  );
}

/**
 * ConditionalTypeDistributionBuilder - Repairs distributive conditional type errors.
 *
 * This builder targets TS2322, TS2345, TS2536 errors that may be caused by
 * distributive conditional types. It generates candidates that wrap naked
 * type parameters in tuples to disable distribution behavior.
 *
 * The builder uses confidence scoring to avoid false positives:
 * - High confidence (score >= 5): definitely distribution-related
 * - Medium confidence (score >= 3): likely distribution-related
 * - Low confidence (score < 3): not distribution-related
 */
export const ConditionalTypeDistributionBuilder: SolutionBuilder = {
  name: "ConditionalTypeDistributionBuilder",
  description: "Repairs distributive conditional type errors by tuple-wrapping",
  diagnosticCodes: [2322, 2345, 2536],

  matches(ctx: BuilderContext): boolean {
    // Must be one of our target codes
    const code = ctx.diagnostic.code;
    if (code !== 2322 && code !== 2345 && code !== 2536) {
      return false;
    }

    // Evaluate match with confidence scoring
    const matchResult = evaluateDistributionMatch(ctx);

    // Only match if we have medium or high confidence
    // AND we found at least one relevant conditional type
    return (
      matchResult.score >= CONFIDENCE_THRESHOLDS.MEDIUM &&
      matchResult.relevantConditionals.length > 0
    );
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    const candidates: CandidateFix[] = [];

    // Evaluate match to get relevant conditionals
    const matchResult = evaluateDistributionMatch(ctx);

    // Only generate candidates for correlated conditional types
    for (const info of matchResult.relevantConditionals) {
      const fix = generateTupleWrapFix(info);
      if (fix) {
        candidates.push(fix);
      }
    }

    return candidates;
  },
};
