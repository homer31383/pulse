'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { formatCost } from '@/lib/cost'
import type { AppSettings, BriefingDensity } from '@/lib/types'
import type { UsageData } from '@/app/api/usage/route'

const TTS_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

interface Props {
  initialSettings: AppSettings
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const MODELS = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    badge: 'Default',
    description: 'Fast and cost-efficient. Great for daily briefings.',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    badge: 'Most capable',
    description: 'Deeper analysis and richer insights. Slower and more expensive.',
  },
] as const

const DENSITIES: { id: BriefingDensity; label: string; description: string }[] = [
  {
    id: 'dense',
    label: 'Dense',
    description: 'All significant data points, statistics, and technical detail. Best for fast-moving fields.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Key developments with enough context to understand their significance.',
  },
  {
    id: 'narrative',
    label: 'Narrative',
    description: 'Flowing prose focused on the 3–5 most impactful stories. Easiest to read.',
  },
]

// ── Reusable toggle row ───────────────────────────────────────────────────────
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="flex-1">
        <p className="text-sm text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'flex-shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors duration-200 relative',
          checked ? 'bg-indigo-600' : 'bg-slate-700',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
            checked ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

export function SettingsClient({ initialSettings }: Props) {
  // ── Model & density ──────────────────────────────────────────────────────
  const [model, setModel] = useState(initialSettings.model)
  const [density, setDensity] = useState<BriefingDensity>(initialSettings.briefing_density)

  // ── History retention ────────────────────────────────────────────────────
  const [retentionDays, setRetentionDays] = useState<number | null>(
    initialSettings.briefing_retention_days ?? null
  )

  // ── Feature flags ────────────────────────────────────────────────────────
  const [digestMode, setDigestMode] = useState(initialSettings.digest_mode)
  const [highlightsEnabled, setHighlightsEnabled] = useState(initialSettings.highlights_enabled)
  const [sharingEnabled, setSharingEnabled] = useState(initialSettings.sharing_enabled)
  const [feedbackEnabled, setFeedbackEnabled] = useState(initialSettings.feedback_enabled)
  const [discussEnabled, setDiscussEnabled] = useState(initialSettings.discuss_enabled)
  const [crossChannelEnabled, setCrossChannelEnabled] = useState(initialSettings.cross_channel_enabled)
  const [watchlistEnabled, setWatchlistEnabled] = useState(initialSettings.watchlist_enabled)
  const [watchlistTerms, setWatchlistTerms] = useState<string[]>(initialSettings.watchlist_terms ?? [])
  const [newTerm, setNewTerm] = useState('')
  const [emailEnabled, setEmailEnabled] = useState(initialSettings.email_enabled)
  const [emailAddress, setEmailAddress] = useState(initialSettings.email_address ?? '')
  const [notificationsEnabled, setNotificationsEnabled] = useState(initialSettings.notifications_enabled)
  const [notificationTime, setNotificationTime] = useState(initialSettings.notification_time ?? '08:00')

  // ── TTS ───────────────────────────────────────────────────────────────────
  const [ttsEnabled, setTtsEnabled] = useState(initialSettings.tts_enabled)
  const [ttsVoice, setTtsVoice] = useState<string | null>(initialSettings.tts_voice)
  const [ttsSpeed, setTtsSpeed] = useState<number>(initialSettings.tts_speed ?? 1)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    function loadVoices() {
      const v = window.speechSynthesis.getVoices()
      if (v.length > 0) setVoices(v)
    }
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
  }, [])

  // ── Usage data ───────────────────────────────────────────────────────────
  const [usage, setUsage] = useState<UsageData | null>(null)

  useEffect(() => {
    fetch('/api/usage')
      .then((r) => r.json())
      .then((data: UsageData) => setUsage(data))
      .catch(() => {})
  }, [])

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Save helper ──────────────────────────────────────────────────────────
  async function save(updates: Partial<AppSettings>) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveState('saving')
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveState('saved')
      saveTimer.current = setTimeout(() => setSaveState('idle'), 1800)
    } catch {
      setSaveState('error')
      saveTimer.current = setTimeout(() => setSaveState('idle'), 3000)
    }
  }

  // ── Model & density handlers ─────────────────────────────────────────────
  function selectModel(id: string) { setModel(id); save({ model: id }) }
  function selectDensity(id: BriefingDensity) { setDensity(id); save({ briefing_density: id }) }

  // ── Watchlist helpers ────────────────────────────────────────────────────
  function addTerm() {
    const term = newTerm.trim()
    if (!term || watchlistTerms.includes(term)) return
    const updated = [...watchlistTerms, term]
    setWatchlistTerms(updated)
    setNewTerm('')
    save({ watchlist_terms: updated })
  }

  function removeTerm(index: number) {
    const updated = watchlistTerms.filter((_, i) => i !== index)
    setWatchlistTerms(updated)
    save({ watchlist_terms: updated })
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-10">
      {/* Save indicator */}
      <div className={`text-right text-xs transition-opacity duration-300 ${saveState !== 'idle' ? 'opacity-100' : 'opacity-0'}`}>
        <span className={saveState === 'saved' ? 'text-emerald-400' : saveState === 'error' ? 'text-red-400' : 'text-slate-500'}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? '✗ Save failed' : '✓ Saved'}
        </span>
      </div>

      {/* ── Usage ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Usage &amp; cost</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Estimated costs based on Anthropic API pricing.
          </p>
        </div>

        {usage ? (
          <>
            {/* Time-period totals */}
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Today',     value: usage.totals.today    },
                { label: 'This week', value: usage.totals.week     },
                { label: 'Month',     value: usage.totals.month    },
                { label: 'Year',      value: usage.totals.year     },
                { label: 'All time',  value: usage.totals.allTime  },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-3 text-center"
                >
                  <p className="text-xs text-slate-500 mb-1 truncate">{label}</p>
                  <p className="text-sm font-semibold text-slate-100 tabular-nums">
                    {formatCost(value)}
                  </p>
                </div>
              ))}
            </div>

            {/* Daily bar chart — last 30 days */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-medium text-slate-400">Daily spend — last 30 days</p>
              {usage.daily.every((d) => d.cost === 0) ? (
                <p className="text-xs text-slate-600 py-4 text-center">No usage in the last 30 days.</p>
              ) : (
                <>
                  <div className="flex items-end gap-px h-14">
                    {(() => {
                      const maxCost = Math.max(...usage.daily.map((d) => d.cost), 0.0001)
                      return usage.daily.map(({ date, cost }) => (
                        <div
                          key={date}
                          className="flex-1 flex flex-col justify-end"
                          title={`${date}: ${formatCost(cost)}`}
                        >
                          <div
                            className="rounded-sm bg-indigo-600/70 hover:bg-indigo-500/80 transition-colors min-h-px"
                            style={{ height: `${Math.max((cost / maxCost) * 100, cost > 0 ? 4 : 0).toFixed(1)}%` }}
                          />
                        </div>
                      ))
                    })()}
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>{usage.daily[0]?.date.slice(5)}</span>
                    <span>{usage.daily[usage.daily.length - 1]?.date.slice(5)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Per-channel breakdown */}
            {usage.byChannel.length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl divide-y divide-slate-700/40">
                <p className="px-4 py-2.5 text-xs font-medium text-slate-400">By channel</p>
                {usage.byChannel.map(({ channelName, cost, calls }) => (
                  <div key={channelName} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-sm text-slate-300">{channelName}</p>
                      <p className="text-xs text-slate-600">{calls} call{calls !== 1 ? 's' : ''}</p>
                    </div>
                    <span className="text-sm font-medium text-slate-300 tabular-nums">
                      {formatCost(cost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-8 text-center">
            <p className="text-xs text-slate-600">Loading usage data…</p>
          </div>
        )}
      </section>

      {/* ── Model ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Model</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Used for all briefing generation. Takes effect on the next briefing.
          </p>
        </div>
        <div className="space-y-2">
          {MODELS.map((m) => {
            const selected = model === m.id
            return (
              <button
                key={m.id}
                onClick={() => selectModel(m.id)}
                className={[
                  'w-full text-left p-4 rounded-2xl border transition-all duration-150',
                  selected
                    ? 'bg-indigo-950/60 border-indigo-500/60 shadow-sm shadow-indigo-500/10'
                    : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600',
                ].join(' ')}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={[
                    'flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all',
                    selected ? 'border-indigo-400 bg-indigo-400' : 'border-slate-600',
                  ].join(' ')}>
                    {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="font-medium text-sm text-slate-100">{m.label}</span>
                  <span className={[
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    selected ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-700 text-slate-400',
                  ].join(' ')}>
                    {m.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-400 pl-6">{m.description}</p>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Briefing depth ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Briefing depth</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Controls how detailed and long briefings are. Applies across all channels.
          </p>
        </div>
        <div className="space-y-2">
          {DENSITIES.map((d) => {
            const selected = density === d.id
            return (
              <button
                key={d.id}
                onClick={() => selectDensity(d.id)}
                className={[
                  'w-full text-left p-4 rounded-2xl border transition-all duration-150',
                  selected
                    ? 'bg-indigo-950/60 border-indigo-500/60 shadow-sm shadow-indigo-500/10'
                    : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600',
                ].join(' ')}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={[
                    'flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all',
                    selected ? 'border-indigo-400 bg-indigo-400' : 'border-slate-600',
                  ].join(' ')}>
                    {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="font-medium text-sm text-slate-100">{d.label}</span>
                </div>
                <p className="text-xs text-slate-400 pl-6">{d.description}</p>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Briefing format ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Briefing format</h2>
          <p className="text-xs text-slate-500 mt-0.5">Change how briefings are generated and presented.</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl px-4 divide-y divide-slate-700/40">
          <ToggleRow
            label="Daily digest mode"
            description="Combine all selected channels into a single morning read instead of individual briefings."
            checked={digestMode}
            onChange={(v) => { setDigestMode(v); save({ digest_mode: v }) }}
          />
        </div>
      </section>

      {/* ── History ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">History</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Automatically delete briefings older than a set age when the app loads.
          </p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-200">Auto-delete old briefings</p>
              <p className="text-xs text-slate-500 mt-0.5">Keeps storage tidy. Deletions happen on home page load.</p>
            </div>
            <select
              value={retentionDays ?? ''}
              onChange={(e) => {
                const val = e.target.value === '' ? null : Number(e.target.value)
                setRetentionDays(val)
                save({ briefing_retention_days: val })
              }}
              className="flex-shrink-0 bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/60 cursor-pointer"
            >
              <option value="">Off</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </select>
          </div>
        </div>
        {digestMode && (
          <Link
            href="/digest-history"
            className="flex items-center justify-between w-full px-4 py-3 bg-slate-800/30 border border-slate-700/40 rounded-xl hover:border-slate-600 transition-colors"
          >
            <span className="text-sm text-slate-300">View digest history</span>
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
        <Link
          href="/weekly-summary-history"
          className="flex items-center justify-between w-full px-4 py-3 bg-slate-800/30 border border-slate-700/40 rounded-xl hover:border-slate-600 transition-colors"
        >
          <span className="text-sm text-slate-300">View weekly summary history</span>
          <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </section>

      {/* ── Content tools ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Content tools</h2>
          <p className="text-xs text-slate-500 mt-0.5">Interactive features that appear on briefings.</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl px-4 divide-y divide-slate-700/40">
          <ToggleRow
            label="Highlight &amp; save"
            description="Select any text in a briefing to clip it to your personal notes."
            checked={highlightsEnabled}
            onChange={(v) => { setHighlightsEnabled(v); save({ highlights_enabled: v }) }}
          />
          <ToggleRow
            label="Briefing sharing"
            description='Shows a "Share" button on briefings. Generates a link on demand — never automatic.'
            checked={sharingEnabled}
            onChange={(v) => { setSharingEnabled(v); save({ sharing_enabled: v }) }}
          />
          <ToggleRow
            label="Feedback loop"
            description="Thumbs up / down on each briefing to log what's useful. Helps refine instructions over time."
            checked={feedbackEnabled}
            onChange={(v) => { setFeedbackEnabled(v); save({ feedback_enabled: v }) }}
          />
          <ToggleRow
            label="Discuss mode"
            description='Adds an "Ask Claude" button to each briefing so you can ask questions and go deeper on any topic.'
            checked={discussEnabled}
            onChange={(v) => { setDiscussEnabled(v); save({ discuss_enabled: v }) }}
          />
        </div>
        {highlightsEnabled && (
          <Link
            href="/notes"
            className="flex items-center justify-between w-full px-4 py-3 bg-slate-800/30 border border-slate-700/40 rounded-xl hover:border-slate-600 transition-colors"
          >
            <span className="text-sm text-slate-300">View saved notes</span>
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </section>

      {/* ── Intelligence ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Intelligence</h2>
          <p className="text-xs text-slate-500 mt-0.5">Features that look across channels and topics.</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl px-4 divide-y divide-slate-700/40">
          <ToggleRow
            label="Cross-channel connections"
            description="Adds a weekly analysis button that surfaces thematic links and trends across all your channels."
            checked={crossChannelEnabled}
            onChange={(v) => { setCrossChannelEnabled(v); save({ cross_channel_enabled: v }) }}
          />
          <div>
            <ToggleRow
              label="Watchlist"
              description="Flag specific companies, people, or topics to always surface in any briefing."
              checked={watchlistEnabled}
              onChange={(v) => { setWatchlistEnabled(v); save({ watchlist_enabled: v }) }}
            />
            {watchlistEnabled && (
              <div className="pb-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTerm() } }}
                    placeholder="Company, person, or topic…"
                    className="flex-1 bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"
                  />
                  <button
                    onClick={addTerm}
                    disabled={!newTerm.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    Add
                  </button>
                </div>
                {watchlistTerms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {watchlistTerms.map((term, i) => (
                      <span
                        key={i}
                        className="flex items-center gap-1.5 bg-slate-700/60 border border-slate-600/50 text-slate-300 text-xs px-2.5 py-1 rounded-full"
                      >
                        {term}
                        <button
                          onClick={() => removeTerm(i)}
                          className="text-slate-500 hover:text-red-400 transition-colors leading-none"
                          aria-label={`Remove ${term}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {watchlistTerms.length === 0 && (
                  <p className="text-xs text-slate-600">No terms yet. Add companies, people, or topics above.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Audio ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Audio</h2>
          <p className="text-xs text-slate-500 mt-0.5">Listen to briefings with sentence-level highlighting. Uses your browser&apos;s built-in speech engine — no extra cost.</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl px-4 divide-y divide-slate-700/40">
          <ToggleRow
            label="Text-to-speech"
            description="Play any completed briefing as audio with sentence highlighting."
            checked={ttsEnabled}
            onChange={(v) => { setTtsEnabled(v); save({ tts_enabled: v }) }}
          />
          {ttsEnabled && (
            <div className="py-4 space-y-4">
              {/* Voice selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Voice</label>
                <select
                  value={ttsVoice ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null
                    setTtsVoice(val)
                    save({ tts_voice: val })
                  }}
                  className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/60 cursor-pointer"
                >
                  <option value="">Browser default</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}{v.lang ? ` (${v.lang})` : ''}
                    </option>
                  ))}
                </select>
                {voices.length === 0 && (
                  <p className="text-xs text-slate-600">Voices loading… (may take a moment on first visit)</p>
                )}
              </div>

              {/* Speed selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Speed</label>
                <div className="flex gap-2">
                  {TTS_SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setTtsSpeed(s); save({ tts_speed: s }) }}
                      className={[
                        'flex-1 py-1.5 text-xs rounded-lg border transition-colors',
                        ttsSpeed === s
                          ? 'border-indigo-500/60 bg-indigo-950/60 text-indigo-300'
                          : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300',
                      ].join(' ')}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Delivery ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Delivery</h2>
          <p className="text-xs text-slate-500 mt-0.5">How and when you receive your briefings.</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl px-4 divide-y divide-slate-700/40">
          {/* Email */}
          <div>
            <ToggleRow
              label="Email delivery"
              description="Send briefings to a specified email address after generation."
              checked={emailEnabled}
              onChange={(v) => { setEmailEnabled(v); save({ email_enabled: v }) }}
            />
            {emailEnabled && (
              <div className="pb-4 space-y-2">
                <input
                  type="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  onBlur={() => save({ email_address: emailAddress || null })}
                  placeholder="you@example.com"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"
                />
                <p className="text-xs text-slate-600">
                  Email sending is not yet connected. Your address is saved for when it is.
                </p>
              </div>
            )}
          </div>

          {/* Push notifications */}
          <div>
            <ToggleRow
              label="Mobile push notifications"
              description="Remind you at a set time that briefings are ready to generate."
              checked={notificationsEnabled}
              onChange={(v) => { setNotificationsEnabled(v); save({ notifications_enabled: v }) }}
            />
            {notificationsEnabled && (
              <div className="pb-4 space-y-2">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-slate-400">Reminder time</label>
                  <input
                    type="time"
                    value={notificationTime}
                    onChange={(e) => setNotificationTime(e.target.value)}
                    onBlur={() => save({ notification_time: notificationTime })}
                    className="bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/60"
                  />
                </div>
                <p className="text-xs text-slate-600">
                  Push notifications are not yet connected. Your preference is saved for when they are.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
