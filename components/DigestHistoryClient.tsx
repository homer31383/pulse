'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
        <div className="w-14 h-14 bg-cream-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2 2 0 00-2-2h-2" />
          </svg>
        </div>
        <p className="text-ink-300 font-medium mb-1">No digests yet</p>
        <p className="text-ink-100 text-sm">Generate a Morning Digest from the home screen to see history here.</p>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16 space-y-2">
      {digests.map((d) => {
        const isExpanded = expandedId === d.id
        const isConfirmingDelete = confirmDeleteId === d.id
        const isThisDeleting = deletingId === d.id
        const isThisExporting = exportingId === d.id

        return (
          <div
            key={d.id}
            className="bg-cream-50 border border-cream-300/60 rounded-xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
          >
            {/* Row header */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : d.id)}
              className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-cream-100 transition-colors"
            >
              <svg
                className={`w-3.5 h-3.5 mt-1 flex-shrink-0 text-ink-50 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-ink-50 mb-1">{formatDate(d.created_at)} · {readingTime(d.content)}</p>
                {/* Channel tags */}
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {d.channel_names.map((name) => (
                    <span
                      key={name}
                      className="text-[10px] px-1.5 py-0.5 bg-brand-50 border border-brand-300/50 text-brand-700 rounded-full leading-none"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-ink-200 truncate">{getFirstLine(d.content)}</p>
              </div>
              {d.cost_usd != null && (
                <span className="flex-shrink-0 text-xs text-ink-50 ml-2 mt-1">
                  {formatCost(d.cost_usd)}
                </span>
              )}
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4">
                {/* Action bar */}
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-cream-300/60">
                  <button
                    onClick={() => handleExportPdf(d)}
                    disabled={isThisExporting}
                    className="flex items-center gap-1.5 text-xs text-ink-100 hover:text-ink-300 bg-cream-200 hover:bg-cream-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
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
                      className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 bg-cream-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
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
                    <span className="ml-auto text-xs text-ink-50">
                      {d.input_tokens.toLocaleString()} in / {d.output_tokens?.toLocaleString()} out tokens
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="font-serif prose prose-sm max-w-none prose-p:text-ink-200 prose-headings:font-sans prose-headings:text-ink-300 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-ink-300 prose-ul:list-disc prose-ol:list-decimal">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {d.content}
                  </ReactMarkdown>
                </div>

                {/* Sources */}
                {d.sources && d.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-cream-300/40">
                    <p className="text-xs font-semibold text-ink-50 uppercase tracking-wider mb-2">Sources</p>
                    <ol className="space-y-1.5">
                      {(d.sources as Source[]).map((src, i) => (
                        <li key={i} className="flex gap-2 text-xs">
                          <span className="text-ink-50 flex-shrink-0">{i + 1}.</span>
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-600 hover:text-brand-700 hover:underline truncate"
                          >
                            {src.title || src.url}
                          </a>
                        </li>
                      ))}
                    </ol>
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
