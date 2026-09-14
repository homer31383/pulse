import { PP_TIER_BY_VALUE, hostAppLabel, type PpStatus, type PpTier } from '@/lib/post-pulse-types'

const TIER_TONE: Record<PpTier, { dot: string; badge: string }> = {
  automated: { dot: 'bg-press-up', badge: 'bg-press-up/10 text-press-up border-press-up/25' },
  assisted: { dot: 'bg-press-accent', badge: 'bg-press-accent/10 text-press-accent border-press-accent/25' },
  artist_led: { dot: 'bg-ink-50', badge: 'bg-cream-300/70 text-ink-100 border-cream-400' },
}

export function TierDot({ tier }: { tier: PpTier }) {
  return <span className={['inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', TIER_TONE[tier].dot].join(' ')} />
}

export function TierBadge({ tier, long }: { tier: PpTier; long?: boolean }) {
  const meta = PP_TIER_BY_VALUE[tier]
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-px rounded-full border text-[11px] font-medium whitespace-nowrap',
        TIER_TONE[tier].badge,
      ].join(' ')}
      title={meta.description}
    >
      <span className={['w-1.5 h-1.5 rounded-full', TIER_TONE[tier].dot].join(' ')} />
      {long ? meta.label : meta.short}
    </span>
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
