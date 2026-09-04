'use client'

import Link from 'next/link'
import { ListenQueueClient } from '@/components/ListenQueueClient'
import { PressNav } from '@/components/press/PressNav'
import { useQueue } from '@/contexts/QueueContext'

export default function ListenPage() {
  const { unplayed, loading } = useQueue()

  return (
    <div className="min-h-screen paper-page">
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink">Listen Queue</h1>
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted">
              {loading ? 'Loading' : unplayed.length === 0 ? 'The listening desk' : `${unplayed.length} item${unplayed.length !== 1 ? 's' : ''} queued`}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-2 pb-24">
        <ListenQueueClient />
      </main>

      <PressNav />
    </div>
  )
}
