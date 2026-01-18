/**
 * Token counting utilities using tiktoken
 *
 * Uses cl100k_base encoding which is the closest available
 * to Claude's tokenizer.
 */

import { encoding_for_model, type TiktokenModel } from 'tiktoken';
import type { Message } from './types.js';

// Use cl100k_base encoding (GPT-4/ChatGPT model encoding, closest to Claude)
const MODEL: TiktokenModel = 'gpt-4';

let encoder: ReturnType<typeof encoding_for_model> | null = null;

/**
 * Get or create the tiktoken encoder
 */
function getEncoder(): ReturnType<typeof encoding_for_model> {
  if (!encoder) {
    encoder = encoding_for_model(MODEL);
  }
  return encoder;
}

/**
 * Count tokens in a string
 */
export function countTokens(text: string): number {
  const enc = getEncoder();
  return enc.encode(text).length;
}

/**
 * Count tokens in a message array with formatting overhead
 */
export function countPromptTokens(messages: Message[]): number {
  let total = 0;

  for (const msg of messages) {
    // Count content tokens
    total += countTokens(msg.content);
    // Add overhead for role and message formatting (~4 tokens)
    total += 4;
  }

  // Add start/end tokens
  total += 2;

  return total;
}

/**
 * Estimate completion tokens based on fix count and average fix size
 */
export function estimateCompletionTokens(fixCount: number): number {
  // Empirical: ~50 tokens per fix on average
  const TOKENS_PER_FIX = 50;
  // Base overhead for JSON structure
  const BASE_OVERHEAD = 20;

  return BASE_OVERHEAD + fixCount * TOKENS_PER_FIX;
}

/**
 * Count tokens in code (may be slightly different due to code-specific tokens)
 */
export function countCodeTokens(code: string): number {
  return countTokens(code);
}

/**
 * Format a token count for display
 */
export function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(2)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Calculate cost based on token counts
 * Using Claude Sonnet 4 pricing: $3/1M input, $15/1M output
 */
export function calculateCost(promptTokens: number, completionTokens: number): number {
  const INPUT_COST_PER_MILLION = 3.0;
  const OUTPUT_COST_PER_MILLION = 15.0;

  const inputCost = (promptTokens / 1_000_000) * INPUT_COST_PER_MILLION;
  const outputCost = (completionTokens / 1_000_000) * OUTPUT_COST_PER_MILLION;

  return inputCost + outputCost;
}

/**
 * Format a cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(3)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Cleanup the encoder when done
 */
export function cleanup(): void {
  if (encoder) {
    encoder.free();
    encoder = null;
  }
}

/**
 * Token statistics for a benchmark run
 */
export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  formattedPrompt: string;
  formattedCompletion: string;
  formattedTotal: string;
  formattedCost: string;
}

/**
 * Calculate token statistics
 */
export function calculateTokenStats(
  promptTokens: number,
  completionTokens: number
): TokenStats {
  const totalTokens = promptTokens + completionTokens;
  const estimatedCost = calculateCost(promptTokens, completionTokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCost,
    formattedPrompt: formatTokenCount(promptTokens),
    formattedCompletion: formatTokenCount(completionTokens),
    formattedTotal: formatTokenCount(totalTokens),
    formattedCost: formatCost(estimatedCost),
  };
}
