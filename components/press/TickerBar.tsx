import type { TickerItem } from '@/lib/types'

// Horizontal figures bar below the masthead. Values are maintained in
// Settings → Ticker (they are reference figures, not live market data).
export function TickerBar({ items }: { items: TickerItem[] }) {
  if (!items || items.length === 0) return null

  return (
    <div className="border-y-[0.5px] border-press-hair">
      <div
        className="max-w-2xl mx-auto px-4 flex items-center gap-7 overflow-x-auto py-2 font-chrome"
        style={{ scrollbarWidth: 'none' } as React.CSSProperties}
      >
        {items.map((item, i) => (
          <div key={i} className="flex-shrink-0 text-center">
            <p
              className={[
                'text-[13px] leading-tight tabular-nums',
                item.change === 'up'
                  ? 'text-press-up'
                  : item.change === 'down'
                  ? 'text-press-down'
                  : 'text-press-body',
              ].join(' ')}
            >
              {item.change === 'up' ? '▲ ' : item.change === 'down' ? '▼ ' : ''}
              {item.value}
            </p>
            <p className="text-[8px] uppercase tracking-[1.5px] text-press-muted mt-0.5">
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
