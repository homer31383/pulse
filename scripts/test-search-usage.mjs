// Smoke test: web_search_20260209 + max_uses on the upgraded SDK.
// Mirrors lib/generation.ts runWebSearchStream; prints full usage fields.
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

let content = ''
let sourceCount = 0
let searchQueries = 0

const stream = anthropic.messages.stream({
  model: 'claude-sonnet-5',
  max_tokens: 600,
  system: 'You are a research assistant. Be extremely brief.',
  messages: [{ role: 'user', content: 'In 2-3 sentences: what is the latest stable Node.js LTS version?' }],
  tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }],
})

for await (const event of stream) {
  if (event.type === 'content_block_start') {
    const block = event.content_block
    if (block.type === 'server_tool_use') searchQueries++
    if (block.type === 'web_search_tool_result') {
      const results = Array.isArray(block.content) ? block.content : []
      for (const r of results) {
        if (r.type === 'web_search_result' && r.url) sourceCount++
      }
    }
  }
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    content += event.delta.text
  }
}

const msg = await stream.finalMessage()
const u = msg.usage
console.log('--- content ---')
console.log(content.trim().slice(0, 300))
console.log('--- parsing ---')
console.log('server_tool_use blocks:', searchQueries, '| web_search_result sources parsed:', sourceCount)
console.log('--- usage ---')
console.log('input_tokens:              ', u.input_tokens)
console.log('output_tokens:             ', u.output_tokens)
console.log('cache_creation_input_tokens:', u.cache_creation_input_tokens)
console.log('cache_read_input_tokens:   ', u.cache_read_input_tokens)
console.log('server_tool_use:           ', JSON.stringify(u.server_tool_use))
console.log('stop_reason:               ', msg.stop_reason)
