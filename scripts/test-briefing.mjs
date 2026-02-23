// Quick end-to-end test: streams one briefing and prints each SSE event.
// Run with: node scripts/test-briefing.mjs

const BASE = 'http://localhost:3000'

// 1. Fetch the first channel
const channelsRes = await fetch(`${BASE}/api/channels`)
const channels = await channelsRes.json()
if (!channels.length) {
  console.error('No channels found — run supabase/seed.sql first')
  process.exit(1)
}

const channel = channels[0]
console.log(`\n📡  Testing channel: "${channel.name}" (${channel.id})\n`)

// 2. Hit the briefing endpoint and stream the response
const res = await fetch(`${BASE}/api/briefings/${channel.id}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel }),
})

if (!res.ok) {
  console.error(`HTTP ${res.status}`, await res.text())
  process.exit(1)
}

const decoder = new TextDecoder()
let textChunks = 0
let searchCount = 0
let sourceCount = 0
let done = false

for await (const chunk of res.body) {
  const text = decoder.decode(chunk, { stream: true })
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const event = JSON.parse(line.slice(6))
      switch (event.type) {
        case 'searching':
          searchCount++
          console.log(`🔍  [search ${searchCount}] "${event.query}"`)
          break
        case 'source':
          sourceCount++
          console.log(`🔗  [source ${sourceCount}] ${event.source.title} — ${event.source.url}`)
          break
        case 'text_delta':
          textChunks++
          if (textChunks === 1) process.stdout.write('\n📝  ')
          process.stdout.write(event.text)
          break
        case 'done':
          done = true
          console.log(`\n\n✅  Done — ${searchCount} searches, ${sourceCount} sources, ${textChunks} text chunks`)
          break
        case 'error':
          console.error(`\n❌  Error: ${event.error}`)
          process.exit(1)
      }
    } catch { /* skip malformed lines */ }
  }
  if (done) break
}
