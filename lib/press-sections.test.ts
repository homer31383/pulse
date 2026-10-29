// Run: npx tsx --test lib/press-sections.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripPreHeadingNarration } from './press-sections'

test('content that opens with a heading is unchanged', () => {
  const md = '# Title\n\nBody.'
  assert.deepEqual(stripPreHeadingNarration(md), { content: md, stripped: '' })
})

test('leading whitespace alone is not narration', () => {
  const md = '\n\n  # Title\n\nBody.'
  assert.deepEqual(stripPreHeadingNarration(md), { content: md, stripped: '' })
})

test('content with no heading is unchanged', () => {
  const md = 'Just a paragraph. Then another: with a colon.'
  assert.deepEqual(stripPreHeadingNarration(md), { content: md, stripped: '' })
})

test('narration on its own lines before the heading is removed', () => {
  const r = stripPreHeadingNarration('I have enough now. Let me write it.\n\n---\n\n# Title\n\nBody.')
  assert.equal(r.stripped, 'I have enough now. Let me write it.\n\n---\n\n')
  assert.equal(r.content, '# Title\n\nBody.')
})

test('a heading glued to a sentence ending in a period', () => {
  const r = stripPreHeadingNarration('Let me write the briefing.# 🎬 Classic Movies\n\nBody.')
  assert.equal(r.stripped, 'Let me write the briefing.')
  assert.equal(r.content, '# 🎬 Classic Movies\n\nBody.')
})

test('a heading glued to narration ending in a colon', () => {
  // Digest 87e663bf (Jul 19 2026): the cut used to fall at the next heading,
  // taking the real headline with the narration
  const md = '\n\nNow let me search for a couple more fascinating topics to round out the digest:# Morning Digest \u2014 Sunday, July 19, 2026\n\n---\n\n## Key Takeaways\n\n1. **One**'
  const r = stripPreHeadingNarration(md)
  assert.equal(r.stripped, '\n\nNow let me search for a couple more fascinating topics to round out the digest:')
  assert.ok(r.content.startsWith('# Morning Digest \u2014 Sunday, July 19, 2026\n'))
  assert.equal(r.stripped + r.content, md)
})

test('a colon followed by a hashtag or C# is not a heading', () => {
  for (const md of ['Trending:#design today.\n\n# Title', 'Written in C#: notes.\n\n# Title']) {
    const r = stripPreHeadingNarration(md)
    assert.equal(r.content, '# Title')
  }
})

test('a glued colon heading later in the body never moves the cut past the first heading', () => {
  const md = 'Intro.\n\n# Title\n\nSee the list:## Not a narration cut\n\nBody.'
  const r = stripPreHeadingNarration(md)
  assert.equal(r.stripped, 'Intro.\n\n')
  assert.ok(r.content.startsWith('# Title'))
})
