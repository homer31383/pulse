// Pricing in USD per 1 million tokens
const PRICING: Record<string, { input: number; output: number }> = {
  // Sonnet 5 has an intro rate of $2/$10 through 2026-08-31; standard rate used
  // here so costs aren't underreported after it lapses.
  'claude-sonnet-5':   { input: 3,  output: 15 },
  'claude-opus-4-8':   { input: 5,  output: 25 },
  // Legacy models kept for profiles that haven't re-saved settings yet
  'claude-sonnet-4-6': { input: 3,  output: 15 },
  'claude-opus-4-6':   { input: 5,  output: 25 },
}

const DEFAULT_PRICING = { input: 3, output: 15 }

// Cache writes bill at 1.25x input price, cache reads at 0.1x.
// Web search tool requests bill at $10 per 1,000 searches.
const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1
const WEB_SEARCH_COST_PER_CALL = 10 / 1000

export interface UsageExtras {
  cacheCreationTokens?: number
  cacheReadTokens?: number
  webSearchCount?: number
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  extras?: UsageExtras,
): number {
  const p = PRICING[model] ?? DEFAULT_PRICING
  return (
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    ((extras?.cacheCreationTokens ?? 0) / 1_000_000) * p.input * CACHE_WRITE_MULTIPLIER +
    ((extras?.cacheReadTokens ?? 0) / 1_000_000) * p.input * CACHE_READ_MULTIPLIER +
    (extras?.webSearchCount ?? 0) * WEB_SEARCH_COST_PER_CALL
  )
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
