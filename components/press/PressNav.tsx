'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { label: 'Today', href: '/' },
  { label: 'History', href: '/briefing-history' },
  { label: 'Pinned', href: '/pinned' },
  { label: 'Channels', href: '/channels/new/config' },
  { label: 'Settings', href: '/settings' },
]

// Centered bottom navigation for broadsheet pages
export function PressNav() {
  const pathname = usePathname()

  return (
    <nav className="mt-10 pb-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="press-rule-h mb-4" />
        <div className="flex items-center justify-center gap-6 sm:gap-8">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'font-chrome text-[10px] uppercase tracking-[1.5px] pb-0.5 transition-colors',
                  isActive
                    ? 'text-press-accent border-b border-press-accent'
                    : 'text-press-muted hover:text-press-accent',
                ].join(' ')}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
