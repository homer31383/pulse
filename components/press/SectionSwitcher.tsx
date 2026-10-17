import Link from 'next/link'

// Newspaper section tabs under the masthead: flips between Pulse (home) and
// Post-Pulse. Shown on both, with the current section active.
const SECTIONS = [
  { key: 'pulse', label: 'Pulse', href: '/' },
  { key: 'post-pulse', label: 'Post-Pulse', href: '/post-pulse' },
] as const

export function SectionSwitcher({
  active,
  rule = true,
}: {
  active: 'pulse' | 'post-pulse'
  // Bottom hairline. Off on home when the ticker's top border already draws it.
  rule?: boolean
}) {
  return (
    <nav aria-label="Sections" className="max-w-2xl mx-auto px-4">
      <div className="flex items-center justify-center gap-7 py-2 font-chrome text-[10px] uppercase tracking-[1.5px] whitespace-nowrap">
        {SECTIONS.map((s) => {
          const isActive = s.key === active
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive
                  ? 'text-press-accent border-b border-press-accent pb-0.5'
                  : 'text-press-muted border-b border-transparent pb-0.5 hover:text-press-ink transition-colors'
              }
            >
              {s.label}
            </Link>
          )
        })}
      </div>
      {rule && <div className="press-rule-h" />}
    </nav>
  )
}
