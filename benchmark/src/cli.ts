#!/usr/bin/env node
/**
 * CLI for ts-repair benchmark harness
 */

import { Command } from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import Anthropic from '@anthropic-ai/sdk';
import type {
  BenchmarkConfig,
  ClaudeClient,
  Fix,
  MangleRecipe,
  Comparison,
} from './types.js';
import { DEFAULT_RECIPE, CASCADE_RECIPE, scaleRecipe, mangleProject, applyManglesToDisk, previewMangles } from './mangler.js';
import {
  FIXTURE_PRESETS,
  FIXTURE_RECIPES,
  REPO_PRESETS,
  getFixturePreset,
  getFixtureRecipe,
  type RecipeSize,
} from './presets.js';
import { runVanillaBenchmark, estimateVanillaTokens } from './runner-vanilla.js';
import { runTsRepairBenchmark, estimateTsRepairTokens } from './runner-tsrepair.js';
import { compare, printConsoleReport, exportJson, exportCsv, exportMarkdown, analyzeScaling, printScalingReport } from './reporter.js';
import { runTsc } from './tsc.js';
import { countTokens } from './token-counter.js';

/**
 * Real Claude client using Anthropic SDK
 */
class AnthropicClient implements ClaudeClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(prompt: string): Promise<{
    content: string;
    fixes: Fix[];
    usage: { prompt_tokens: number; completion_tokens: number };
  }> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';
    const fixes = parseFixes(content);

    return {
      content,
      fixes,
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
      },
    };
  }
}

/**
 * Mock Claude client for testing without API calls
 */
class MockClaudeClient implements ClaudeClient {
  async complete(prompt: string): Promise<{
    content: string;
    fixes: Fix[];
    usage: { prompt_tokens: number; completion_tokens: number };
  }> {
    // Simulate realistic fix behavior
    const diagnosticCount = (prompt.match(/TS\d+:/g) || []).length;
    const fixRate = 0.4 + Math.random() * 0.3; // 40-70% per round
    const fixCount = Math.floor(diagnosticCount * fixRate);

    // Generate plausible token counts
    const promptTokens = countTokens(prompt);
    const completionTokens = fixCount * 50; // ~50 tokens per fix

    return {
      content: '[]',
      fixes: [],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    };
  }
}

/**
 * Parse fixes from Claude's response
 */
function parseFixes(content: string): Fix[] {
  try {
    // Find JSON array in response
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      return parsed
        .filter(
          (item): item is { file: string; line: number; original: string; replacement: string } =>
            typeof item === 'object' &&
            item !== null &&
            'file' in item &&
            'line' in item &&
            'original' in item &&
            'replacement' in item
        )
        .map((item) => ({
          file: String(item.file),
          line: Number(item.line),
          original: String(item.original),
          replacement: String(item.replacement),
        }));
    }
  } catch {
    // Failed to parse
  }
  return [];
}

/**
 * Clone a repository to a temp directory
 */
async function cloneRepo(repoUrl: string, branch?: string): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-repair-bench-'));
  const git = simpleGit();

  console.log(chalk.dim(`Cloning ${repoUrl}...`));

  if (branch) {
    await git.clone(repoUrl, tempDir, ['--branch', branch, '--depth', '1']);
  } else {
    await git.clone(repoUrl, tempDir, ['--depth', '1']);
  }

  return tempDir;
}

/**
 * Reset a git repository to clean state
 */
async function resetRepo(repoPath: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.reset(['--hard']);
  await git.clean(['-fd']);
}

/**
 * Parse a recipe string like "deleteImport:3,removeAsync:2"
 */
function parseRecipeString(recipeStr: string): MangleRecipe {
  const recipe: MangleRecipe = {};
  const parts = recipeStr.split(',');

  for (const part of parts) {
    const [type, countStr] = part.trim().split(':');
    if (type && countStr) {
      const count = parseInt(countStr, 10);
      if (!isNaN(count)) {
        recipe[type as keyof MangleRecipe] = count;
      }
    }
  }

  return recipe;
}

const program = new Command();

program
  .name('ts-repair-bench')
  .description('Benchmark harness for ts-repair token efficiency')
  .version('1.0.0');

// Run command - single benchmark
program
  .command('run')
  .description('Run a single benchmark comparing vanilla vs ts-repair')
  .option('--repo <url>', 'Git repository URL to benchmark')
  .option('--local <path>', 'Local project path (alternative to --repo)')
  .option('--preset <name>', 'Use a remote repository preset')
  .option('--fixture <name>', 'Use a local fixture (mini, tsx, zod)')
  .option('--recipe-size <size>', 'Recipe size for fixture (small, medium, large)', 'small')
  .option('--errors <count>', 'Target error count (overrides recipe-size)')
  .option('--seed <number>', 'Random seed for reproducibility', '42')
  .option('--recipe <spec>', 'Mangle recipe (e.g., "deleteImport:3,removeAsync:2")')
  .option('--cascade', 'Use cascade-focused recipe')
  .option('--output <path>', 'Output file path for results')
  .option('--mock', 'Use mock Claude client (no API calls)')
  .option('--max-rounds <count>', 'Maximum repair rounds', '20')
  .action(async (options) => {
    try {
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!options.mock && !apiKey) {
        console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable is required'));
        console.error('Set it with: export ANTHROPIC_API_KEY=your-key');
        console.error('Or use --mock for testing without API calls');
        process.exit(1);
      }

      let projectPath: string;
      let tsconfigPath = 'tsconfig.json';
      let targetDir: string | undefined;
      let projectName: string;
      let isFixture = false;

      // Determine project source
      if (options.fixture) {
        const fixture = getFixturePreset(options.fixture);
        if (!fixture) {
          console.error(chalk.red(`Unknown fixture: ${options.fixture}`));
          console.error('Available fixtures:', Object.keys(FIXTURE_PRESETS).join(', '));
          process.exit(1);
        }
        // Resolve fixture path relative to benchmark directory
        const benchmarkDir = path.dirname(path.dirname(new URL(import.meta.url).pathname));
        projectPath = path.resolve(benchmarkDir, fixture.path);
        tsconfigPath = fixture.tsconfig;
        projectName = options.fixture;
        isFixture = true;
      } else if (options.preset) {
        const preset = REPO_PRESETS[options.preset];
        if (!preset) {
          console.error(chalk.red(`Unknown preset: ${options.preset}`));
          console.error('Available presets:', Object.keys(REPO_PRESETS).join(', '));
          process.exit(1);
        }
        projectPath = await cloneRepo(preset.repo);
        tsconfigPath = preset.tsconfig;
        targetDir = preset.targetDir;
        projectName = options.preset;
      } else if (options.repo) {
        projectPath = await cloneRepo(options.repo);
        projectName = path.basename(options.repo, '.git');
      } else if (options.local) {
        projectPath = path.resolve(options.local);
        projectName = path.basename(projectPath);
      } else {
        console.error(chalk.red('Error: Must specify --repo, --local, --preset, or --fixture'));
        process.exit(1);
      }

      // Determine recipe
      let recipe: MangleRecipe;
      let targetErrors: number | undefined;

      if (options.recipe) {
        recipe = parseRecipeString(options.recipe);
      } else if (isFixture && options.fixture) {
        // Use fixture-specific recipe
        const recipeSize = options.recipeSize as RecipeSize;
        const fixtureRecipe = getFixtureRecipe(options.fixture, recipeSize);
        if (fixtureRecipe) {
          recipe = fixtureRecipe;
        } else {
          console.warn(chalk.yellow(`No ${recipeSize} recipe for fixture ${options.fixture}, using default`));
          recipe = DEFAULT_RECIPE;
        }
      } else if (options.cascade) {
        recipe = CASCADE_RECIPE;
      } else {
        recipe = DEFAULT_RECIPE;
      }

      // Scale recipe to target error count if specified
      if (options.errors) {
        targetErrors = parseInt(options.errors, 10);
        recipe = scaleRecipe(recipe, targetErrors);
      }

      const seed = parseInt(options.seed, 10);
      const maxRounds = parseInt(options.maxRounds, 10);

      const config: BenchmarkConfig = {
        name: projectName,
        projectPath,
        tsconfigPath,
        targetDir,
        recipe,
        targetErrorCount: targetErrors ?? 0,
        maxRounds,
        seed,
      };

      console.log(chalk.bold('\nts-repair Benchmark'));
      console.log('─'.repeat(50));
      console.log(`Project: ${chalk.cyan(projectName)}${isFixture ? chalk.dim(' (fixture)') : ''}`);
      if (isFixture) {
        console.log(`Recipe size: ${chalk.cyan(options.recipeSize)}`);
      }
      if (targetErrors) {
        console.log(`Target errors: ${chalk.cyan(targetErrors)}`);
      }
      console.log(`Seed: ${chalk.cyan(seed)}`);
      console.log(`Recipe: ${chalk.dim(JSON.stringify(recipe))}`);
      console.log('─'.repeat(50));

      // Preview mangles
      console.log(chalk.dim('\nAnalyzing mangle candidates...'));
      const preview = previewMangles({
        projectPath,
        tsconfigPath,
        recipe,
        targetDir,
        seed,
      });
      console.log(`Estimated errors after mangling: ${chalk.yellow(preview.estimatedErrors)}`);

      // Apply mangles
      console.log(chalk.dim('\nApplying mangles...'));
      const mangleResult = mangleProject({
        projectPath,
        tsconfigPath,
        recipe,
        targetDir,
        seed,
      });
      applyManglesToDisk(projectPath, mangleResult);
      console.log(`Applied ${chalk.yellow(mangleResult.records.length)} mangles`);

      // Verify errors were introduced
      const tscResult = runTsc(projectPath, tsconfigPath);
      console.log(`Actual error count: ${chalk.yellow(tscResult.diagnostics.length)}`);

      if (tscResult.diagnostics.length === 0) {
        console.error(chalk.red('\nNo errors introduced. Mangles may not have applied correctly.'));
        process.exit(1);
      }

      // Create Claude client
      const claudeClient: ClaudeClient = options.mock
        ? new MockClaudeClient()
        : new AnthropicClient(apiKey!);

      // Run vanilla benchmark
      console.log(chalk.bold('\n[1/2] Running vanilla benchmark...'));
      const vanillaResult = await runVanillaBenchmark(
        config,
        projectPath,
        claudeClient,
        mangleResult.records
      );
      console.log(chalk.dim(`  Completed in ${vanillaResult.rounds.length} rounds`));

      // Reset repo for ts-repair run
      console.log(chalk.dim('\nResetting repository...'));
      await resetRepo(projectPath);
      applyManglesToDisk(projectPath, mangleResult);

      // Run ts-repair benchmark
      console.log(chalk.bold('\n[2/2] Running ts-repair benchmark...'));
      const tsRepairResult = await runTsRepairBenchmark(
        config,
        projectPath,
        claudeClient,
        mangleResult.records
      );
      console.log(chalk.dim(`  Completed in ${tsRepairResult.rounds.length} rounds`));

      // Compare results
      const comparison = compare(vanillaResult, tsRepairResult);

      // Print report
      printConsoleReport(comparison);

      // Save results if output specified
      if (options.output) {
        const outputPath = path.resolve(options.output);
        exportJson([comparison], outputPath);
        console.log(chalk.dim(`Results saved to ${outputPath}`));
      }

      // Cleanup
      if (options.repo || options.preset) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Suite command - run multiple benchmarks with different error counts
program
  .command('suite')
  .description('Run a scaling suite with multiple error counts')
  .option('--repo <url>', 'Git repository URL to benchmark')
  .option('--local <path>', 'Local project path')
  .option('--preset <name>', 'Use a preset configuration')
  .option('--error-counts <list>', 'Comma-separated error counts', '10,20,30,50,80')
  .option('--seed <number>', 'Random seed', '42')
  .option('--output <path>', 'Output file path', 'results/suite.json')
  .option('--mock', 'Use mock Claude client')
  .action(async (options) => {
    try {
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!options.mock && !apiKey) {
        console.error(chalk.red('Error: ANTHROPIC_API_KEY required (or use --mock)'));
        process.exit(1);
      }

      const errorCounts = options.errorCounts.split(',').map((s: string) => parseInt(s.trim(), 10));
      const seed = parseInt(options.seed, 10);
      const comparisons: Comparison[] = [];

      let baseProjectPath: string;
      let tsconfigPath = 'tsconfig.json';
      let targetDir: string | undefined;
      let projectName: string;

      if (options.preset) {
        const preset = REPO_PRESETS[options.preset];
        if (!preset) {
          console.error(chalk.red(`Unknown preset: ${options.preset}`));
          process.exit(1);
        }
        baseProjectPath = await cloneRepo(preset.repo);
        tsconfigPath = preset.tsconfig;
        targetDir = preset.targetDir;
        projectName = options.preset;
      } else if (options.repo) {
        baseProjectPath = await cloneRepo(options.repo);
        projectName = path.basename(options.repo, '.git');
      } else if (options.local) {
        baseProjectPath = path.resolve(options.local);
        projectName = path.basename(baseProjectPath);
      } else {
        console.error(chalk.red('Error: Must specify --repo, --local, or --preset'));
        process.exit(1);
      }

      console.log(chalk.bold('\nts-repair Scaling Suite'));
      console.log('─'.repeat(50));
      console.log(`Project: ${chalk.cyan(projectName)}`);
      console.log(`Error counts: ${chalk.cyan(errorCounts.join(', '))}`);
      console.log('─'.repeat(50));

      const claudeClient: ClaudeClient = options.mock
        ? new MockClaudeClient()
        : new AnthropicClient(apiKey!);

      for (let i = 0; i < errorCounts.length; i++) {
        const targetErrors = errorCounts[i]!;
        console.log(chalk.bold(`\n[${i + 1}/${errorCounts.length}] Running with ${targetErrors} errors...`));

        // Reset repo
        await resetRepo(baseProjectPath);

        // Scale recipe
        const recipe = scaleRecipe(DEFAULT_RECIPE, targetErrors);

        const config: BenchmarkConfig = {
          name: `${projectName}-${targetErrors}`,
          projectPath: baseProjectPath,
          tsconfigPath,
          targetDir,
          recipe,
          targetErrorCount: targetErrors,
          maxRounds: 20,
          seed: seed + i, // Vary seed slightly for different runs
        };

        // Apply mangles
        const mangleResult = mangleProject({
          projectPath: baseProjectPath,
          tsconfigPath,
          recipe,
          targetDir,
          seed: seed + i,
        });
        applyManglesToDisk(baseProjectPath, mangleResult);

        // Run vanilla
        console.log(chalk.dim('  Running vanilla...'));
        const vanillaResult = await runVanillaBenchmark(
          config,
          baseProjectPath,
          claudeClient,
          mangleResult.records
        );

        // Reset and re-apply mangles
        await resetRepo(baseProjectPath);
        applyManglesToDisk(baseProjectPath, mangleResult);

        // Run ts-repair
        console.log(chalk.dim('  Running ts-repair...'));
        const tsRepairResult = await runTsRepairBenchmark(
          config,
          baseProjectPath,
          claudeClient,
          mangleResult.records
        );

        comparisons.push(compare(vanillaResult, tsRepairResult));

        console.log(
          chalk.dim(`  Token savings: ${comparisons[comparisons.length - 1]!.tokenSavingsPercent.toFixed(1)}%`)
        );
      }

      // Analyze scaling
      const scaling = analyzeScaling(comparisons);
      printScalingReport(scaling);

      // Export results
      const outputPath = path.resolve(options.output);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      exportJson(comparisons, outputPath);
      exportCsv(comparisons, outputPath.replace('.json', '.csv'));
      exportMarkdown(comparisons, outputPath.replace('.json', '.md'));

      console.log(chalk.dim(`\nResults saved to ${path.dirname(outputPath)}/`));

      // Cleanup
      if (options.repo || options.preset) {
        fs.rmSync(baseProjectPath, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Estimate command - quick token estimation without API calls
program
  .command('estimate')
  .description('Estimate token usage without running the full benchmark')
  .option('--local <path>', 'Local project path with errors')
  .option('--tsconfig <path>', 'Path to tsconfig.json', 'tsconfig.json')
  .action((options) => {
    if (!options.local) {
      console.error(chalk.red('Error: --local path is required'));
      process.exit(1);
    }

    const projectPath = path.resolve(options.local);

    console.log(chalk.bold('\nToken Estimation'));
    console.log('─'.repeat(50));

    // Run tsc to get current errors
    const tscResult = runTsc(projectPath, options.tsconfig);
    console.log(`Current errors: ${chalk.yellow(tscResult.diagnostics.length)}`);

    if (tscResult.diagnostics.length === 0) {
      console.log(chalk.green('No errors to fix!'));
      return;
    }

    // Estimate vanilla
    const vanillaEst = estimateVanillaTokens(projectPath, options.tsconfig);
    console.log(chalk.bold('\nVanilla estimate:'));
    console.log(`  Rounds: ~${vanillaEst.estimatedRounds}`);
    console.log(`  Prompt tokens: ~${vanillaEst.estimatedPromptTokens.toLocaleString()}`);
    console.log(`  Completion tokens: ~${vanillaEst.estimatedCompletionTokens.toLocaleString()}`);

    // Estimate ts-repair
    const tsRepairEst = estimateTsRepairTokens(projectPath, options.tsconfig);
    console.log(chalk.bold('\nts-repair estimate:'));
    console.log(`  Rounds: ~${tsRepairEst.estimatedRounds}`);
    console.log(`  Prompt tokens: ~${tsRepairEst.estimatedPromptTokens.toLocaleString()}`);
    console.log(`  Completion tokens: ~${tsRepairEst.estimatedCompletionTokens.toLocaleString()}`);
    console.log(`  Auto-fixed: ~${tsRepairEst.estimatedAutoFixed}`);
    console.log(`  Punted to LLM: ~${tsRepairEst.estimatedPuntedToLlm}`);

    // Calculate savings
    const vanillaTotal = vanillaEst.estimatedPromptTokens + vanillaEst.estimatedCompletionTokens;
    const tsRepairTotal = tsRepairEst.estimatedPromptTokens + tsRepairEst.estimatedCompletionTokens;
    const savings = ((vanillaTotal - tsRepairTotal) / vanillaTotal) * 100;

    console.log(chalk.bold('\nEstimated savings:'));
    console.log(`  ${savings >= 0 ? chalk.green(`${savings.toFixed(1)}%`) : chalk.red(`${savings.toFixed(1)}%`)} token reduction`);
  });

// Analyze command - analyze existing results
program
  .command('analyze')
  .description('Analyze existing benchmark results')
  .argument('<files...>', 'JSON result files to analyze')
  .option('--output <path>', 'Output file for analysis')
  .action((files: string[], options) => {
    const comparisons: Comparison[] = [];

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { results: Array<{
          vanilla: { initialDiagnostics: number; finalDiagnostics: number; rounds: number; promptTokens: number; completionTokens: number; totalTokens: number; wallTimeMs: number; success: boolean };
          tsRepair: { initialDiagnostics: number; finalDiagnostics: number; rounds: number; promptTokens: number; completionTokens: number; totalTokens: number; wallTimeMs: number; success: boolean; autoFixed?: number; puntedToLlm?: number };
          comparison: { tokenSavingsPercent: number; roundSavingsPercent: number; autoFixRate: number; savingsByCategory: { cascade: { vanilla: number; tsRepair: number }; mechanical: { vanilla: number; tsRepair: number }; judgment: { vanilla: number; tsRepair: number } } };
          config: BenchmarkConfig;
        }> };

        for (const result of data.results) {
          comparisons.push({
            vanilla: {
              approach: 'vanilla',
              config: result.config,
              mangles: [],
              initialDiagnosticCount: result.vanilla.initialDiagnostics,
              finalDiagnosticCount: result.vanilla.finalDiagnostics,
              rounds: [],
              totalPromptTokens: result.vanilla.promptTokens,
              totalCompletionTokens: result.vanilla.completionTokens,
              totalTokens: result.vanilla.totalTokens,
              totalWallTimeMs: result.vanilla.wallTimeMs,
              success: result.vanilla.success,
            },
            tsRepair: {
              approach: 'ts-repair',
              config: result.config,
              mangles: [],
              initialDiagnosticCount: result.tsRepair.initialDiagnostics,
              finalDiagnosticCount: result.tsRepair.finalDiagnostics,
              rounds: [],
              totalPromptTokens: result.tsRepair.promptTokens,
              totalCompletionTokens: result.tsRepair.completionTokens,
              totalTokens: result.tsRepair.totalTokens,
              totalWallTimeMs: result.tsRepair.wallTimeMs,
              success: result.tsRepair.success,
              autoFixed: result.tsRepair.autoFixed,
              puntedToLlm: result.tsRepair.puntedToLlm,
            },
            tokenSavingsPercent: result.comparison.tokenSavingsPercent,
            roundSavingsPercent: result.comparison.roundSavingsPercent,
            autoFixRate: result.comparison.autoFixRate,
            savingsByErrorCategory: result.comparison.savingsByCategory,
          });
        }
      } catch (error) {
        console.error(chalk.yellow(`Warning: Could not parse ${file}`));
      }
    }

    if (comparisons.length === 0) {
      console.error(chalk.red('No valid results found'));
      process.exit(1);
    }

    // Print each comparison
    for (const comparison of comparisons) {
      printConsoleReport(comparison);
    }

    // If multiple results, do scaling analysis
    if (comparisons.length > 1) {
      const scaling = analyzeScaling(comparisons);
      printScalingReport(scaling);
    }

    // Export if output specified
    if (options.output) {
      const outputPath = path.resolve(options.output);
      exportMarkdown(comparisons, outputPath);
      console.log(chalk.dim(`Analysis saved to ${outputPath}`));
    }
  });

// Fixtures command - list available local fixtures
program
  .command('fixtures')
  .description('List available local fixtures')
  .action(() => {
    console.log(chalk.bold('\nLocal Fixtures:'));
    console.log('─'.repeat(60));

    for (const [name, fixture] of Object.entries(FIXTURE_PRESETS)) {
      console.log(`  ${chalk.cyan(name.padEnd(10))} ${fixture.description}`);
      console.log(`  ${''.padEnd(10)} ${chalk.dim(`~${fixture.linesOfCode.toLocaleString()} LoC`)}`);

      // Show available recipe sizes
      const recipes = FIXTURE_RECIPES[name];
      if (recipes) {
        const sizes = Object.keys(recipes).join(', ');
        console.log(`  ${''.padEnd(10)} Recipes: ${chalk.dim(sizes)}`);
      }
      console.log();
    }

    console.log('Usage: ts-repair-bench run --fixture <name> --recipe-size small');
    console.log('       ts-repair-bench run --fixture tsx --recipe-size medium --mock');
  });

// Presets command - list available remote repository presets
program
  .command('presets')
  .description('List available remote repository presets')
  .action(() => {
    console.log(chalk.bold('\nRemote Repository Presets:'));
    console.log('─'.repeat(60));

    for (const [name, preset] of Object.entries(REPO_PRESETS)) {
      console.log(`  ${chalk.cyan(name.padEnd(15))} ${preset.repo}`);
      if (preset.targetDir) {
        console.log(`  ${''.padEnd(15)} Target: ${chalk.dim(preset.targetDir)}`);
      }
    }

    console.log('\nUsage: ts-repair-bench run --preset <name> --errors 25');
    console.log('\nFor local fixtures, use: ts-repair-bench fixtures');
  });

// Preview command - show what mangles would be applied
program
  .command('preview')
  .description('Preview what mangles would be applied without making changes')
  .option('--local <path>', 'Local project path', '.')
  .option('--tsconfig <path>', 'Path to tsconfig.json', 'tsconfig.json')
  .option('--errors <count>', 'Target error count', '25')
  .option('--seed <number>', 'Random seed', '42')
  .option('--recipe <spec>', 'Mangle recipe')
  .option('--cascade', 'Use cascade-focused recipe')
  .action((options) => {
    const projectPath = path.resolve(options.local);

    let recipe: MangleRecipe;
    if (options.recipe) {
      recipe = parseRecipeString(options.recipe);
    } else if (options.cascade) {
      recipe = CASCADE_RECIPE;
    } else {
      recipe = DEFAULT_RECIPE;
    }

    const targetErrors = parseInt(options.errors, 10);
    recipe = scaleRecipe(recipe, targetErrors);

    console.log(chalk.bold('\nMangle Preview'));
    console.log('─'.repeat(50));
    console.log(`Project: ${chalk.cyan(projectPath)}`);
    console.log(`Target errors: ${chalk.cyan(targetErrors)}`);
    console.log(`Scaled recipe: ${chalk.dim(JSON.stringify(recipe))}`);
    console.log('─'.repeat(50));

    const preview = previewMangles({
      projectPath,
      tsconfigPath: options.tsconfig,
      recipe,
      seed: parseInt(options.seed, 10),
    });

    console.log(chalk.bold('\nAvailable candidates:'));
    for (const [type, count] of Object.entries(preview.candidateCounts)) {
      if (count > 0) {
        console.log(`  ${type.padEnd(25)} ${count}`);
      }
    }

    console.log(chalk.bold('\nSelected for mangling:'));
    for (const [type, count] of Object.entries(preview.selectedCounts)) {
      if (count > 0) {
        console.log(`  ${type.padEnd(25)} ${count}`);
      }
    }

    console.log(chalk.bold(`\nEstimated errors: ${chalk.yellow(preview.estimatedErrors)}`));
  });

program.parse();
