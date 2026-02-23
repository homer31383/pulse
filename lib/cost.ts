// Pricing in USD per 1 million tokens
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3,  output: 15 },
  'claude-opus-4-6':   { input: 15, output: 75 },
}

const DEFAULT_PRICING = { input: 3, output: 15 }

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model] ?? DEFAULT_PRICING
  return (inputTokens / 1_000_000) * p.input +
         (outputTokens / 1_000_000) * p.output
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1)    return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  return n.toLocaleString()
}
