'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { ChannelCard } from './ChannelCard'
import { BriefingSheet } from './BriefingSheet'
import { GroupSection } from './GroupSection'
import { Masthead } from './press/Masthead'
import { TickerBar } from './press/TickerBar'
import { PressNav } from './press/PressNav'
import type { Channel, ChannelGroup, BriefingState, BriefingStreamEvent, AppSettings, Profile, Briefing, Digest } from '@/lib/types'

interface HomeClientProps {
  channels: Channel[]
  settings: AppSettings
  groups: ChannelGroup[]
  profiles: Profile[]
  currentProfileId: string
  scheduledBriefings?: Briefing[]
  scheduledDigest?: Digest | null
}

export function HomeClient({ channels: initialChannels, settings, groups: initialGroups, profiles, currentProfileId, scheduledBriefings = [], scheduledDigest = null }: HomeClientProps) {
  const router = useRouter()
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
  const [openSheets, setOpenSheets] = useState<string[]>([])
  const [activeSheetId, setActiveSheetId] = useState<string>('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [digestModeActive, setDigestModeActive] = useState(settings.digest_mode)
  const [profileOpen, setProfileOpen] = useState(false)
  const [addProfileName, setAddProfileName] = useState('')
  const [isAddingProfile, setIsAddingProfile] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  // Set cookie + localStorage on mount so API routes always have a profile_id
  useEffect(() => {
    document.cookie = `profile_id=${currentProfileId}; path=/; max-age=31536000; SameSite=Lax`
    localStorage.setItem('pulse_profile_id', currentProfileId)
  }, [currentProfileId])

  // ── Pre-generated scheduled content banner ───────────────────────────────
  // Read-state driven (migration 017): the banner is prominent while the
  // batch has unread items, muted once everything is read, and derives
  // entirely from briefings/digests.read_at — consistent across devices.
  // localReadIds is an optimistic overlay so the banner flips without a
  // server round-trip.
  const readyBatchKey = [
    ...scheduledBriefings.map((b) => b.created_at),
    ...(scheduledDigest ? [scheduledDigest.created_at] : []),
  ].sort().pop() ?? null
  const readyCount = scheduledBriefings.length + (scheduledDigest ? 1 : 0)
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())

  const isUnread = (item: { id: string; read_at?: string | null }) =>
    !item.read_at && !localReadIds.has(item.id)
  const unreadBriefingCount = scheduledBriefings.filter(isUnread).length
  const digestUnread = scheduledDigest ? isUnread(scheduledDigest) : false
  const unreadCount = unreadBriefingCount + (digestUnread ? 1 : 0)

  function markBatchRead() {
    const briefingIds = scheduledBriefings.filter(isUnread).map((b) => b.id)
    const digestIds = scheduledDigest && digestUnread ? [scheduledDigest.id] : []
    if (briefingIds.length === 0 && digestIds.length === 0) return
    setLocalReadIds((prev) => new Set([...prev, ...briefingIds, ...digestIds]))
    fetch('/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefingIds, digestIds }),
    }).catch(() => {})
  }

  function openScheduled() {
    const map = new Map<string, BriefingState>()
    for (const b of scheduledBriefings) {
      const name = channels.find((c) => c.id === b.channel_id)?.name ?? 'Briefing'
      map.set(b.channel_id, {
        channelId: b.channel_id,
        channelName: name,
        content: b.content,
        sources: b.sources ?? [],
        searchQueries: [],
        status: 'done',
        briefingId: b.id,
      })
    }
    if (scheduledDigest) {
      map.set('digest', {
        channelId: 'digest',
        channelName: 'Morning Digest',
        content: scheduledDigest.content,
        sources: scheduledDigest.sources ?? [],
        searchQueries: [],
        status: 'done',
        briefingId: scheduledDigest.id,
      })
    }
    if (map.size === 0) return
    setBriefings(map)
    const ids = [...map.keys()]
    setOpenSheets(ids)
    setActiveSheetId(ids[0])
    markBatchRead()
  }

  // Keep activeSheetId pointing to a valid open sheet
  useEffect(() => {
    setActiveSheetId((cur) => {
      if (openSheets.length === 0) return ''
      if (openSheets.includes(cur)) return cur
      return openSheets[0]
    })
  }, [openSheets])

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
        setIsAddingProfile(false)
        setAddProfileName('')
      }
    }
    if (menuOpen || profileOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [menuOpen, profileOpen])

  function switchProfile(id: string) {
    document.cookie = `profile_id=${id}; path=/; max-age=31536000; SameSite=Lax`
    localStorage.setItem('pulse_profile_id', id)
    setProfileOpen(false)
    setIsAddingProfile(false)
    setAddProfileName('')
    window.location.reload()
  }

  async function confirmAddProfile() {
    const name = addProfileName.trim()
    if (!name) return
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        const newProfile = await res.json() as Profile
        switchProfile(newProfile.id)
      }
    } catch { /* silently fail */ }
  }

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

    if (activeGroupId !== overGroupId) return

    setChannels((prev) => {
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

  // ── Stream event handler ──────────────────────────────────────────────────
  function handleStreamEvent(stateKey: string, event: BriefingStreamEvent) {
    setBriefings((prev) => {
      const next = new Map(prev)
      const cur = next.get(stateKey)
      if (!cur) return prev

      switch (event.type) {
        case 'text_delta':
          // Clear rateLimitedUntil on first text delta after a retry
          next.set(stateKey, { ...cur, content: cur.content + event.text, rateLimitedUntil: undefined })
          break
        case 'source':
          next.set(stateKey, { ...cur, sources: [...cur.sources, event.source] })
          break
        case 'searching':
          next.set(stateKey, { ...cur, searchQueries: [...cur.searchQueries, event.query] })
          break
        case 'rate_limited':
          // Reset accumulated content/sources for the retry, show countdown
          next.set(stateKey, {
            ...cur,
            content: '',
            sources: [],
            searchQueries: [],
            rateLimitedUntil: Date.now() + event.retryIn * 1000,
          })
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

  // ── Generate all selected briefings, staggered 15 s apart ───────────────
  async function generateBriefings() {
    if (selectedIds.size === 0 || isGenerating) return
    setIsGenerating(true)

    const selected = channels.filter((c) => selectedIds.has(c.id))
    const now = Date.now()
    const STAGGER_MS = 15_000

    // Pre-populate the briefings map so all sheets open immediately
    const initialBriefings = new Map<string, BriefingState>()
    selected.forEach((channel, i) => {
      initialBriefings.set(channel.id, {
        channelId: channel.id,
        channelName: channel.name,
        content: '',
        sources: [],
        searchQueries: [],
        status: i === 0 ? 'streaming' : 'queued',
        queuedStartTime: i === 0 ? undefined : now + i * STAGGER_MS,
      })
    })
    setBriefings(initialBriefings)
    setOpenSheets(selected.map((c) => c.id))
    setActiveSheetId(selected[0].id)

    // Stagger each channel start by STAGGER_MS * index
    await Promise.allSettled(
      selected.map(
        (channel, i) =>
          new Promise<void>((resolve) => {
            setTimeout(async () => {
              await streamBriefing(channel)
              resolve()
            }, i * STAGGER_MS)
          }),
      ),
    )
    setIsGenerating(false)
  }

  // ── Generate morning digest ───────────────────────────────────────────────
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
    setOpenSheets(['digest'])
    setActiveSheetId('digest')
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
    setMenuOpen(false)
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
    setOpenSheets((prev) => [...prev.filter((s) => s !== 'weekly-summary'), 'weekly-summary'])
    setActiveSheetId('weekly-summary')
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
    setMenuOpen(false)
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
    setOpenSheets((prev) => [...prev.filter((s) => s !== 'cross-channel'), 'cross-channel'])
    setActiveSheetId('cross-channel')
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
  const selectedCount = selectedIds.size
  const isSunday = new Date().getDay() === 0
  const ungrouped = channels.filter((c) => c.group_id == null)
  const ungroupedIds = ungrouped.map((c) => c.id)

  return (
    <div className="min-h-screen paper-page pb-32">
      {/* ── Utility strip (profile + menu) ── */}
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-1.5">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {/* Profile selector */}
          {profiles.length > 0 && (
            <div ref={profileRef} className="relative flex-1">
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-sans text-ink-100 hover:text-ink-300 hover:bg-cream-300 transition-colors"
              >
                <span className="font-medium text-ink-200">
                  {profiles.find((p) => p.id === currentProfileId)?.name ?? 'Profile'}
                </span>
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {profileOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-44 bg-[#FAF8FC] rounded-2xl shadow-xl border-[0.5px] border-press-hair p-2 z-50">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => switchProfile(p.id)}
                      className={[
                        'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors text-left',
                        p.id === currentProfileId
                          ? 'bg-cream-300 text-ink-300 font-medium'
                          : 'text-ink-200 hover:bg-cream-200',
                      ].join(' ')}
                    >
                      {p.id === currentProfileId ? (
                        <svg className="w-3 h-3 flex-shrink-0 text-brand-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <span className="w-3 flex-shrink-0" />
                      )}
                      {p.name}
                    </button>
                  ))}

                  <div className="h-px bg-cream-300/60 my-1.5 mx-2" />

                  {isAddingProfile ? (
                    <div className="px-2 py-1.5">
                      <input
                        autoFocus
                        value={addProfileName}
                        onChange={(e) => setAddProfileName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmAddProfile()
                          if (e.key === 'Escape') { setIsAddingProfile(false); setAddProfileName('') }
                        }}
                        placeholder="Profile name…"
                        className="w-full bg-cream-100 border border-cream-300 rounded-lg px-2.5 py-1 text-xs font-sans text-ink-200 placeholder-ink-50 focus:outline-none focus:border-cream-400"
                      />
                      <div className="flex gap-1.5 mt-1.5">
                        <button
                          onClick={confirmAddProfile}
                          className="flex-1 text-xs font-medium text-brand-600 hover:text-brand-500 py-1 transition-colors"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => { setIsAddingProfile(false); setAddProfileName('') }}
                          className="flex-1 text-xs text-ink-100 hover:text-ink-200 py-1 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsAddingProfile(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-ink-100 hover:bg-cream-200 hover:text-ink-200 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add profile
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Hamburger menu */}
          <div ref={menuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-2 text-ink-100 hover:text-ink-300 hover:bg-cream-300 rounded-lg transition-colors"
              aria-label="Menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                  d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Dropdown panel */}
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-[#FAF8FC] rounded-2xl shadow-xl border-[0.5px] border-press-hair p-2 z-50">
                {/* Weekly Summary */}
                <button
                  onClick={generateWeeklySummary}
                  disabled={isWeeklySummaryGenerating}
                  className={[
                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors',
                    isWeeklySummaryGenerating
                      ? 'text-ink-50 cursor-not-allowed'
                      : isSunday
                      ? 'text-violet-600 hover:bg-violet-50'
                      : 'text-ink-200 hover:bg-cream-200',
                  ].join(' ')}
                >
                  {isWeeklySummaryGenerating ? (
                    <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                  )}
                  Weekly Summary{isSunday ? ' ✦' : ''}
                </button>

                {/* Cross-channel analysis (if enabled) */}
                {settings.cross_channel_enabled && (
                  <button
                    onClick={generateCrossChannel}
                    disabled={isCrossChannelGenerating}
                    className={[
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors',
                      isCrossChannelGenerating
                        ? 'text-ink-50 cursor-not-allowed'
                        : 'text-ink-200 hover:bg-cream-200',
                    ].join(' ')}
                  >
                    {isCrossChannelGenerating ? (
                      <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    )}
                    Cross-Channel Analysis
                  </button>
                )}

                <div className="h-px bg-cream-300/60 my-1.5 mx-2" />

                {/* Nav links */}
                {settings.highlights_enabled && (
                  <Link
                    href="/notes"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-200 hover:bg-cream-200 transition-colors"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    Notes
                  </Link>
                )}
                <Link
                  href="/pinned"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-200 hover:bg-cream-200 transition-colors"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Pinned
                </Link>
                <Link
                  href="/briefing-history"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-200 hover:bg-cream-200 transition-colors"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Briefing History
                </Link>
                <Link
                  href="/digest-history"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-200 hover:bg-cream-200 transition-colors"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2 2 0 00-2-2h-2" />
                  </svg>
                  Digest History
                </Link>
                <Link
                  href="/weekly-summary-history"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-200 hover:bg-cream-200 transition-colors"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Summary History
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-ink-200 hover:bg-cream-200 transition-colors"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Masthead + ticker ── */}
      <Masthead />
      <TickerBar items={settings.ticker_items ?? []} />

      <main className="max-w-screen-xl mx-auto px-4 pt-6">
        {/* ── Scheduled briefing banner — prominent while unread, muted once read ── */}
        {readyCount > 0 && (
          <div className={`mb-5 border-y-[0.5px] border-press-hair px-4 py-3.5 flex items-center gap-3 ${unreadCount > 0 ? 'bg-press-accent/[0.04]' : 'opacity-80'}`}>
            <div className="flex-shrink-0 w-9 h-9 rounded-full border-[0.5px] border-press-hair bg-white/40 flex items-center justify-center">
              {unreadCount === 0 ? (
                <svg className="w-5 h-5 text-press-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-press-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-georgia text-[15px] ${unreadCount > 0 ? 'text-press-ink' : 'text-press-body'}`}>
                {unreadCount > 0 ? 'Your morning briefing is ready' : 'Your morning briefing'}
              </p>
              <p className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted mt-0.5">
                {unreadCount === 0
                  ? 'All read'
                  : [
                      unreadBriefingCount > 0 && `${unreadBriefingCount} unread briefing${unreadBriefingCount !== 1 ? 's' : ''}`,
                      digestUnread && 'a digest',
                    ].filter(Boolean).join(' and ')}
                {readyBatchKey && ` · ${new Date(readyBatchKey).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              </p>
            </div>
            <button
              onClick={openScheduled}
              className={`flex-shrink-0 font-chrome text-[10px] uppercase tracking-[1.5px] font-semibold px-4 py-2 rounded-xl transition-colors ${
                unreadCount === 0
                  ? 'border-[0.5px] border-press-hair text-press-body hover:bg-white/40'
                  : 'bg-press-accent hover:bg-press-accent/90 text-white'
              }`}
            >
              {unreadCount === 0 ? 'Reopen' : 'Read now'}
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
        {channels.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-cream-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="font-display text-2xl font-normal text-ink-200 mb-2">No channels yet</h2>
            <p className="font-sans text-ink-50 text-sm mb-6 max-w-xs mx-auto">
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
            {/* ── Mode toggle ── */}
            <div className="flex justify-center mb-5 mt-1">
              <div className="inline-flex items-center border-[0.5px] border-press-hair rounded-full p-0.5 bg-white/30">
                <button
                  onClick={() => setDigestModeActive(false)}
                  className={[
                    'px-3.5 py-1 rounded-full font-chrome text-[10px] uppercase tracking-[1.5px] transition-all duration-150',
                    !digestModeActive
                      ? 'bg-press-accent/10 text-press-accent'
                      : 'text-press-muted hover:text-press-accent',
                  ].join(' ')}
                >
                  Briefings
                </button>
                <button
                  onClick={() => setDigestModeActive(true)}
                  className={[
                    'px-3.5 py-1 rounded-full font-chrome text-[10px] uppercase tracking-[1.5px] transition-all duration-150',
                    digestModeActive
                      ? 'bg-press-accent/10 text-press-accent'
                      : 'text-press-muted hover:text-press-accent',
                  ].join(' ')}
                >
                  Digest
                </button>
              </div>
            </div>

            {/* ── Selection bar ── */}
            <div className="flex items-center justify-between mb-4">
              <p className="font-chrome text-[10px] uppercase tracking-[1.5px] text-press-muted">
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : digestModeActive ? 'Select channels for digest' : 'Select channels to brief'}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleAll}
                  className="text-xs font-medium text-brand-600 hover:text-brand-500 transition-colors"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
                <Link
                  href="/channels/new/config"
                  className="text-xs font-medium text-ink-50 hover:text-ink-200 transition-colors"
                >
                  + Channel
                </Link>
              </div>
            </div>

            {/* ── Sortable channel grid ── */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              {/* Ungrouped channels */}
              {ungrouped.length > 0 && (
                <SortableContext items={ungroupedIds} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                    {ungrouped.map((channel) => (
                      <ChannelCard
                        key={channel.id}
                        channel={channel}
                        isSelected={selectedIds.has(channel.id)}
                        onToggle={toggleChannel}
                        groupId={null}
                        hasBriefing={briefings.has(channel.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}

              {/* Groups */}
              {groups.length > 0 && (
                <SortableContext
                  items={groups.map((g) => `group:${g.id}`)}
                  strategy={rectSortingStrategy}
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
                      briefings={briefings}
                    />
                  ))}
                </SortableContext>
              )}
            </DndContext>

            {/* ── Create group ── */}
            <div className="mt-6 flex items-center gap-2">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                placeholder="New group name…"
                className="flex-1 bg-cream-100 border border-cream-300 rounded-lg px-3 py-1.5 text-xs font-sans text-ink-200 placeholder-ink-50 focus:outline-none focus:border-cream-400 transition-colors"
              />
              <button
                onClick={createGroup}
                disabled={!newGroupName.trim() || isCreatingGroup}
                className="text-xs text-brand-600 hover:text-brand-500 disabled:text-ink-50 disabled:cursor-not-allowed px-2 py-1.5 transition-colors"
              >
                + Group
              </button>
            </div>
            {groupError && (
              <p className="text-xs text-red-600 mt-1">{groupError}</p>
            )}
          </>
        )}
      </main>

      <PressNav />

      {/* ── Briefing sheet overlay (tab bar navigation) ── */}
      {openSheets.length > 0 && (
        <BriefingSheet
          openIds={openSheets}
          briefings={briefings}
          activeId={activeSheetId}
          onTabClick={setActiveSheetId}
          onClose={() => setOpenSheets([])}
          highlightsEnabled={settings.highlights_enabled}
          sharingEnabled={settings.sharing_enabled}
          feedbackEnabled={settings.feedback_enabled}
          discussEnabled={settings.discuss_enabled}
          ttsEnabled={settings.tts_enabled}
          defaultVoice={settings.tts_voice}
          defaultSpeed={settings.tts_speed}
        />
      )}

      {/* ── Fixed generate bar ── */}
      {channels.length > 0 && (
        <div
          className="fixed bottom-0 inset-x-0 bg-[#F0ECF4]/95 backdrop-blur-sm border-t-[0.5px] border-press-hair px-4 pt-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="max-w-screen-xl mx-auto flex items-center gap-3">
            <button
              onClick={digestModeActive ? generateDigest : generateBriefings}
              disabled={selectedCount === 0 || isGenerating}
              className={[
                'flex-1 font-chrome font-semibold py-3 rounded-2xl text-sm transition-all duration-200',
                'flex items-center justify-center gap-2',
                selectedCount === 0 || isGenerating
                  ? 'bg-[#DED8E6] text-press-faint cursor-not-allowed'
                  : 'bg-press-accent hover:bg-press-accent/90 active:scale-[0.98] text-white shadow-lg shadow-press-accent/25',
              ].join(' ')}
            >
              {isGenerating ? (
                <>
                  <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {digestModeActive ? 'Generating digest…' : `Generating ${selectedCount} briefing${selectedCount !== 1 ? 's' : ''}…`}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {selectedCount === 0
                    ? 'Select channels above'
                    : digestModeActive
                    ? `Generate Morning Digest (${selectedCount})`
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
