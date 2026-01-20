/**
 * Conditional Type Distribution Builder
 *
 * Generates candidates for TS2322, TS2345, TS2536 caused by distributive
 * conditional types. Repairs by wrapping naked type parameters in tuples
 * to disable distribution: T extends U ? X : Y -> [T] extends [U] ? X : Y
 */

import ts from "typescript";
import type {
  SolutionBuilder,
  BuilderContext,
  CandidateFix,
  FileChange,
} from "../../output/types.js";
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
 * Check if a type node is a "naked" type parameter (not wrapped in tuple/array).
 */
function isNakedTypeParameter(node: ts.TypeNode): boolean {
  // A naked type parameter is a simple TypeReference to a type parameter
  if (ts.isTypeReferenceNode(node)) {
    // Check if the type name is a simple identifier (type parameter)
    return ts.isIdentifier(node.typeName) && node.typeArguments === undefined;
  }
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

      const info: ConditionalTypeInfo = {
        sourceFile,
        fileName,
        conditionalType: node,
        typeAlias: findAncestorTypeAlias(node),
        checkTypeStart: checkType.getStart(sourceFile),
        checkTypeEnd: checkType.getEnd(),
        extendsTypeStart: extendsType.getStart(sourceFile),
        extendsTypeEnd: extendsType.getEnd(),
        isNakedTypeParameter: isNakedTypeParameter(checkType),
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
 * Find conditional types across all project files that might be causing
 * the diagnostic at the given position.
 */
function findRelevantConditionalTypes(ctx: BuilderContext): ConditionalTypeInfo[] {
  const results: ConditionalTypeInfo[] = [];

  // Search through all project files
  for (const fileName of ctx.host.getFileNames()) {
    const sourceFile = ctx.getSourceFile(fileName);
    if (!sourceFile) continue;

    const conditionals = findConditionalTypes(sourceFile, fileName);

    // Filter to only naked type parameters that aren't already wrapped
    for (const info of conditionals) {
      if (info.isNakedTypeParameter && !info.isAlreadyWrapped) {
        results.push(info);
      }
    }
  }

  return results;
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

    // Must have at least one conditional type with naked type parameter
    const conditionals = findRelevantConditionalTypes(ctx);
    return conditionals.length > 0;
  },

  generate(ctx: BuilderContext): CandidateFix[] {
    const candidates: CandidateFix[] = [];

    // Find all relevant conditional types
    const conditionals = findRelevantConditionalTypes(ctx);

    // Generate a fix candidate for each
    for (const info of conditionals) {
      const fix = generateTupleWrapFix(info);
      if (fix) {
        candidates.push(fix);
      }
    }

    return candidates;
  },
};
