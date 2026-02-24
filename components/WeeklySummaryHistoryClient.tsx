'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WeeklySummaryWithCost } from '@/lib/types'
import { formatCost } from '@/lib/cost'

interface Props {
  summaries: WeeklySummaryWithCost[]
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  )
}

function formatWeekStart(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function readingTime(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 200))
  return `~${minutes} min`
}

export function WeeklySummaryHistoryClient({ summaries: initialSummaries }: Props) {
  const [summaries, setSummaries] = useState<WeeklySummaryWithCost[]>(initialSummaries)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)

  async function handleDelete(summaryId: string) {
    if (deletingId) return
    setDeletingId(summaryId)
    try {
      const res = await fetch(`/api/weekly-summaries/${summaryId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setSummaries((prev) => prev.filter((s) => s.id !== summaryId))
      setConfirmDeleteId(null)
      if (expandedId === summaryId) setExpandedId(null)
    } catch {
      // leave confirm visible so user can retry
    } finally {
      setDeletingId(null)
    }
  }

  async function handleExportPdf(summary: WeeklySummaryWithCost) {
    setExportingId(summary.id)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })

      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()
      const margin = 48
      const contentW = pageW - margin * 2
      let y = margin

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.setTextColor(30, 30, 50)
      doc.text('Weekly Summary', margin, y)
      y += 28

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(80, 80, 120)
      const weekLabel = `Week of ${formatWeekStart(summary.week_start)}`
      doc.text(weekLabel, margin, y)
      y += 16

      const channelLabel = `Channels: ${summary.channel_names.join(', ')}`
      const channelLines = doc.splitTextToSize(channelLabel, contentW) as string[]
      doc.text(channelLines, margin, y)
      y += channelLines.length * 14 + 4

      doc.setTextColor(120, 120, 140)
      doc.text(formatDate(summary.created_at), margin, y)
      y += 16

      if (summary.cost_usd != null) {
        const costStr =
          `Cost: ${formatCost(summary.cost_usd)}` +
          (summary.input_tokens != null
            ? ` · ${summary.input_tokens.toLocaleString()} in / ${summary.output_tokens?.toLocaleString()} out tokens`
            : '')
        doc.text(costStr, margin, y)
        y += 16
      }

      doc.setDrawColor(200, 200, 220)
      doc.setLineWidth(0.5)
      doc.line(margin, y + 4, pageW - margin, y + 4)
      y += 18

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(40, 40, 60)

      const plainText = summary.content
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

      const totalPages = (doc as unknown as { getNumberOfPages(): number }).getNumberOfPages()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(160, 160, 180)
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p)
        doc.text(`Weekly Summary · Page ${p} of ${totalPages}`, pageW / 2, pageH - 20, { align: 'center' })
      }

      doc.save(`weekly-summary-${summary.week_start}.pdf`)
    } finally {
      setExportingId(null)
    }
  }

  if (summaries.length === 0) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-14 h-14 bg-cream-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </div>
        <p className="text-ink-300 font-medium mb-1">No weekly summaries yet</p>
        <p className="text-ink-100 text-sm">Generate a Weekly Summary from the home screen to see history here.</p>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16 space-y-2">
      {summaries.map((s) => {
        const isExpanded = expandedId === s.id
        const isConfirmingDelete = confirmDeleteId === s.id
        const isThisDeleting = deletingId === s.id
        const isThisExporting = exportingId === s.id

        return (
          <div
            key={s.id}
            className="bg-cream-50 border border-cream-300/60 rounded-xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
          >
            {/* Row header */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : s.id)}
              className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-cream-100 transition-colors"
            >
              <svg
                className={`w-3.5 h-3.5 mt-1 flex-shrink-0 text-ink-50 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-ink-50 mb-1">
                  Week of {formatWeekStart(s.week_start)} · {readingTime(s.content)}
                </p>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {s.channel_names.map((name) => (
                    <span
                      key={name}
                      className="text-[10px] px-1.5 py-0.5 bg-violet-100 border border-violet-300 text-violet-700 rounded-full leading-none"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-ink-50">{formatDate(s.created_at)}</p>
              </div>
              {s.cost_usd != null && (
                <span className="flex-shrink-0 text-xs text-ink-50 ml-2 mt-1">
                  {formatCost(s.cost_usd)}
                </span>
              )}
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4">
                {/* Action bar */}
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-cream-300/60">
                  <button
                    onClick={() => handleExportPdf(s)}
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
                      onClick={() => setConfirmDeleteId(s.id)}
                      className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 bg-cream-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-red-600">Delete this summary?</span>
                      <button
                        onClick={() => handleDelete(s.id)}
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

                  {s.input_tokens != null && (
                    <span className="ml-auto text-xs text-ink-50">
                      {s.input_tokens.toLocaleString()} in / {s.output_tokens?.toLocaleString()} out tokens
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="font-serif prose prose-sm max-w-none prose-p:text-ink-200 prose-headings:font-sans prose-headings:text-ink-300 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-ink-300 prose-ul:list-disc prose-ol:list-decimal">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {s.content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </main>
  )
}
