/**
 * Tests for token counting utilities
 */

import { describe, test, expect, afterAll } from 'bun:test';
import {
  countTokens,
  countPromptTokens,
  estimateCompletionTokens,
  formatTokenCount,
  calculateCost,
  formatCost,
  cleanup,
  calculateTokenStats,
} from '../src/token-counter.js';

afterAll(() => {
  cleanup();
});

describe('countTokens', () => {
  test('counts tokens in simple text', () => {
    const count = countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  test('counts tokens in code', () => {
    const code = `
      function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const count = countTokens(code);
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(100);
  });

  test('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  test('handles TypeScript error messages', () => {
    const error = "TS2304: Cannot find name 'User'";
    const count = countTokens(error);
    expect(count).toBeGreaterThan(0);
  });
});

describe('countPromptTokens', () => {
  test('counts tokens in message array', () => {
    const messages = [
      { role: 'system' as const, content: 'You are a TypeScript expert.' },
      { role: 'user' as const, content: 'Fix this error: TS2304' },
    ];
    const count = countPromptTokens(messages);
    // Content tokens + overhead (4 per message + 2 for start/end)
    expect(count).toBeGreaterThan(10);
  });

  test('handles empty message array', () => {
    const count = countPromptTokens([]);
    // Just start/end tokens
    expect(count).toBe(2);
  });
});

describe('estimateCompletionTokens', () => {
  test('estimates tokens for fix count', () => {
    expect(estimateCompletionTokens(0)).toBe(20); // Base overhead
    expect(estimateCompletionTokens(1)).toBe(70); // 20 + 50
    expect(estimateCompletionTokens(5)).toBe(270); // 20 + 250
  });
});

describe('formatTokenCount', () => {
  test('formats small numbers as-is', () => {
    expect(formatTokenCount(42)).toBe('42');
    expect(formatTokenCount(999)).toBe('999');
  });

  test('formats thousands with K suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0K');
    expect(formatTokenCount(5500)).toBe('5.5K');
    expect(formatTokenCount(999999)).toBe('1000.0K');
  });

  test('formats millions with M suffix', () => {
    expect(formatTokenCount(1000000)).toBe('1.00M');
    expect(formatTokenCount(2500000)).toBe('2.50M');
  });
});

describe('calculateCost', () => {
  test('calculates cost based on Claude Sonnet pricing', () => {
    // $3/1M input, $15/1M output
    const cost = calculateCost(1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18.0, 2); // $3 input + $15 output
  });

  test('calculates zero cost for zero tokens', () => {
    expect(calculateCost(0, 0)).toBe(0);
  });

  test('calculates typical benchmark cost', () => {
    // 50K prompt, 5K completion
    const cost = calculateCost(50_000, 5_000);
    // (50K/1M * $3) + (5K/1M * $15) = $0.15 + $0.075 = $0.225
    expect(cost).toBeCloseTo(0.225, 3);
  });
});

describe('formatCost', () => {
  test('formats small costs in cents', () => {
    expect(formatCost(0.001)).toBe('$0.100¢');
    expect(formatCost(0.0099)).toBe('$0.990¢');
  });

  test('formats larger costs in dollars', () => {
    expect(formatCost(0.01)).toBe('$0.0100');
    expect(formatCost(1.50)).toBe('$1.5000');
  });
});

describe('calculateTokenStats', () => {
  test('returns complete statistics', () => {
    const stats = calculateTokenStats(10000, 2000);

    expect(stats.promptTokens).toBe(10000);
    expect(stats.completionTokens).toBe(2000);
    expect(stats.totalTokens).toBe(12000);
    expect(stats.estimatedCost).toBeGreaterThan(0);
    expect(stats.formattedPrompt).toBe('10.0K');
    expect(stats.formattedCompletion).toBe('2.0K');
    expect(stats.formattedTotal).toBe('12.0K');
    expect(stats.formattedCost).toMatch(/\$/);
  });
});
