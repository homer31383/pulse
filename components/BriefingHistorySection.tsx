'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { BriefingWithCost, Source } from '@/lib/types'
import { formatCost } from '@/lib/cost'

interface Props {
  channelName: string
  channelId: string
  initialBriefings: BriefingWithCost[]
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function getFirstLine(content: string): string {
  // Strip leading markdown headings and blank lines, return first meaningful sentence
  const lines = content.split('\n').map((l) => l.trim())
  for (const line of lines) {
    const stripped = line.replace(/^#+\s*/, '').replace(/^[*_]+|[*_]+$/g, '').trim()
    if (stripped.length > 3) {
      return stripped.length > 120 ? stripped.slice(0, 120) + '…' : stripped
    }
  }
  return '(no preview)'
}

export function BriefingHistorySection({ channelName, channelId, initialBriefings }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [briefings, setBriefings] = useState<BriefingWithCost[]>(initialBriefings)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)

  async function handleDelete(briefingId: string) {
    if (deletingId) return
    setDeletingId(briefingId)
    try {
      const res = await fetch(`/api/briefings/${channelId}/${briefingId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setBriefings((prev) => prev.filter((b) => b.id !== briefingId))
      setConfirmDeleteId(null)
      if (expandedId === briefingId) setExpandedId(null)
    } catch {
      // leave confirm visible so user can retry
    } finally {
      setDeletingId(null)
    }
  }

  async function handleExportPdf(briefing: BriefingWithCost) {
    setExportingId(briefing.id)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })

      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const margin = 48
      const contentW = pageW - margin * 2
      let y = margin

      // ── Title block ──────────────────────────────────────────────────────────
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.setTextColor(30, 30, 50)
      const titleLines = doc.splitTextToSize(channelName, contentW) as string[]
      doc.text(titleLines, margin, y)
      y += titleLines.length * 24 + 4

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(120, 120, 140)
      doc.text(formatDate(briefing.created_at), margin, y)
      y += 20

      if (briefing.cost_usd != null) {
        const costLabel = `Cost: ${formatCost(briefing.cost_usd)}`
        const tokenLabel = briefing.input_tokens != null
          ? ` · ${briefing.input_tokens.toLocaleString()} in / ${briefing.output_tokens?.toLocaleString()} out tokens`
          : ''
        doc.text(costLabel + tokenLabel, margin, y)
        y += 16
      }

      // Divider
      doc.setDrawColor(200, 200, 220)
      doc.setLineWidth(0.5)
      doc.line(margin, y + 4, pageW - margin, y + 4)
      y += 18

      // ── Body text ────────────────────────────────────────────────────────────
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(40, 40, 60)

      // Strip markdown for clean PDF text
      const plainText = briefing.content
        .replace(/^#{1,6}\s+/gm, '')          // headings
        .replace(/\*\*(.*?)\*\*/g, '$1')       // bold
        .replace(/\*(.*?)\*/g, '$1')           // italic
        .replace(/`{1,3}[^`]*`{1,3}/g, '')    // code
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
        .replace(/^[-*+]\s+/gm, '• ')         // bullets
        .replace(/^\d+\.\s+/gm, '')           // numbered lists
        .trim()

      const bodyLines = doc.splitTextToSize(plainText, contentW) as string[]
      const lineH = 15
      for (const line of bodyLines) {
        if (y + lineH > pageH - margin) {
          doc.addPage()
          y = margin
        }
        doc.text(line, margin, y)
        y += lineH
      }

      // ── Sources ──────────────────────────────────────────────────────────────
      if (briefing.sources && briefing.sources.length > 0) {
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

        for (const src of briefing.sources as Source[]) {
          if (y + 24 > pageH - margin) { doc.addPage(); y = margin }
          const titleStr = src.title ? `${src.title}` : src.url
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
        doc.text(
          `${channelName} · Page ${p} of ${totalPages}`,
          pageW / 2,
          pageH - 20,
          { align: 'center' }
        )
      }

      const safeDate = briefing.created_at.slice(0, 10)
      doc.save(`${channelName.replace(/[^a-z0-9]/gi, '-')}-${safeDate}.pdf`)
    } finally {
      setExportingId(null)
    }
  }

  return (
    <div className="border-t border-warm-800 pt-6">
      {/* Section header / toggle */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between group"
      >
        <span className="text-xs font-semibold text-warm-400 uppercase tracking-wider group-hover:text-warm-300 transition-colors">
          Briefing history
          {briefings.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center w-5 h-5 bg-warm-700 rounded-full text-[10px] font-bold text-warm-300 normal-case tracking-normal">
              {briefings.length}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-warm-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="mt-4 space-y-2">
          {briefings.length === 0 ? (
            <p className="text-sm text-warm-600 py-2">No briefings yet for this channel.</p>
          ) : (
            briefings.map((b) => {
              const isExpanded = expandedId === b.id
              const isConfirmingDelete = confirmDeleteId === b.id
              const isThisDeleting = deletingId === b.id
              const isThisExporting = exportingId === b.id

              return (
                <div
                  key={b.id}
                  className="bg-warm-800/40 border border-warm-700/40 rounded-xl overflow-hidden"
                >
                  {/* Row header */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : b.id)}
                    className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-warm-700/20 transition-colors"
                  >
                    <svg
                      className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-warm-500 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-warm-500 mb-0.5">{formatDate(b.created_at)}</p>
                      <p className="text-sm text-warm-300 truncate">{getFirstLine(b.content)}</p>
                    </div>
                    {b.cost_usd != null && (
                      <span className="flex-shrink-0 text-xs text-warm-600 ml-2">
                        {formatCost(b.cost_usd)}
                      </span>
                    )}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-warm-700/40">
                        <button
                          onClick={() => handleExportPdf(b)}
                          disabled={isThisExporting}
                          className="flex items-center gap-1.5 text-xs text-warm-400 hover:text-warm-200 bg-warm-700/50 hover:bg-warm-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isThisExporting ? (
                            <>
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
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
                            onClick={() => setConfirmDeleteId(b.id)}
                            className="flex items-center gap-1.5 text-xs text-red-400/70 hover:text-red-300 bg-warm-700/50 hover:bg-red-950/40 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-red-400">Delete this briefing?</span>
                            <button
                              onClick={() => handleDelete(b.id)}
                              disabled={isThisDeleting}
                              className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg transition-colors"
                            >
                              {isThisDeleting ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={isThisDeleting}
                              className="text-xs bg-warm-700 hover:bg-warm-600 disabled:opacity-50 text-warm-300 px-2.5 py-1 rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        )}

                        {b.input_tokens != null && (
                          <span className="ml-auto text-xs text-warm-600">
                            {b.input_tokens.toLocaleString()} in / {b.output_tokens?.toLocaleString()} out tokens
                          </span>
                        )}
                      </div>

                      {/* Briefing content */}
                      <div className="prose prose-sm prose-invert max-w-none text-warm-300 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_a]:text-brand-400 [&_a]:no-underline hover:[&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {b.content}
                        </ReactMarkdown>
                      </div>

                      {/* Sources */}
                      {b.sources && b.sources.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-warm-700/40">
                          <p className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-2">Sources</p>
                          <ol className="space-y-1.5">
                            {(b.sources as Source[]).map((src, i) => (
                              <li key={i} className="flex gap-2 text-xs">
                                <span className="text-warm-600 flex-shrink-0">{i + 1}.</span>
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-brand-400 hover:text-brand-300 hover:underline truncate"
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
            })
          )}
        </div>
      )}
    </div>
  )
}
