'use client'

import { useEffect } from 'react'
import { BriefingCard } from './BriefingCard'
import type { BriefingState } from '@/lib/types'

interface BriefingSheetProps {
  briefing: BriefingState
  depthFromTop: number
  onClose: () => void
  highlightsEnabled?: boolean
  sharingEnabled?: boolean
  feedbackEnabled?: boolean
  discussEnabled?: boolean
  ttsEnabled?: boolean
  defaultVoice?: string | null
  defaultSpeed?: number
}

export function BriefingSheet({
  briefing,
  depthFromTop,
  onClose,
  highlightsEnabled,
  sharingEnabled,
  feedbackEnabled,
  discussEnabled,
  ttsEnabled,
  defaultVoice,
  defaultSpeed,
}: BriefingSheetProps) {
  const isTop = depthFromTop === 0

  // Close on Escape (only top sheet)
  useEffect(() => {
    if (!isTop) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTop, onClose])

  return (
    <>
      {/* Backdrop — only for topmost sheet */}
      {isTop && (
        <div
          className="fixed inset-0 bg-ink-300/20 backdrop-blur-[2px]"
          style={{ zIndex: 39 }}
          onClick={onClose}
        />
      )}

      {/* Sheet panel */}
      <div
        className={[
          'fixed bottom-0 inset-x-0 rounded-t-3xl h-[90vh] overflow-hidden',
          'bg-cream-50 shadow-[0_-8px_40px_rgba(44,36,32,0.12)]',
          isTop ? 'animate-slide-up' : '',
        ].join(' ')}
        style={{
          zIndex: 40 + (10 - depthFromTop),
          transform: depthFromTop > 0
            ? `translateY(${depthFromTop * 16}px) scale(${1 - depthFromTop * 0.03})`
            : undefined,
          transformOrigin: 'bottom center',
          transition: depthFromTop > 0 ? 'transform 200ms ease-out' : undefined,
          pointerEvents: isTop ? 'auto' : 'none',
        }}
      >
        {/* Handle bar + close */}
        <div className="relative flex items-center justify-center px-5 pt-4 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-ink-50/30 rounded-full" />
          <button
            onClick={onClose}
            className="absolute right-4 top-3 p-2 text-ink-100 hover:text-ink-300 hover:bg-cream-200 transition-colors rounded-full"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto h-full pb-8">
          <BriefingCard
            briefing={briefing}
            sheetMode
            highlightsEnabled={highlightsEnabled}
            sharingEnabled={sharingEnabled}
            feedbackEnabled={feedbackEnabled}
            discussEnabled={discussEnabled}
            ttsEnabled={ttsEnabled}
            defaultVoice={defaultVoice}
            defaultSpeed={defaultSpeed}
          />
        </div>
      </div>
    </>
  )
}
