import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const DEFAULT_MODEL = 'claude-sonnet-5'

// Settings rows saved before the Sonnet 5 / Opus 4.8 upgrade may still hold
// the previous model IDs — map them to their successors at read time.
const LEGACY_MODELS: Record<string, string> = {
  'claude-sonnet-4-6': 'claude-sonnet-5',
  'claude-opus-4-6': 'claude-opus-4-8',
}

export function resolveModel(model?: string | null): string {
  if (!model) return DEFAULT_MODEL
  return LEGACY_MODELS[model] ?? model
}
