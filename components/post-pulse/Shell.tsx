'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { PpDataset } from '@/lib/post-pulse-types'
import { Sidebar } from './Sidebar'

// The dataset snapshot the /post-pulse layout loads once. Every view under
// the route reads from here; server pages that need fresh joins (detail,
// queue, changes) fetch their own rows and only use this for lookups.
const DatasetContext = createContext<PpDataset | null>(null)

export function usePostPulse(): PpDataset {
  const ctx = useContext(DatasetContext)
  if (!ctx) throw new Error('usePostPulse must be used inside PostPulseShell')
  return ctx
}

interface Props {
  data: PpDataset
  children: ReactNode
}

// Two-pane shell: a fixed sidebar on desktop, a slide-in drawer on phones.
// Utility palette (cream/ink), not the broadsheet press design.
export function PostPulseShell({ data, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()

  // Any navigation closes the phone drawer.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <DatasetContext.Provider value={data}>
      <div className="min-h-screen bg-cream-200 text-ink-300">
        {/* Phone header */}
        <header className="md:hidden sticky top-0 z-30 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-300 transition-colors"
              aria-label="Back to Pulse"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <Link href="/post-pulse" className="font-display text-lg text-ink-300">
              Post Pulse
            </Link>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-ink-200 bg-cream-50 border border-cream-300 hover:bg-cream-100 transition-colors"
              aria-label="Open browse panel"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 12h10M4 18h6" />
              </svg>
              Browse
              {data.pendingQueueCount > 0 && (
                <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-press-accent text-white text-[10px] font-medium flex items-center justify-center">
                  {data.pendingQueueCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="md:flex">
          {/* Desktop sidebar */}
          <aside className="hidden md:block md:w-[272px] lg:w-[300px] flex-shrink-0 border-r border-cream-300/70 bg-cream-100/70">
            <div className="sticky top-0 h-screen overflow-y-auto">
              <Sidebar />
            </div>
          </aside>

          {/* Phone drawer */}
          {drawerOpen && (
            <div className="md:hidden fixed inset-0 z-40">
              <button
                type="button"
                aria-label="Close browse panel"
                onClick={() => setDrawerOpen(false)}
                className="absolute inset-0 bg-ink-300/30"
              />
              <div className="absolute inset-y-0 left-0 w-[min(88vw,320px)] bg-cream-100 shadow-2xl overflow-y-auto animate-[slideIn_180ms_ease-out]">
                <Sidebar onNavigate={() => setDrawerOpen(false)} />
              </div>
            </div>
          )}

          <main className="flex-1 min-w-0">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 md:py-8">{children}</div>
          </main>
        </div>
      </div>
    </DatasetContext.Provider>
  )
}
