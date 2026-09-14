'use client'

import { useEffect, useState } from 'react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

// The guide copy, verbatim (it has been through revision — do not edit here
// without the author). It assumes the Activity feed and native run storage.
const GUIDE = `## How to use Post Pulse

### What runs without you touching anything

The daily cron works through whichever departments and pipeline stages have crossed the 14-day mark, oldest first. Frontier scans run on the same cadence, one pipeline stage at a time. Every run logs a summary to the Activity feed, automatically, whether or not you're watching.

### Your weekly touchpoint

Once a week, spend five to ten minutes here:

1. Check the Activity feed for anything since your last visit — skim, don't dwell.
2. Open the Queue. Accept or reject what's sitting there.
3. Anything marked incomplete is a judgment call — leave it for the next pass, or push on it yourself in chat.
4. Give Frontier-tagged items a slightly closer read than routine ones — they're answering "does anything exist here," not "did this known thing change," so they carry more uncertainty by nature.

Skip a week and nothing breaks. The queue just has more waiting next time.

### Your as-needed toolkit

Three different tools for three different triggers:

- **Heard about a specific tool, want to know what it is or where it fits** → chat, scoped to the relevant department if you're already looking at one.
- **A specific department probably moved and you don't want to wait for the cron** → the "research this department now" button on that department's doc.
- **You suspect there's a whole category of help you haven't named yet, or want to push on one of the still-empty stages** → frontier scan that stage, manually triggered from its panel on the pipeline map.

### Occasional housekeeping

Not on a fixed schedule — check the "last checked" timestamps on the pipeline map now and then. If something's aging past 14 days without refreshing, that's worth noticing before it becomes a blind spot. Worth reading a department's full doc occasionally too, not just skimming queue diffs — the queue shows what changed, the doc is where the actual synthesis lives.

### When you're making a real pipeline decision

Browse by department or tier, use compare mode on real candidates, and trust that what you're looking at is close to current — that's the whole point of the maintenance loop.
`

interface Props {
  className?: string
  onNavigate?: () => void
}

// Nav entry + the guide in an overlay. Same overlay pattern as the compare
// mode (fixed, backdrop, Escape, body scroll lock, slide-up) — non-primary
// content in Post Pulse opens in place, not on a route.
export function HowToUse({ className, onNavigate }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          onNavigate?.()
          setOpen(true)
        }}
        className={className}
      >
        <svg className="w-4 h-4 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="flex-1 text-left">How to use</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" aria-label="Close guide" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink-300/40" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="How to use Post Pulse"
            className="relative w-full sm:w-[min(94vw,720px)] max-h-[92dvh] sm:max-h-[88vh] flex flex-col bg-cream-50 sm:rounded-2xl rounded-t-2xl shadow-2xl border border-cream-300 animate-[slideUp_220ms_ease-out]"
          >
            <div className="flex items-start gap-3 px-5 sm:px-6 pt-4 pb-3 border-b border-cream-300">
              <p className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium pt-1">Guide</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-200 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto px-5 sm:px-6 py-4">
              <MarkdownRenderer content={GUIDE} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
