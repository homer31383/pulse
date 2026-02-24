'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { Note } from '@/lib/types'

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notes')
      .then((r) => r.json())
      .then((data) => setNotes(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [])

  async function deleteNote(id: string) {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' })
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  return (
    <div className="min-h-screen bg-cream-200">
      <header className="sticky top-0 z-20 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-300 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="font-display text-lg font-normal text-ink-300">Saved Notes</h1>
          {notes.length > 0 && (
            <span className="text-xs bg-cream-300 text-ink-100 px-2 py-0.5 rounded-full border border-cream-400 ml-auto">
              {notes.length}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-3">
        {loading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-cream-300/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-14 h-14 bg-cream-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </div>
            <p className="text-ink-100 text-sm">No saved notes yet.</p>
            <p className="text-ink-50 text-xs mt-1">
              Select text in any briefing to clip it here.
            </p>
          </div>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="bg-cream-50 border border-cream-300/60 rounded-2xl px-4 py-3 group shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {note.channel_name && (
                    <p className="text-xs font-medium text-brand-600 mb-1">{note.channel_name}</p>
                  )}
                  <p className="text-sm text-ink-200 leading-relaxed">{note.content}</p>
                  <p className="text-xs text-ink-50 mt-2">
                    {new Date(note.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => deleteNote(note.id)}
                  className="flex-shrink-0 p-1.5 rounded-lg text-ink-50 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Delete note"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  )
}
