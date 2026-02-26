'use client'

import { useEffect, useRef } from 'react'
import { BriefingCard } from './BriefingCard'
import type { BriefingState } from '@/lib/types'

interface BriefingSheetProps {
  openIds: string[]
  briefings: Map<string, BriefingState>
  activeId: string
  onTabClick: (id: string) => void
  onClose: () => void
  highlightsEnabled?: boolean
  sharingEnabled?: boolean
  feedbackEnabled?: boolean
  discussEnabled?: boolean
  ttsEnabled?: boolean
  defaultVoice?: string | null
  defaultSpeed?: number
}

function StatusDot({ status }: { status: BriefingState['status'] }) {
  if (status === 'streaming') {
    return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
  }
  if (status === 'done') {
    return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
  }
  if (status === 'error') {
    return <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
  }
  return null
}

export function BriefingSheet({
  openIds,
  briefings,
  activeId,
  onTabClick,
  onClose,
  highlightsEnabled,
  sharingEnabled,
  feedbackEnabled,
  discussEnabled,
  ttsEnabled,
  defaultVoice,
  defaultSpeed,
}: BriefingSheetProps) {
  const tabBarRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Scroll active tab into view when it changes
  useEffect(() => {
    if (!tabBarRef.current) return
    const el = tabBarRef.current.querySelector('[data-active="true"]') as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeId])

  const activeBriefing = briefings.get(activeId)
  if (!activeBriefing) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink-300/20 backdrop-blur-[2px]"
        style={{ zIndex: 39 }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 inset-x-0 rounded-t-3xl bg-cream-50 shadow-[0_-8px_40px_rgba(44,36,32,0.12)] animate-slide-up flex flex-col h-sheet"
        style={{ zIndex: 40 }}
      >
        {/* ── Tab bar header ── */}
        <div className="flex-shrink-0 rounded-t-3xl bg-cream-50">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1.5">
            <div className="w-10 h-1 bg-ink-50/40 rounded-full" />
          </div>

          {/* Tabs + close button row */}
          <div className="flex items-stretch px-2 border-b border-cream-300/60">
            {/* Horizontally scrollable tab strip */}
            <div
              ref={tabBarRef}
              className="flex-1 flex min-w-0 overflow-x-auto"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            >
              {openIds.map((id) => {
                const b = briefings.get(id)
                if (!b) return null
                const isActive = id === activeId
                return (
                  <button
                    key={id}
                    data-active={isActive}
                    onClick={() => onTabClick(id)}
                    className={[
                      'flex items-center gap-1.5 px-3.5 min-h-[44px] text-sm whitespace-nowrap flex-shrink-0',
                      'border-b-2 -mb-px transition-colors duration-150 focus:outline-none',
                      isActive
                        ? 'border-[#7c6fcd] text-[#7c6fcd] font-medium'
                        : 'border-transparent text-ink-100 hover:text-ink-200',
                    ].join(' ')}
                  >
                    <StatusDot status={b.status} />
                    <span className="max-w-[130px] truncate">{b.channelName}</span>
                  </button>
                )
              })}
            </div>

            {/* Close button — outside scroll area, always visible */}
            <div className="flex-shrink-0 flex items-center pl-1 pr-1">
              <button
                onClick={onClose}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-100 hover:text-ink-300 hover:bg-cream-300 rounded-lg transition-colors"
                aria-label="Close briefings"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable briefing content — key forces remount on tab switch */}
        <div
          className="flex-1 overflow-y-auto min-h-0"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="md:max-w-3xl md:mx-auto">
            <BriefingCard
              key={activeId}
              briefing={activeBriefing}
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
      </div>
    </>
  )
}
