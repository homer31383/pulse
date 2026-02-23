'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { ChannelCard } from './ChannelCard'
import { BriefingCard } from './BriefingCard'
import { GroupSection } from './GroupSection'
import { formatCost } from '@/lib/cost'
import type { Channel, ChannelGroup, BriefingState, BriefingStreamEvent, AppSettings } from '@/lib/types'

interface HomeClientProps {
  channels: Channel[]
  settings: AppSettings
  groups: ChannelGroup[]
}

export function HomeClient({ channels: initialChannels, settings, groups: initialGroups }: HomeClientProps) {
  const [channels, setChannels] = useState<Channel[]>(initialChannels)
  const [groups, setGroups] = useState<ChannelGroup[]>(initialGroups)
  const [newGroupName, setNewGroupName] = useState('')
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [briefings, setBriefings] = useState<Map<string, BriefingState>>(new Map())
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCrossChannelGenerating, setIsCrossChannelGenerating] = useState(false)
  const [isWeeklySummaryGenerating, setIsWeeklySummaryGenerating] = useState(false)

  // ── DnD sensors ───────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)

    // ── Group reorder ──────────────────────────────────────────────────────
    if (activeIdStr.startsWith('group:') && overIdStr.startsWith('group:')) {
      setGroups((prev) => {
        const oldIndex = prev.findIndex((g) => `group:${g.id}` === activeIdStr)
        const newIndex = prev.findIndex((g) => `group:${g.id}` === overIdStr)
        const reordered = arrayMove(prev, oldIndex, newIndex)
        fetch('/api/channel-groups/reorder', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: reordered.map((g) => g.id) }),
        })
        return reordered
      })
      return
    }

    // ── Channel reorder (within same group context) ──────────────────────
    const activeGroupId = (active.data.current as { groupId?: string | null })?.groupId ?? null
    const overGroupId = (over.data.current as { groupId?: string | null })?.groupId ?? null

    // Don't allow cross-group drops via drag (use config page to reassign)
    if (activeGroupId !== overGroupId) return

    setChannels((prev) => {
      // Reorder only within the relevant subset (ungrouped or specific group)
      const subset = prev.filter((c) =>
        activeGroupId ? c.group_id === activeGroupId : c.group_id == null
      )
      const rest = prev.filter((c) =>
        activeGroupId ? c.group_id !== activeGroupId : c.group_id != null
      )
      const oldIndex = subset.findIndex((c) => c.id === activeIdStr)
      const newIndex = subset.findIndex((c) => c.id === overIdStr)
      const reorderedSubset = arrayMove(subset, oldIndex, newIndex)
      const reordered = activeGroupId
        ? [...rest, ...reorderedSubset]
        : [...reorderedSubset, ...rest]

      // Persist: send ALL channel IDs in global display order
      // (ungrouped first, then per group in group order)
      const ungrouped = reordered.filter((c) => c.group_id == null)
      const grouped = groups.flatMap((g) => reordered.filter((c) => c.group_id === g.id))
      fetch('/api/channels/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...ungrouped, ...grouped].map((c) => c.id) }),
      })
      return reordered
    })
  }

  // ── Group management ──────────────────────────────────────────────────────
  async function createGroup() {
    const name = newGroupName.trim()
    if (!name || isCreatingGroup) return
    setIsCreatingGroup(true)
    setGroupError('')
    try {
      const res = await fetch('/api/channel-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const group = await res.json() as ChannelGroup
        setGroups((prev) => [...prev, group])
        setNewGroupName('')
      } else {
        const body = await res.json().catch(() => ({}))
        setGroupError(body.error ?? `Error ${res.status}`)
      }
    } catch {
      setGroupError('Network error')
    } finally {
      setIsCreatingGroup(false)
    }
  }

  function handleRenameGroup(groupId: string, name: string) {
    setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, name } : g))
    fetch(`/api/channel-groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  }

  function handleDeleteGroup(groupId: string) {
    // Ungroup channels that belong to this group
    setChannels((prev) => prev.map((c) => c.group_id === groupId ? { ...c, group_id: null } : c))
    setGroups((prev) => prev.filter((g) => g.id !== groupId))
    fetch(`/api/channel-groups/${groupId}`, { method: 'DELETE' })
  }

  // ── Selection helpers ─────────────────────────────────────────────────────
  function toggleChannel(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(
      selectedIds.size === channels.length ? new Set() : new Set(channels.map((c) => c.id))
    )
  }

  // ── Stream event handler (shared by all stream types) ─────────────────────
  function handleStreamEvent(stateKey: string, event: BriefingStreamEvent) {
    setBriefings((prev) => {
      const next = new Map(prev)
      const cur = next.get(stateKey)
      if (!cur) return prev

      switch (event.type) {
        case 'text_delta':
          next.set(stateKey, { ...cur, content: cur.content + event.text })
          break
        case 'source':
          next.set(stateKey, { ...cur, sources: [...cur.sources, event.source] })
          break
        case 'searching':
          next.set(stateKey, { ...cur, searchQueries: [...cur.searchQueries, event.query] })
          break
        case 'done':
          next.set(stateKey, { ...cur, status: 'done', briefingId: event.briefingId, usage: event.usage })
          break
        case 'error':
          next.set(stateKey, { ...cur, status: 'error', error: event.error })
          break
      }
      return next
    })
  }

  // ── Generic SSE reader ────────────────────────────────────────────────────
  async function readStream(stateKey: string, res: Response) {
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6)) as BriefingStreamEvent
          handleStreamEvent(stateKey, event)
        } catch { /* skip malformed lines */ }
      }
    }
  }

  // ── Stream a single channel briefing ─────────────────────────────────────
  const streamBriefing = useCallback(async (channel: Channel) => {
    setBriefings((prev) =>
      new Map(prev).set(channel.id, {
        channelId: channel.id,
        channelName: channel.name,
        content: '',
        sources: [],
        searchQueries: [],
        status: 'streaming',
      })
    )
    try {
      const res = await fetch(`/api/briefings/${channel.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      })
      await readStream(channel.id, res)
    } catch (err) {
      setBriefings((prev) => {
        const next = new Map(prev)
        const cur = next.get(channel.id)
        if (cur) next.set(channel.id, { ...cur, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
        return next
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate all selected briefings in parallel ───────────────────────────
  async function generateBriefings() {
    if (selectedIds.size === 0 || isGenerating) return
    setIsGenerating(true)
    setBriefings(new Map())
    const selected = channels.filter((c) => selectedIds.has(c.id))
    await Promise.allSettled(selected.map(streamBriefing))
    setIsGenerating(false)
  }

  // ── Generate morning digest (single combined briefing) ────────────────────
  async function generateDigest() {
    if (selectedIds.size === 0 || isGenerating) return
    setIsGenerating(true)
    const selected = channels.filter((c) => selectedIds.has(c.id))
    setBriefings(new Map([
      ['digest', {
        channelId: 'digest',
        channelName: 'Morning Digest',
        content: '',
        sources: [],
        searchQueries: [],
        status: 'streaming',
      }]
    ]))
    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: selected }),
      })
      await readStream('digest', res)
    } catch (err) {
      setBriefings((prev) => {
        const next = new Map(prev)
        const cur = next.get('digest')
        if (cur) next.set('digest', { ...cur, status: 'error', error: err instanceof Error ? err.message : 'Failed' })
        return next
      })
    }
    setIsGenerating(false)
  }

  // ── Generate weekly summary ───────────────────────────────────────────────
  async function generateWeeklySummary() {
    if (isWeeklySummaryGenerating) return
    setIsWeeklySummaryGenerating(true)
    setBriefings((prev) =>
      new Map(prev).set('weekly-summary', {
        channelId: 'weekly-summary',
        channelName: 'Weekly Summary',
        content: '',
        sources: [],
        searchQueries: [],
        status: 'streaming',
      })
    )
    try {
      const res = await fetch('/api/weekly-summary', { method: 'POST' })
      await readStream('weekly-summary', res)
    } catch (err) {
      setBriefings((prev) => {
        const next = new Map(prev)
        const cur = next.get('weekly-summary')
        if (cur) next.set('weekly-summary', { ...cur, status: 'error', error: err instanceof Error ? err.message : 'Failed' })
        return next
      })
    }
    setIsWeeklySummaryGenerating(false)
  }

  // ── Generate cross-channel analysis ───────────────────────────────────────
  async function generateCrossChannel() {
    if (isCrossChannelGenerating) return
    setIsCrossChannelGenerating(true)
    setBriefings((prev) =>
      new Map(prev).set('cross-channel', {
        channelId: 'cross-channel',
        channelName: 'Cross-Channel Connections',
        content: '',
        sources: [],
        searchQueries: [],
        status: 'streaming',
      })
    )
    try {
      const res = await fetch('/api/cross-channel', { method: 'POST' })
      await readStream('cross-channel', res)
    } catch (err) {
      setBriefings((prev) => {
        const next = new Map(prev)
        const cur = next.get('cross-channel')
        if (cur) next.set('cross-channel', { ...cur, status: 'error', error: err instanceof Error ? err.message : 'Failed' })
        return next
      })
    }
    setIsCrossChannelGenerating(false)
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const allSelected = channels.length > 0 && selectedIds.size === channels.length
  const hasBriefings = briefings.size > 0
  const selectedCount = selectedIds.size
  const digestMode = settings.digest_mode
  const isSunday = new Date().getDay() === 0
  const sessionCost = Array.from(briefings.values())
    .reduce((sum, b) => sum + (b.usage?.costUsd ?? 0), 0)

  return (
    <div className="min-h-screen bg-warm-900 pb-32">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-warm-900/95 backdrop-blur-sm border-b border-warm-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center shadow shadow-brand-500/30">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-warm-100 tracking-tight">Pulse</h1>
          </div>
          <div className="flex items-center gap-3">
            {settings.highlights_enabled && (
              <Link
                href="/notes"
                className="p-1.5 rounded-lg text-warm-400 hover:text-warm-200 hover:bg-warm-800 transition-colors"
                aria-label="Saved notes"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                    d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </Link>
            )}
            {settings.digest_mode && (
              <Link
                href="/digest-history"
                className="p-1.5 rounded-lg text-warm-400 hover:text-warm-200 hover:bg-warm-800 transition-colors"
                aria-label="Digest history"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                    d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2 2 0 00-2-2h-2" />
                </svg>
              </Link>
            )}
            <Link
              href="/weekly-summary-history"
              className="p-1.5 rounded-lg text-warm-400 hover:text-warm-200 hover:bg-warm-800 transition-colors"
              aria-label="Weekly summary history"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                  d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </Link>
            <Link
              href="/settings"
              className="p-1.5 rounded-lg text-warm-400 hover:text-warm-200 hover:bg-warm-800 transition-colors"
              aria-label="Settings"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
            <Link
              href="/channels/new/config"
              className="text-sm text-brand-400 hover:text-brand-300 transition-colors font-medium"
            >
              + Channel
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5">
        {/* ── Empty state ── */}
        {channels.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-warm-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-warm-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-warm-300 mb-2">No channels yet</h2>
            <p className="text-warm-500 text-sm mb-6 max-w-xs mx-auto">
              Create an interest channel and Pulse will brief you daily using AI web search.
            </p>
            <Link
              href="/channels/new/config"
              className="inline-block bg-brand-600 hover:bg-brand-500 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            >
              Create your first channel
            </Link>
          </div>
        ) : (
          <>
            {/* ── Channel list header ── */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-warm-400">
                {selectedCount > 0
                  ? `${selectedCount} of ${channels.length} selected`
                  : digestMode ? 'Select channels for digest' : 'Select channels to brief'}
              </p>
              <button
                onClick={toggleAll}
                className="text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            {/* ── Sortable channel list ── */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              {/* Ungrouped channels */}
              <SortableContext
                items={channels.filter((c) => c.group_id == null).map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {channels.filter((c) => c.group_id == null).map((channel) => (
                    <ChannelCard
                      key={channel.id}
                      channel={channel}
                      isSelected={selectedIds.has(channel.id)}
                      onToggle={toggleChannel}
                      groupId={null}
                    />
                  ))}
                </div>
              </SortableContext>

              {/* Groups */}
              {groups.length > 0 && (
                <SortableContext
                  items={groups.map((g) => `group:${g.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {groups.map((group) => (
                    <GroupSection
                      key={group.id}
                      group={group}
                      channels={channels.filter((c) => c.group_id === group.id)}
                      selectedIds={selectedIds}
                      onToggle={toggleChannel}
                      onRename={handleRenameGroup}
                      onDelete={handleDeleteGroup}
                    />
                  ))}
                </SortableContext>
              )}
            </DndContext>

            {/* ── Create group ── */}
            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                placeholder="New group name…"
                className="flex-1 bg-warm-800/40 border border-warm-700/40 rounded-lg px-3 py-1.5 text-xs text-warm-300 placeholder-warm-600 focus:outline-none focus:border-warm-600 transition-colors"
              />
              <button
                onClick={createGroup}
                disabled={!newGroupName.trim() || isCreatingGroup}
                className="text-xs text-brand-400 hover:text-brand-300 disabled:text-warm-600 disabled:cursor-not-allowed px-2 py-1.5 transition-colors"
              >
                + Group
              </button>
            </div>
            {groupError && (
              <p className="text-xs text-red-400 mt-1">{groupError}</p>
            )}

            {/* ── Cross-channel analysis button ── */}
            {settings.cross_channel_enabled && (
              <div className="mt-4">
                <button
                  onClick={generateCrossChannel}
                  disabled={isCrossChannelGenerating}
                  className={[
                    'w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors',
                    isCrossChannelGenerating
                      ? 'border-warm-700 text-warm-500 cursor-not-allowed'
                      : 'border-warm-700 text-warm-400 hover:border-brand-500/50 hover:text-brand-400',
                  ].join(' ')}
                >
                  {isCrossChannelGenerating ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Analysing connections…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      Weekly Cross-Channel Analysis
                    </>
                  )}
                </button>
              </div>
            )}

            {/* ── Weekly Summary button ── */}
            <div className="mt-4">
              <button
                onClick={generateWeeklySummary}
                disabled={isWeeklySummaryGenerating}
                className={[
                  'w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors',
                  isWeeklySummaryGenerating
                    ? 'border-warm-700 text-warm-500 cursor-not-allowed'
                    : isSunday
                    ? 'border-violet-500/60 text-violet-300 hover:border-violet-400 hover:text-violet-200 bg-violet-900/10'
                    : 'border-warm-700 text-warm-400 hover:border-violet-500/50 hover:text-violet-400',
                ].join(' ')}
              >
                {isWeeklySummaryGenerating ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating weekly summary…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                    Weekly Summary{isSunday ? ' ✦' : ''}
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* ── Briefings ── */}
        {hasBriefings && (
          <section className="mt-8 space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-warm-400 uppercase tracking-widest">
                Briefings
              </h2>
              <div className="flex-1 h-px bg-warm-800" />
              {sessionCost > 0 && (
                <span className="text-xs text-warm-600" title="Session cost">
                  {formatCost(sessionCost)}
                </span>
              )}
            </div>
            {Array.from(briefings.values()).map((b) => (
              <BriefingCard
                key={b.channelId}
                briefing={b}
                highlightsEnabled={settings.highlights_enabled}
                sharingEnabled={settings.sharing_enabled}
                feedbackEnabled={settings.feedback_enabled}
                discussEnabled={settings.discuss_enabled}
                ttsEnabled={settings.tts_enabled}
                defaultVoice={settings.tts_voice}
                defaultSpeed={settings.tts_speed}
              />
            ))}
          </section>
        )}
      </main>

      {/* ── Fixed generate button ── */}
      {channels.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-10 bg-gradient-to-t from-warm-900 via-warm-900/90 to-transparent pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <button
              onClick={digestMode ? generateDigest : generateBriefings}
              disabled={selectedCount === 0 || isGenerating}
              className={[
                'w-full font-semibold py-4 rounded-2xl text-base transition-all duration-200',
                'flex items-center justify-center gap-2',
                selectedCount === 0 || isGenerating
                  ? 'bg-warm-700/60 text-warm-500 cursor-not-allowed'
                  : 'bg-brand-600 hover:bg-brand-500 active:scale-[0.98] text-white shadow-lg shadow-brand-600/25',
              ].join(' ')}
            >
              {isGenerating ? (
                <>
                  <svg className="w-5 h-5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {digestMode ? 'Generating digest…' : `Generating ${selectedCount} briefing${selectedCount !== 1 ? 's' : ''}…`}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {selectedCount === 0
                    ? 'Select channels above'
                    : digestMode
                    ? `Generate Morning Digest (${selectedCount} channel${selectedCount !== 1 ? 's' : ''})`
                    : `Generate ${selectedCount} Briefing${selectedCount !== 1 ? 's' : ''}`}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
