import {
  PP_AI_BY_VALUE,
  PP_KIND_BY_VALUE,
  PP_TIER_BY_VALUE,
  hostAppLabel,
  type PpAiInvolvement,
  type PpKind,
  type PpStatus,
  type PpTier,
} from '@/lib/post-pulse-types'

// Entries without a tier (migration 039: asset libraries, learning
// resources, references) render as "Not tiered", never as a tier.
export const NOT_TIERED = { label: 'Not tiered', short: 'Not tiered', description: 'Tier does not apply to this kind of entry.' }
const NO_TIER_TONE = { dot: 'bg-transparent border border-ink-50', badge: 'bg-transparent text-ink-50 border-cream-400 border-dashed' }

const TIER_TONE: Record<PpTier, { dot: string; badge: string }> = {
  automated: { dot: 'bg-press-up', badge: 'bg-press-up/10 text-press-up border-press-up/25' },
  assisted: { dot: 'bg-press-accent', badge: 'bg-press-accent/10 text-press-accent border-press-accent/25' },
  artist_led: { dot: 'bg-ink-50', badge: 'bg-cream-300/70 text-ink-100 border-cream-400' },
}

export function TierDot({ tier }: { tier: PpTier | null }) {
  const tone = tier ? TIER_TONE[tier] : NO_TIER_TONE
  return <span className={['inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', tone.dot].join(' ')} />
}

export function TierBadge({ tier, long }: { tier: PpTier | null; long?: boolean }) {
  const meta = tier ? PP_TIER_BY_VALUE[tier] : NOT_TIERED
  const tone = tier ? TIER_TONE[tier] : NO_TIER_TONE
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-px rounded-full border text-[11px] font-medium whitespace-nowrap',
        tone.badge,
      ].join(' ')}
      title={meta.description}
    >
      <span className={['w-1.5 h-1.5 rounded-full', tone.dot].join(' ')} />
      {long ? meta.label : meta.short}
    </span>
  )
}

// Small text labels for what an entry is (migration 039). Software that uses
// AI shows nothing extra (the default, and most of the dataset); otherwise
// the kind ("Asset library") and/or "Non-AI".
export function KindLabels({ kind, ai, className = '' }: { kind: PpKind; ai: PpAiInvolvement; className?: string }) {
  const labels: { text: string; title: string }[] = []
  if (kind !== 'software') labels.push({ text: PP_KIND_BY_VALUE[kind]?.label ?? kind, title: PP_KIND_BY_VALUE[kind]?.description ?? '' })
  if (ai === 'none') labels.push({ text: 'Non-AI', title: PP_AI_BY_VALUE.none.description })
  if (!labels.length) return null
  return (
    <>
      {labels.map((l) => (
        <span
          key={l.text}
          title={l.title}
          className={['inline-flex items-center px-1.5 py-px rounded border border-cream-400 text-[10px] uppercase tracking-[0.06em] text-ink-100 whitespace-nowrap', className].join(' ')}
        >
          {l.text}
        </span>
      ))}
    </>
  )
}

export function StatusBadge({ status }: { status: PpStatus }) {
  if (status === 'active') {
    return <span className="text-[11px] text-ink-50">Active</span>
  }
  return (
    <span className="inline-flex items-center px-2 py-px rounded-full border border-press-down/30 bg-press-down/10 text-press-down text-[11px] font-medium whitespace-nowrap">
      Discontinued
    </span>
  )
}

export function HostChip({ host }: { host: string | null }) {
  return (
    <span className="inline-flex items-center px-2 py-px rounded-md bg-cream-300/70 text-ink-100 text-[11px] whitespace-nowrap">
      {hostAppLabel(host)}
    </span>
  )
}
