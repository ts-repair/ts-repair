/**
 * AST-based code manglers for introducing controlled TypeScript errors
 *
 * Each mangler finds candidates in the code and mutates them to introduce
 * specific types of errors.
 */

import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ManglerType,
  MangleCandidate,
  MangleRecord,
  MangleResult,
  MangleOptions,
  MangleRecipe,
} from './types.js';
import { CASCADE_MULTIPLIERS } from './types.js';

/**
 * Seeded random number generator for reproducibility
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    // LCG parameters from Numerical Recipes
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0xffffffff;
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }
}

/**
 * Context for mangler functions
 */
interface ManglerContext {
  sourceFile: ts.SourceFile;
  program: ts.Program;
  checker: ts.TypeChecker;
  random: SeededRandom;
  content: string;
}

/**
 * Type for a mangler function
 */
type Mangler = (ctx: ManglerContext) => MangleCandidate[];

/**
 * Registry of all manglers
 */
const MANGLERS: Record<ManglerType, Mangler> = {
  deleteImport: findDeleteImportCandidates,
  removeAsyncModifier: findRemoveAsyncCandidates,
  deleteInterfaceProperty: findDeleteInterfacePropertyCandidates,
  removeTypeAnnotation: findRemoveTypeAnnotationCandidates,
  deleteReturnType: findDeleteReturnTypeCandidates,
  removeOptionalChaining: findRemoveOptionalChainingCandidates,
  widenToUnknown: findWidenToUnknownCandidates,
  deleteTypeGuard: findDeleteTypeGuardCandidates,
  breakUnionType: findBreakUnionTypeCandidates,
};

/**
 * Find import statements that can be deleted
 */
function findDeleteImportCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      // Count how many times imported symbols are used
      const usageCount = countImportUsages(ctx, statement);

      if (usageCount > 0) {
        const start = statement.getStart(sourceFile);
        const end = statement.getEnd();
        // Include trailing newline if present
        const adjustedEnd = content[end] === '\n' ? end + 1 : end;

        candidates.push({
          type: 'deleteImport',
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
          start,
          end: adjustedEnd,
          original: content.slice(start, adjustedEnd),
          replacement: '',
          estimatedCascade: usageCount,
        });
      }
    }
  }

  return candidates;
}

/**
 * Count usages of imported symbols
 */
function countImportUsages(ctx: ManglerContext, importDecl: ts.ImportDeclaration): number {
  const { sourceFile } = ctx;
  let count = 0;
  const importedNames = new Set<string>();

  // Extract imported names
  const importClause = importDecl.importClause;
  if (importClause) {
    // Default import
    if (importClause.name) {
      importedNames.add(importClause.name.text);
    }
    // Named imports
    if (importClause.namedBindings) {
      if (ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          importedNames.add(element.name.text);
        }
      } else if (ts.isNamespaceImport(importClause.namedBindings)) {
        importedNames.add(importClause.namedBindings.name.text);
      }
    }
  }

  // Count usages in the file (simple text search)
  const content = sourceFile.getFullText();
  for (const name of importedNames) {
    // Match word boundaries
    const regex = new RegExp(`\\b${name}\\b`, 'g');
    const matches = content.match(regex);
    // Subtract 1 for the import declaration itself
    count += (matches?.length ?? 1) - 1;
  }

  return count;
}

/**
 * Find async functions where the modifier can be removed
 */
function findRemoveAsyncCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      // Count await expressions inside
      const awaitCount = countAwaits(node);

      if (awaitCount > 0) {
        const asyncModifier = node.modifiers.find(
          (m) => m.kind === ts.SyntaxKind.AsyncKeyword
        );
        if (asyncModifier) {
          const start = asyncModifier.getStart(sourceFile);
          const end = asyncModifier.getEnd();
          // Remove 'async ' including trailing space
          const adjustedEnd = content[end] === ' ' ? end + 1 : end;

          candidates.push({
            type: 'removeAsyncModifier',
            file: sourceFile.fileName,
            line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
            column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
            start,
            end: adjustedEnd,
            original: content.slice(start, adjustedEnd),
            replacement: '',
            estimatedCascade: awaitCount,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Count await expressions in a function
 */
function countAwaits(node: ts.Node): number {
  let count = 0;

  function visit(n: ts.Node): void {
    if (ts.isAwaitExpression(n)) {
      count++;
    }
    // Don't descend into nested functions
    if (
      !ts.isFunctionDeclaration(n) &&
      !ts.isFunctionExpression(n) &&
      !ts.isArrowFunction(n) &&
      !ts.isMethodDeclaration(n)
    ) {
      ts.forEachChild(n, visit);
    } else if (n === node) {
      // Visit children of the original node
      ts.forEachChild(n, visit);
    }
  }

  visit(node);
  return count;
}

/**
 * Find interface properties that can be deleted
 */
function findDeleteInterfacePropertyCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.members.length > 1) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
          const propName = member.name.getText(sourceFile);
          // Estimate usages based on property name occurrences
          const usageEstimate = estimatePropertyUsages(content, propName);

          const start = member.getStart(sourceFile);
          let end = member.getEnd();
          // Include trailing semicolon and newline
          while (
            end < content.length &&
            (content[end] === ';' || content[end] === '\n' || content[end] === ' ')
          ) {
            end++;
            if (content[end - 1] === '\n') break;
          }

          candidates.push({
            type: 'deleteInterfaceProperty',
            file: sourceFile.fileName,
            line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
            column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
            start,
            end,
            original: content.slice(start, end),
            replacement: '',
            estimatedCascade: usageEstimate,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Estimate property usages based on text search
 */
function estimatePropertyUsages(content: string, propName: string): number {
  const regex = new RegExp(`\\.${propName}\\b|\\['${propName}'\\]`, 'g');
  const matches = content.match(regex);
  return matches?.length ?? 1;
}

/**
 * Find type annotations that can be removed
 */
function findRemoveTypeAnnotationCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    // Variable declarations with type annotations
    if (ts.isVariableDeclaration(node) && node.type && node.initializer) {
      const colonPos = content.indexOf(':', node.name.getEnd());
      if (colonPos !== -1 && colonPos < node.type.getStart(sourceFile)) {
        const start = colonPos;
        const end = node.type.getEnd();

        candidates.push({
          type: 'removeTypeAnnotation',
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
          start,
          end,
          original: content.slice(start, end),
          replacement: '',
          estimatedCascade: 1,
        });
      }
    }

    // Parameter type annotations
    if (ts.isParameter(node) && node.type) {
      const colonPos = content.indexOf(':', node.name.getEnd());
      if (colonPos !== -1 && colonPos < node.type.getStart(sourceFile)) {
        const start = colonPos;
        const end = node.type.getEnd();

        candidates.push({
          type: 'removeTypeAnnotation',
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
          start,
          end,
          original: content.slice(start, end),
          replacement: '',
          estimatedCascade: 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Find function return types that can be deleted
 */
function findDeleteReturnTypeCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node)) &&
      node.type
    ) {
      // Find the colon before the return type
      const parenEnd = node.parameters.end;
      const colonPos = content.indexOf(':', parenEnd);
      if (colonPos !== -1 && colonPos < node.type.getStart(sourceFile)) {
        const start = colonPos;
        const end = node.type.getEnd();

        candidates.push({
          type: 'deleteReturnType',
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
          start,
          end,
          original: content.slice(start, end),
          replacement: '',
          estimatedCascade: 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Find optional chaining that can be removed
 */
function findRemoveOptionalChainingCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    // PropertyAccessExpression with questionDotToken
    if (ts.isPropertyAccessExpression(node) && node.questionDotToken) {
      const start = node.questionDotToken.getStart(sourceFile);
      const end = node.questionDotToken.getEnd();

      candidates.push({
        type: 'removeOptionalChaining',
        file: sourceFile.fileName,
        line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
        start,
        end,
        original: content.slice(start, end),
        replacement: '.',
        estimatedCascade: 1,
      });
    }

    // CallExpression with questionDotToken
    if (ts.isCallExpression(node) && node.questionDotToken) {
      const start = node.questionDotToken.getStart(sourceFile);
      const end = node.questionDotToken.getEnd();

      candidates.push({
        type: 'removeOptionalChaining',
        file: sourceFile.fileName,
        line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
        start,
        end,
        original: content.slice(start, end),
        replacement: '',
        estimatedCascade: 1,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Find types that can be widened to unknown
 */
function findWidenToUnknownCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    // Parameter type annotations (not unknown, any, or void)
    if (ts.isParameter(node) && node.type && !isSimpleType(node.type)) {
      const start = node.type.getStart(sourceFile);
      const end = node.type.getEnd();
      const typeText = content.slice(start, end);

      if (!['unknown', 'any', 'void', 'never'].includes(typeText.trim())) {
        candidates.push({
          type: 'widenToUnknown',
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
          start,
          end,
          original: typeText,
          replacement: 'unknown',
          estimatedCascade: 2,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Check if a type is a simple primitive
 */
function isSimpleType(type: ts.TypeNode): boolean {
  return (
    type.kind === ts.SyntaxKind.StringKeyword ||
    type.kind === ts.SyntaxKind.NumberKeyword ||
    type.kind === ts.SyntaxKind.BooleanKeyword ||
    type.kind === ts.SyntaxKind.UnknownKeyword ||
    type.kind === ts.SyntaxKind.AnyKeyword ||
    type.kind === ts.SyntaxKind.VoidKeyword ||
    type.kind === ts.SyntaxKind.NeverKeyword
  );
}

/**
 * Find type guards that can be deleted
 */
function findDeleteTypeGuardCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    // if (typeof x === 'string') or if (x instanceof Y)
    if (ts.isIfStatement(node)) {
      const condition = node.expression;

      // typeof check
      if (
        ts.isBinaryExpression(condition) &&
        condition.left.kind === ts.SyntaxKind.TypeOfExpression
      ) {
        // Remove the if statement, keep only the then block
        if (ts.isBlock(node.thenStatement)) {
          const start = node.getStart(sourceFile);
          const end = node.getEnd();
          const thenContent = node.thenStatement.statements
            .map((s) => s.getText(sourceFile))
            .join('\n');

          candidates.push({
            type: 'deleteTypeGuard',
            file: sourceFile.fileName,
            line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
            column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
            start,
            end,
            original: content.slice(start, end),
            replacement: thenContent,
            estimatedCascade: 2,
          });
        }
      }

      // instanceof check
      if (
        ts.isBinaryExpression(condition) &&
        condition.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
      ) {
        if (ts.isBlock(node.thenStatement)) {
          const start = node.getStart(sourceFile);
          const end = node.getEnd();
          const thenContent = node.thenStatement.statements
            .map((s) => s.getText(sourceFile))
            .join('\n');

          candidates.push({
            type: 'deleteTypeGuard',
            file: sourceFile.fileName,
            line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
            column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
            start,
            end,
            original: content.slice(start, end),
            replacement: thenContent,
            estimatedCascade: 2,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Find union types that can be broken
 */
function findBreakUnionTypeCandidates(ctx: ManglerContext): MangleCandidate[] {
  const candidates: MangleCandidate[] = [];
  const { sourceFile, content } = ctx;

  function visit(node: ts.Node): void {
    if (ts.isUnionTypeNode(node) && node.types.length > 1) {
      const firstType = node.types[0];
      if (firstType) {
        const start = node.getStart(sourceFile);
        const end = node.getEnd();
        const firstTypeText = firstType.getText(sourceFile);

        candidates.push({
          type: 'breakUnionType',
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          column: sourceFile.getLineAndCharacterOfPosition(start).character + 1,
          start,
          end,
          original: content.slice(start, end),
          replacement: firstTypeText,
          estimatedCascade: 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Main function to mangle a project
 */
export function mangleProject(options: MangleOptions): MangleResult {
  const { projectPath, tsconfigPath, recipe, targetDir, seed } = options;
  const random = new SeededRandom(seed);

  // Create TypeScript program
  const configPath = path.resolve(projectPath, tsconfigPath);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();

  // Collect all candidates by type
  const candidatesByType = new Map<ManglerType, MangleCandidate[]>();

  for (const type of Object.keys(MANGLERS) as ManglerType[]) {
    candidatesByType.set(type, []);
  }

  // Process each source file
  for (const sourceFile of program.getSourceFiles()) {
    // Skip declaration files and node_modules
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) {
      continue;
    }

    // Filter by target directory if specified
    if (targetDir) {
      const relativePath = path.relative(projectPath, sourceFile.fileName);
      if (!relativePath.startsWith(targetDir)) {
        continue;
      }
    }

    const content = sourceFile.getFullText();
    const ctx: ManglerContext = {
      sourceFile,
      program,
      checker,
      random,
      content,
    };

    // Run each mangler
    for (const [type, mangler] of Object.entries(MANGLERS) as [ManglerType, Mangler][]) {
      const candidates = mangler(ctx);
      candidatesByType.get(type)?.push(...candidates);
    }
  }

  // Select candidates according to recipe
  const selectedCandidates: MangleCandidate[] = [];

  for (const [type, count] of Object.entries(recipe) as [ManglerType, number][]) {
    if (count && count > 0) {
      const candidates = candidatesByType.get(type) ?? [];
      const shuffled = random.shuffle(candidates);
      selectedCandidates.push(...shuffled.slice(0, count));
    }
  }

  // Sort by file, then by position (descending) to apply from bottom to top
  selectedCandidates.sort((a, b) => {
    if (a.file !== b.file) {
      return a.file.localeCompare(b.file);
    }
    return b.start - a.start; // Descending order
  });

  // Apply mangles and build records
  const records: MangleRecord[] = [];
  const modifiedFiles = new Map<string, string>();

  // Group by file for batch processing
  const byFile = new Map<string, MangleCandidate[]>();
  for (const candidate of selectedCandidates) {
    const existing = byFile.get(candidate.file);
    if (existing) {
      existing.push(candidate);
    } else {
      byFile.set(candidate.file, [candidate]);
    }
  }

  // Process each file
  for (const [filePath, candidates] of byFile) {
    let content = fs.readFileSync(filePath, 'utf-8');

    // Apply in reverse order (already sorted descending by position)
    for (const candidate of candidates) {
      const id = `mangle-${records.length}`;

      records.push({
        id,
        type: candidate.type,
        file: path.relative(projectPath, candidate.file),
        line: candidate.line,
        column: candidate.column,
        original: candidate.original,
        replacement: candidate.replacement,
        expectedCascadeDepth: candidate.estimatedCascade,
      });

      content = content.slice(0, candidate.start) + candidate.replacement + content.slice(candidate.end);
    }

    modifiedFiles.set(path.relative(projectPath, filePath), content);
  }

  return { records, modifiedFiles };
}

/**
 * Scale a recipe to target a specific error count
 */
export function scaleRecipe(base: MangleRecipe, targetErrors: number): MangleRecipe {
  // Calculate expected errors from base recipe
  let expectedErrors = 0;
  for (const [type, count] of Object.entries(base) as [ManglerType, number][]) {
    if (count) {
      expectedErrors += count * (CASCADE_MULTIPLIERS[type] ?? 1);
    }
  }

  if (expectedErrors === 0) {
    return base;
  }

  // Scale factor
  const scale = targetErrors / expectedErrors;

  // Apply scale to each type
  const scaled: MangleRecipe = {};
  for (const [type, count] of Object.entries(base) as [ManglerType, number][]) {
    if (count) {
      scaled[type] = Math.max(1, Math.round(count * scale));
    }
  }

  return scaled;
}

/**
 * Default balanced recipe (mix of all types)
 */
export const DEFAULT_RECIPE: MangleRecipe = {
  deleteImport: 2,
  removeAsyncModifier: 1,
  deleteInterfaceProperty: 1,
  removeTypeAnnotation: 2,
  deleteReturnType: 1,
  removeOptionalChaining: 1,
  widenToUnknown: 1,
  deleteTypeGuard: 1,
  breakUnionType: 1,
};

/**
 * Recipe focused on cascade errors (ts-repair advantage)
 */
export const CASCADE_RECIPE: MangleRecipe = {
  deleteImport: 4,
  removeAsyncModifier: 2,
  deleteInterfaceProperty: 2,
};

/**
 * Recipe focused on mechanical errors
 */
export const MECHANICAL_RECIPE: MangleRecipe = {
  removeTypeAnnotation: 4,
  deleteReturnType: 2,
  removeOptionalChaining: 2,
};

/**
 * Recipe focused on judgment errors
 */
export const JUDGMENT_RECIPE: MangleRecipe = {
  widenToUnknown: 3,
  deleteTypeGuard: 2,
  breakUnionType: 2,
};

/**
 * Apply mangle result to disk
 */
export function applyManglesToDisk(projectPath: string, result: MangleResult): void {
  for (const [relativePath, content] of result.modifiedFiles) {
    const fullPath = path.resolve(projectPath, relativePath);
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

/**
 * Preview what mangles would be applied without actually applying them
 */
export function previewMangles(options: MangleOptions): {
  candidateCounts: Record<ManglerType, number>;
  selectedCounts: Record<ManglerType, number>;
  estimatedErrors: number;
} {
  const { projectPath, tsconfigPath, recipe, targetDir, seed } = options;
  const random = new SeededRandom(seed);

  // Create TypeScript program (same as mangleProject)
  const configPath = path.resolve(projectPath, tsconfigPath);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();

  const candidateCounts: Record<ManglerType, number> = {
    deleteImport: 0,
    removeAsyncModifier: 0,
    deleteInterfaceProperty: 0,
    removeTypeAnnotation: 0,
    deleteReturnType: 0,
    removeOptionalChaining: 0,
    widenToUnknown: 0,
    deleteTypeGuard: 0,
    breakUnionType: 0,
  };

  // Count candidates
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) {
      continue;
    }

    if (targetDir) {
      const relativePath = path.relative(projectPath, sourceFile.fileName);
      if (!relativePath.startsWith(targetDir)) {
        continue;
      }
    }

    const content = sourceFile.getFullText();
    const ctx: ManglerContext = {
      sourceFile,
      program,
      checker,
      random,
      content,
    };

    for (const [type, mangler] of Object.entries(MANGLERS) as [ManglerType, Mangler][]) {
      candidateCounts[type] += mangler(ctx).length;
    }
  }

  // Calculate selected counts based on recipe
  const selectedCounts: Record<ManglerType, number> = {
    deleteImport: 0,
    removeAsyncModifier: 0,
    deleteInterfaceProperty: 0,
    removeTypeAnnotation: 0,
    deleteReturnType: 0,
    removeOptionalChaining: 0,
    widenToUnknown: 0,
    deleteTypeGuard: 0,
    breakUnionType: 0,
  };

  let estimatedErrors = 0;

  for (const [type, count] of Object.entries(recipe) as [ManglerType, number][]) {
    if (count) {
      const available = candidateCounts[type] ?? 0;
      const selected = Math.min(count, available);
      selectedCounts[type] = selected;
      estimatedErrors += selected * (CASCADE_MULTIPLIERS[type] ?? 1);
    }
  }

  return { candidateCounts, selectedCounts, estimatedErrors };
}
