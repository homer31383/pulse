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
import type { Channel, ChannelGroup, BriefingState, BriefingStreamEvent, AppSettings, Profile } from '@/lib/types'

interface HomeClientProps {
  channels: Channel[]
  settings: AppSettings
  groups: ChannelGroup[]
  profiles: Profile[]
  currentProfileId: string
}

export function HomeClient({ channels: initialChannels, settings, groups: initialGroups, profiles, currentProfileId }: HomeClientProps) {
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
    // Open sheets immediately for all selected channels
    setOpenSheets(selected.map((c) => c.id))
    await Promise.allSettled(selected.map(streamBriefing))
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
    <div className="min-h-screen bg-cream-200 pb-32">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="#7c6fcd" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="17" x2="20" y2="17"/>
              <g transform="rotate(-45, 5, 17)">
                <polyline points="5,17 10,17 11,10 12,20 14,17 20,17"/>
              </g>
            </svg>
            <h1 className="font-display text-xl font-normal text-ink-300 tracking-wide">Pulse</h1>
          </div>

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
                <div className="absolute left-0 top-full mt-1.5 w-44 bg-cream-50 rounded-2xl shadow-xl border border-cream-300/60 p-2 z-50">
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
              <div className="absolute right-0 top-full mt-2 w-56 bg-cream-50 rounded-2xl shadow-xl border border-cream-300/60 p-2 z-50">
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
                {digestModeActive && (
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
                )}
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

      <main className="max-w-screen-xl mx-auto px-4 pt-6">
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
              <div className="inline-flex items-center bg-cream-100 border border-cream-300/60 rounded-full p-0.5">
                <button
                  onClick={() => setDigestModeActive(false)}
                  className={[
                    'px-3.5 py-1 rounded-full text-xs font-sans font-medium transition-all duration-150',
                    !digestModeActive
                      ? 'bg-cream-300 text-ink-300 shadow-sm'
                      : 'text-ink-100 hover:text-ink-200',
                  ].join(' ')}
                >
                  Briefings
                </button>
                <button
                  onClick={() => setDigestModeActive(true)}
                  className={[
                    'px-3.5 py-1 rounded-full text-xs font-sans font-medium transition-all duration-150',
                    digestModeActive
                      ? 'bg-cream-300 text-ink-300 shadow-sm'
                      : 'text-ink-100 hover:text-ink-200',
                  ].join(' ')}
                >
                  Digest
                </button>
              </div>
            </div>

            {/* ── Selection bar ── */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-sans text-ink-50">
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

      {/* ── Briefing sheets overlay ── */}
      {openSheets.map((id, i) => {
        const depthFromTop = openSheets.length - 1 - i
        const briefing = briefings.get(id)
        if (!briefing) return null
        return (
          <BriefingSheet
            key={id}
            briefing={briefing}
            depthFromTop={depthFromTop}
            onClose={() => setOpenSheets((prev) => prev.filter((s) => s !== id))}
            highlightsEnabled={settings.highlights_enabled}
            sharingEnabled={settings.sharing_enabled}
            feedbackEnabled={settings.feedback_enabled}
            discussEnabled={settings.discuss_enabled}
            ttsEnabled={settings.tts_enabled}
            defaultVoice={settings.tts_voice}
            defaultSpeed={settings.tts_speed}
          />
        )
      })}

      {/* ── Fixed generate bar ── */}
      {channels.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-cream-200/95 backdrop-blur-sm border-t border-cream-300/60 px-4 py-3">
          <div className="max-w-screen-xl mx-auto flex items-center gap-3">
            <button
              onClick={digestModeActive ? generateDigest : generateBriefings}
              disabled={selectedCount === 0 || isGenerating}
              className={[
                'flex-1 font-semibold py-3 rounded-2xl text-sm transition-all duration-200',
                'flex items-center justify-center gap-2',
                selectedCount === 0 || isGenerating
                  ? 'bg-cream-300 text-ink-50 cursor-not-allowed'
                  : 'bg-brand-500 hover:bg-brand-600 active:scale-[0.98] text-white shadow-lg shadow-brand-500/25',
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
