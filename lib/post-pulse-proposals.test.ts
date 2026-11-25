// Scope rule (migration 039): automated research (rss, search, frontier)
// may only create AI entries and must leave non-AI entries alone; chat may
// file anything. Run: npx tsx --test lib/post-pulse-proposals.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProposal, automatedScopeError, validateStoredProposal, type PpProposalContext } from './post-pulse-proposals'

const DEPT = { id: '11111111-1111-1111-1111-111111111111', slug: 'hair-groom-feathers' }
const ctx: PpProposalContext = {
  departments: [{ id: DEPT.id, name: 'Hair, Groom & Feathers' }],
  tools: [
    { id: '22222222-2222-2222-2222-222222222222', name: 'GroomBear', department_id: DEPT.id, ai_involvement: 'none' },
    { id: '33333333-3333-3333-3333-333333333333', name: 'Some AI Groomer', department_id: DEPT.id, ai_involvement: 'assisted' },
  ],
}

const nonAiPlugin = { name: 'ZZ Brush Kit', kind: 'software', ai_involvement: 'none', tier: 'artist_led', vendor: 'Someone', url: 'https://example.com/kit' }
const assetLibrary = { name: 'ZZ Animal Library', kind: 'asset_library', ai_involvement: 'none', vendor: 'Someone', url: 'https://example.com/lib' }
const aiTool = { name: 'ZZ Neural Groom', kind: 'software', ai_involvement: 'core', tier: 'assisted', vendor: 'Someone', url: 'https://example.com/ai' }

for (const source of ['rss', 'search', 'frontier'] as const) {
  test(`${source}: a non-AI plugin create is refused with "skipped: not AI"`, () => {
    const r = buildProposal({ kind: 'tool_create', department: DEPT, fields: nonAiPlugin, note: 'n', source }, ctx)
    assert.equal(r.ok, false)
    assert.match((r as { error: string }).error, /^skipped: not AI/)
  })
  test(`${source}: an asset library create is refused`, () => {
    const r = buildProposal({ kind: 'tool_create', department: DEPT, fields: assetLibrary, note: 'n', source }, ctx)
    assert.equal(r.ok, false)
    assert.match((r as { error: string }).error, /^skipped: not AI/)
  })
  test(`${source}: a create with no ai_involvement is refused (incomplete or ambiguous notes too)`, () => {
    const { ai_involvement: _drop, ...noAi } = aiTool
    void _drop
    const plain = buildProposal({ kind: 'tool_create', department: DEPT, fields: noAi, note: 'n', source }, ctx)
    const flagged = buildProposal({ kind: 'tool_create', department: DEPT, fields: { name: 'ZZ Unknown' }, note: 'n', source, flag: 'ambiguous' }, ctx)
    assert.equal(plain.ok, false)
    assert.equal(flagged.ok, false)
  })
  test(`${source}: an update to a non-AI entry is refused`, () => {
    const r = buildProposal({ kind: 'tool_update', toolId: ctx.tools[0].id, changes: { blurb: 'x' }, note: 'n', source }, ctx)
    assert.equal(r.ok, false)
    assert.match((r as { error: string }).error, /^skipped: not AI/)
  })
  test(`${source}: an update may not mark an AI entry non-AI`, () => {
    const r = buildProposal({ kind: 'tool_update', toolId: ctx.tools[1].id, changes: { ai_involvement: 'none' }, note: 'n', source }, ctx)
    assert.equal(r.ok, false)
  })
  test(`${source}: an AI tool create still goes through`, () => {
    const r = buildProposal({ kind: 'tool_create', department: DEPT, fields: aiTool, note: 'n', source }, ctx)
    assert.equal(r.ok, true)
  })
  test(`${source}: an update to an AI entry still goes through`, () => {
    const r = buildProposal({ kind: 'tool_update', toolId: ctx.tools[1].id, changes: { blurb: 'x' }, note: 'n', source }, ctx)
    assert.equal(r.ok, true)
  })
}

test('chat may file a non-AI plugin (with tier) and an asset library (without tier)', () => {
  const plugin = buildProposal({ kind: 'tool_create', department: DEPT, fields: nonAiPlugin, note: 'n', source: 'chat' }, ctx)
  const lib = buildProposal({ kind: 'tool_create', department: DEPT, fields: assetLibrary, note: 'n', source: 'chat' }, ctx)
  assert.equal(plugin.ok, true)
  assert.equal(lib.ok, true)
  assert.equal(automatedScopeError({ kind: 'tool_update', toolId: ctx.tools[0].id, changes: { blurb: 'x' }, note: 'n', source: 'chat' }, ctx), null)
})

test('tier: required for software, refused for other kinds, and stored rows validate the same way', () => {
  const noTier = buildProposal({ kind: 'tool_create', department: DEPT, fields: { ...nonAiPlugin, tier: undefined }, note: 'n', source: 'chat' }, ctx)
  assert.equal(noTier.ok, false)
  const libWithTier = buildProposal({ kind: 'tool_create', department: DEPT, fields: { ...assetLibrary, tier: 'artist_led' }, note: 'n', source: 'chat' }, ctx)
  assert.equal(libWithTier.ok, false)
  const lib = buildProposal({ kind: 'tool_create', department: DEPT, fields: assetLibrary, note: 'n', source: 'chat' }, ctx)
  assert.ok(lib.ok)
  const v = validateStoredProposal({ target_type: 'tool', proposed_tool_id: null, proposed_department_id: null, proposed_changes: lib.row.proposed_changes })
  assert.equal(v.ok, true)
})

test('not_this is stored for the reviewer and is not an editable field', () => {
  const r = buildProposal(
    { kind: 'tool_create', department: DEPT, fields: nonAiPlugin, note: 'n', source: 'chat', notThis: [{ name: 'KeyFlow', vendor: 'Other Maker', url: 'https://example.org', why: 'paid' }] },
    ctx
  )
  assert.ok(r.ok)
  assert.deepEqual(r.row.proposed_changes.not_this, [{ name: 'KeyFlow', vendor: 'Other Maker', url: 'https://example.org', why: 'paid' }])
})
