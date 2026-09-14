'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import {
  PP_TIER_BY_VALUE,
  formatAttributeValue,
  hostAppLabel,
  type PpComparisonAttribute,
  type PpDepartment,
  type PpTool,
} from '@/lib/post-pulse-types'
import { StatusBadge, TierBadge } from './Badges'

interface Props {
  tools: PpTool[]
  department: PpDepartment | null
  allTools: PpTool[]
  onClose: () => void
}

// Side-by-side compare of 2–3 tools from one department. Rows come from the
// department's comparison_attributes (data-driven), after a fixed block of
// base fields every tool has. It's an overlay, not a route: closing it drops
// you back on the list with the selection intact.
export function CompareOverlay({ tools, department, allTools, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const schema: PpComparisonAttribute[] = department?.comparison_attributes ?? []
  // Attributes a tool carries that the department schema doesn't list yet —
  // shown after the schema rows so nothing captured is hidden.
  const extraKeys = Array.from(
    new Set(tools.flatMap((t) => Object.keys(t.attributes)).filter((k) => !schema.some((s) => s.key === k)))
  )
  const cols = `minmax(120px,1fr) repeat(${tools.length}, minmax(150px,1.4fr))`

  const nameOf = (id: string | null) => (id ? allTools.find((t) => t.id === id)?.name ?? '—' : '—')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" aria-label="Close compare" onClick={onClose} className="absolute inset-0 bg-ink-300/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare tools"
        className="relative w-full sm:w-[min(96vw,980px)] max-h-[92dvh] sm:max-h-[88vh] flex flex-col bg-cream-50 sm:rounded-2xl rounded-t-2xl shadow-2xl border border-cream-300 animate-[slideUp_220ms_ease-out]"
      >
        <div className="flex items-start gap-3 px-4 sm:px-6 pt-4 pb-3 border-b border-cream-300">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium">Compare</p>
            <h2 className="font-display text-xl text-ink-300 truncate">{department?.name ?? 'Tools'}</h2>
            {schema.length === 0 && (
              <p className="text-xs text-ink-50 mt-0.5">This department has no comparison attributes yet.</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-200 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-auto px-4 sm:px-6 py-4">
          <div className="min-w-[520px] grid text-sm" style={{ gridTemplateColumns: cols }}>
            {/* Header row */}
            <div />
            {tools.map((t) => (
              <div key={t.id} className="px-3 pb-3 border-b border-cream-300">
                <Link href={`/post-pulse/tools/${t.id}`} className="font-medium text-ink-300 hover:text-press-accent">
                  {t.name}
                </Link>
                {t.vendor && <p className="text-[11px] text-ink-50 mt-0.5">{t.vendor}</p>}
              </div>
            ))}

            <Row label="Tier">{tools.map((t) => <Cell key={t.id}><TierBadge tier={t.tier} /></Cell>)}</Row>
            <Row label="Host app">{tools.map((t) => <Cell key={t.id}>{hostAppLabel(t.host_app)}</Cell>)}</Row>
            <Row label="Status">
              {tools.map((t) => (
                <Cell key={t.id}>
                  <StatusBadge status={t.status} />
                  {t.replacement_tool_id && (
                    <span className="block text-[11px] text-ink-50 mt-0.5">→ {nameOf(t.replacement_tool_id)}</span>
                  )}
                </Cell>
              ))}
            </Row>
            <Row label="Summary">{tools.map((t) => <Cell key={t.id} muted>{t.blurb ?? '—'}</Cell>)}</Row>

            {schema.map((attr) => (
              <Row key={attr.key} label={attr.label}>
                {tools.map((t) => (
                  <Cell key={t.id} boolean={attr.type === 'boolean'} value={t.attributes[attr.key]}>
                    {formatAttributeValue(t.attributes[attr.key], attr.type)}
                  </Cell>
                ))}
              </Row>
            ))}
            {extraKeys.map((key) => (
              <Row key={key} label={humanize(key)} extra>
                {tools.map((t) => (
                  <Cell key={t.id}>{formatAttributeValue(t.attributes[key])}</Cell>
                ))}
              </Row>
            ))}

            <Row label="Why this tier">
              {tools.map((t) => (
                <Cell key={t.id}>
                  {department ? (
                    <Link
                      href={`/post-pulse/departments/${department.slug}#${t.doc_anchor ?? PP_TIER_BY_VALUE[t.tier].anchor}`}
                      className="text-press-accent hover:underline"
                    >
                      Department doc →
                    </Link>
                  ) : (
                    '—'
                  )}
                </Cell>
              ))}
            </Row>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children, extra }: { label: string; children: React.ReactNode; extra?: boolean }) {
  return (
    <>
      <div className={['px-3 py-2.5 border-b border-cream-300/70 text-xs font-medium', extra ? 'text-ink-50 italic' : 'text-ink-100'].join(' ')}>
        {label}
      </div>
      {children}
    </>
  )
}

function Cell({
  children,
  muted,
  boolean,
  value,
}: {
  children: React.ReactNode
  muted?: boolean
  boolean?: boolean
  value?: unknown
}) {
  let tone = muted ? 'text-ink-100' : 'text-ink-300'
  if (boolean && value !== undefined && value !== null) tone = value ? 'text-press-up font-medium' : 'text-ink-50'
  return <div className={['px-3 py-2.5 border-b border-cream-300/70 leading-snug', tone].join(' ')}>{children}</div>
}

function humanize(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
