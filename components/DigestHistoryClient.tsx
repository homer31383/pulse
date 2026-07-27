'use client'

import { useState } from 'react'
import { PressArticle } from './press/PressArticle'
import type { DigestWithCost, Source } from '@/lib/types'
import { formatCost } from '@/lib/cost'

interface Props {
  digests: DigestWithCost[]
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  )
}

function readingTime(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 200))
  return `~${minutes} min`
}

function getFirstLine(content: string): string {
  const lines = content.split('\n').map((l) => l.trim())
  for (const line of lines) {
    const stripped = line.replace(/^#+\s*/, '').replace(/^[*_]+|[*_]+$/g, '').trim()
    if (stripped.length > 3) {
      return stripped.length > 120 ? stripped.slice(0, 120) + '…' : stripped
    }
  }
  return '(no preview)'
}

export function DigestHistoryClient({ digests: initialDigests }: Props) {
  const [digests, setDigests] = useState<DigestWithCost[]>(initialDigests)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Optimistic overlay of ids marked read this session
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())

  const isUnread = (d: DigestWithCost) => !d.read_at && !localReadIds.has(d.id)

  function markRead(d: DigestWithCost) {
    if (!isUnread(d)) return
    setLocalReadIds((prev) => new Set([...prev, d.id]))
    fetch('/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digestIds: [d.id] }),
    }).catch(() => {})
  }
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)

  async function handleDelete(digestId: string) {
    if (deletingId) return
    setDeletingId(digestId)
    try {
      const res = await fetch(`/api/digests/${digestId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setDigests((prev) => prev.filter((d) => d.id !== digestId))
      setConfirmDeleteId(null)
      if (expandedId === digestId) setExpandedId(null)
    } catch {
      // leave confirm visible so user can retry
    } finally {
      setDeletingId(null)
    }
  }

  async function handleExportPdf(digest: DigestWithCost) {
    setExportingId(digest.id)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })

      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const margin = 48
      const contentW = pageW - margin * 2
      let y = margin

      // ── Title ────────────────────────────────────────────────────────────────
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.setTextColor(30, 30, 50)
      doc.text('Morning Digest', margin, y)
      y += 28

      // Channels covered
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(80, 80, 120)
      const channelLabel = `Channels: ${digest.channel_names.join(', ')}`
      const channelLines = doc.splitTextToSize(channelLabel, contentW) as string[]
      doc.text(channelLines, margin, y)
      y += channelLines.length * 14 + 4

      // Date + cost
      doc.setTextColor(120, 120, 140)
      doc.text(formatDate(digest.created_at), margin, y)
      y += 16

      if (digest.cost_usd != null) {
        const costStr =
          `Cost: ${formatCost(digest.cost_usd)}` +
          (digest.input_tokens != null
            ? ` · ${digest.input_tokens.toLocaleString()} in / ${digest.output_tokens?.toLocaleString()} out tokens`
            : '')
        doc.text(costStr, margin, y)
        y += 16
      }

      // Divider
      doc.setDrawColor(200, 200, 220)
      doc.setLineWidth(0.5)
      doc.line(margin, y + 4, pageW - margin, y + 4)
      y += 18

      // ── Body ─────────────────────────────────────────────────────────────────
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(40, 40, 60)

      const plainText = digest.content
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^[-*+]\s+/gm, '• ')
        .replace(/^\d+\.\s+/gm, '')
        .trim()

      const bodyLines = doc.splitTextToSize(plainText, contentW) as string[]
      const lineH = 15
      for (const line of bodyLines) {
        if (y + lineH > pageH - margin) { doc.addPage(); y = margin }
        doc.text(line, margin, y)
        y += lineH
      }

      // ── Sources ──────────────────────────────────────────────────────────────
      if (digest.sources && digest.sources.length > 0) {
        y += 8
        if (y + 30 > pageH - margin) { doc.addPage(); y = margin }

        doc.setDrawColor(200, 200, 220)
        doc.line(margin, y, pageW - margin, y)
        y += 14

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(80, 80, 120)
        doc.text('Sources', margin, y)
        y += 14

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(100, 100, 140)

        for (const src of digest.sources as Source[]) {
          if (y + 24 > pageH - margin) { doc.addPage(); y = margin }
          const titleStr = src.title || src.url
          const titleLines2 = doc.splitTextToSize(titleStr, contentW) as string[]
          doc.setFont('helvetica', 'bold')
          doc.text(titleLines2, margin, y)
          y += titleLines2.length * 12
          if (src.url) {
            doc.setFont('helvetica', 'normal')
            doc.setTextColor(80, 100, 200)
            const urlLines = doc.splitTextToSize(src.url, contentW) as string[]
            doc.text(urlLines, margin, y)
            y += urlLines.length * 11 + 4
            doc.setTextColor(100, 100, 140)
          }
        }
      }

      // ── Page footers ─────────────────────────────────────────────────────────
      const totalPages = (doc as unknown as { getNumberOfPages(): number }).getNumberOfPages()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(160, 160, 180)
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p)
        doc.text(`Morning Digest · Page ${p} of ${totalPages}`, pageW / 2, pageH - 20, { align: 'center' })
      }

      doc.save(`morning-digest-${digest.created_at.slice(0, 10)}.pdf`)
    } finally {
      setExportingId(null)
    }
  }

  if (digests.length === 0) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <svg className="w-7 h-7 text-press-pin mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2 2 0 00-2-2h-2" />
        </svg>
        <p className="font-georgia text-[15px] text-press-ink mb-1">No digests yet</p>
        <p className="font-georgia italic text-press-muted text-sm">Generate a Morning Digest from the home screen to see history here.</p>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16">
      <div className="press-rule-h" />
      {digests.map((d) => {
        const isExpanded = expandedId === d.id
        const isConfirmingDelete = confirmDeleteId === d.id
        const isThisDeleting = deletingId === d.id
        const isThisExporting = exportingId === d.id

        return (
          <div
            key={d.id}
            className="border-b-[0.5px] border-press-hair"
          >
            {/* Row header */}
            <button
              onClick={() => {
                setExpandedId(isExpanded ? null : d.id)
                if (!isExpanded) markRead(d)
              }}
              className="w-full px-1 py-4 flex items-start gap-3 text-left hover:bg-white/30 transition-colors"
            >
              <svg
                className={`w-3.5 h-3.5 mt-1 flex-shrink-0 text-press-pin transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted mb-1 flex items-center gap-2">
                  {isUnread(d) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-press-accent flex-shrink-0" aria-label="Unread" />
                  )}
                  {formatDate(d.created_at)} · {readingTime(d.content)}
                </p>
                {/* Channel list */}
                <p className="press-label mb-1.5 normal-case tracking-[1px]">
                  {d.channel_names.join(' · ')}
                </p>
                <p className="font-georgia text-[15px] text-press-ink truncate">{getFirstLine(d.content)}</p>
              </div>
              {d.cost_usd != null && (
                <span className="flex-shrink-0 font-chrome text-[10px] text-press-faint ml-2 mt-1">
                  {formatCost(d.cost_usd)}
                </span>
              )}
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-1 pb-4">
                {/* Action bar */}
                <div className="flex items-center gap-2 mb-4 pb-3 border-b-[0.5px] border-press-hair">
                  <button
                    onClick={() => handleExportPdf(d)}
                    disabled={isThisExporting}
                    className="flex items-center gap-1.5 font-chrome text-xs text-press-muted hover:text-press-accent border-[0.5px] border-press-hair hover:border-press-accent/50 bg-white/30 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isThisExporting ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Exporting…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export PDF
                      </>
                    )}
                  </button>

                  {!isConfirmingDelete ? (
                    <button
                      onClick={() => setConfirmDeleteId(d.id)}
                      className="flex items-center gap-1.5 font-chrome text-xs text-press-down hover:text-press-down/80 border-[0.5px] border-press-hair bg-white/30 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-red-600">Delete this digest?</span>
                      <button
                        onClick={() => handleDelete(d.id)}
                        disabled={isThisDeleting}
                        className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg transition-colors"
                      >
                        {isThisDeleting ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={isThisDeleting}
                        className="text-xs bg-cream-200 hover:bg-cream-300 disabled:opacity-50 text-ink-200 px-2.5 py-1 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {d.input_tokens != null && (
                    <span className="ml-auto font-chrome text-[10px] text-press-faint">
                      {d.input_tokens.toLocaleString()} in / {d.output_tokens?.toLocaleString()} out tokens
                    </span>
                  )}
                </div>

                {/* Content */}
                <PressArticle
                  content={d.content}
                  channelName="Morning Digest"
                  sourceDate={d.created_at}
                />

                {/* Sources */}
                {d.sources && d.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t-[0.5px] border-press-hair font-chrome text-[10px] text-press-faint leading-relaxed">
                    <span className="uppercase tracking-[1.5px] mr-1.5">Sources</span>
                    {(d.sources as Source[]).slice(0, 10).map((src, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-press-accent transition-colors"
                        >
                          {src.title || src.url}
                        </a>
                      </span>
                    ))}
                    {d.sources.length > 10 && ` · +${d.sources.length - 10} more`}
                    {` — ${d.sources.length} source${d.sources.length !== 1 ? 's' : ''} accessed`}
                    {d.cost_usd != null && ` · est. cost ${formatCost(d.cost_usd)}`}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </main>
  )
}
