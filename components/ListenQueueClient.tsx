'use client'

import { useState } from 'react'
import { useQueue } from '@/contexts/QueueContext'
import { QueueCostLine, QueueList, dateLabel } from './press/QueueList'

// /listen page body: the same queue as the expanded player, full-page, plus
// the Played section (last 30 days) with Re-queue.
export function ListenQueueClient() {
  const queue = useQueue()
  const [showPlayed, setShowPlayed] = useState(false)
  const { unplayed, loading, isCurrentActive } = queue
  const played = queue.items.filter((i) => i.played_at).sort((a, b) => (b.played_at! > a.played_at! ? 1 : -1))
  const hasResume = unplayed.some((i) => i.last_played_at)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 border-b-[0.5px] border-press-hair">
        <div className="flex-1 min-w-0">
          {loading ? <p className="font-chrome text-[11px] text-press-muted">Loading…</p> : <QueueCostLine />}
        </div>
        {unplayed.length > 0 && (
          <button
            onClick={() => (isCurrentActive ? queue.stopQueue() : queue.playAll())}
            className="flex items-center gap-1.5 rounded-full bg-press-accent text-white px-3 py-1.5 font-chrome text-[10px] uppercase tracking-[1px] hover:bg-press-accent/90"
          >
            {isCurrentActive ? (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
                Stop
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                {hasResume ? 'Resume' : 'Play all'}
              </>
            )}
          </button>
        )}
      </div>

      {queue.error && <p className="font-chrome text-[11px] text-press-down py-2">{queue.error}</p>}

      <QueueList />

      {played.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowPlayed((v) => !v)}
            className="flex items-center gap-1.5 press-label hover:text-press-accent transition-colors"
            aria-expanded={showPlayed}
          >
            Played · {played.length}
            <svg className={`w-3 h-3 transition-transform ${showPlayed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showPlayed && (
            <ul className="mt-2">
              {played.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-1 py-2.5 border-b-[0.5px] border-press-hair">
                  <div className="flex-1 min-w-0">
                    <span className="block font-georgia text-[13px] text-press-muted truncate">{item.title}</span>
                    <span className="block font-chrome text-[10px] text-press-faint truncate">
                      {dateLabel(item.created_at)} · played {dateLabel(item.played_at!)} · ~{item.minutes} min
                    </span>
                  </div>
                  <button
                    onClick={() => void queue.add(item.kind, item.item_id)}
                    className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted hover:text-press-accent"
                  >
                    Re-queue
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
