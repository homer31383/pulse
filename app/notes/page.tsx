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
    <div className="min-h-screen bg-warm-900">
      <header className="sticky top-0 z-20 bg-warm-900/95 backdrop-blur-sm border-b border-warm-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-200 hover:bg-warm-800 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold text-warm-100">Saved Notes</h1>
          {notes.length > 0 && (
            <span className="text-xs bg-warm-800 text-warm-400 px-2 py-0.5 rounded-full border border-warm-700 ml-auto">
              {notes.length}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-3">
        {loading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-warm-800/50 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-14 h-14 bg-warm-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-warm-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </div>
            <p className="text-warm-500 text-sm">No saved notes yet.</p>
            <p className="text-warm-600 text-xs mt-1">
              Select text in any briefing to clip it here.
            </p>
          </div>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="bg-warm-800/50 border border-warm-700/50 rounded-2xl px-4 py-3 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {note.channel_name && (
                    <p className="text-xs font-medium text-brand-400/80 mb-1">{note.channel_name}</p>
                  )}
                  <p className="text-sm text-warm-300 leading-relaxed">{note.content}</p>
                  <p className="text-xs text-warm-600 mt-2">
                    {new Date(note.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => deleteNote(note.id)}
                  className="flex-shrink-0 p-1.5 rounded-lg text-warm-600 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
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
