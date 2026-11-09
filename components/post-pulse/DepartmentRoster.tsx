'use client'

// The department doc's tool roster by tier (was inline in the page). Starred
// tools (migration 038) come first in each tier, marked with a small filled
// star; the star buttons themselves live on the tool list rows and the tool
// page, since the roster's compact three-column links leave no room for a
// 44px target per name.

import Link from 'next/link'
import { PP_TIERS, type PpTool } from '@/lib/post-pulse-types'
import { TierDot } from './Badges'
import { useInterest } from './Interest'

export function DepartmentRoster({ tools }: { tools: PpTool[] }) {
  const { settled, live } = useInterest()
  return (
    <div className="grid sm:grid-cols-3 gap-2 mb-8">
      {PP_TIERS.map((tier) => {
        const list = tools
          .filter((t) => t.tier === tier.value)
          .sort((a, b) => Number(settled.tools.has(b.id)) - Number(settled.tools.has(a.id)))
        return (
          <div key={tier.value} className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-2.5">
            <a
              href={`#${tier.anchor}`}
              className="flex items-center gap-1.5 text-xs font-medium text-ink-200 hover:text-press-accent"
            >
              <TierDot tier={tier.value} />
              {tier.label}
              <span className="ml-auto text-ink-50 tabular-nums">{list.length}</span>
            </a>
            <ul className="mt-1.5 space-y-0.5">
              {list.length === 0 && <li className="text-[11px] text-ink-50 italic">None tracked</li>}
              {list.map((t) => (
                <li key={t.id} className="flex items-baseline gap-1">
                  {live.tools.has(t.id) && (
                    <svg className="w-3 h-3 flex-shrink-0 text-press-accent translate-y-[1px]" viewBox="0 0 24 24" fill="currentColor" aria-label="Starred">
                      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" />
                    </svg>
                  )}
                  <Link
                    href={`/post-pulse/tools/${t.id}`}
                    className={[
                      'text-[13px] hover:text-press-accent',
                      t.status === 'discontinued' ? 'text-ink-50 line-through decoration-ink-50/60' : 'text-ink-300',
                    ].join(' ')}
                  >
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
