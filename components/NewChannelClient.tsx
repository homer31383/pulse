'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export function NewChannelClient() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    const trimmedName = name.trim()
    if (!trimmedName || isCreating) return
    setIsCreating(true)
    setError('')

    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const channel = await res.json()
      router.push(`/channels/${channel.id}/config`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel')
      setIsCreating(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
  }

  return (
    <div className="min-h-screen bg-cream-200">
      {/* Header */}
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
          <h1 className="font-display text-lg font-normal text-ink-300">New Channel</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-8 pb-32 space-y-6">
        <p className="text-sm text-ink-100">
          Give your channel a name to get started. You&apos;ll be able to configure instructions and search queries on the next screen.
        </p>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="block text-xs font-sans font-medium text-ink-100 uppercase tracking-wider">
            Channel name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            placeholder="e.g. AI & Machine Learning"
            className="w-full bg-cream-100 border border-cream-300 rounded-xl px-4 py-3 text-ink-300 placeholder-ink-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/50 text-sm transition-colors"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="block text-xs font-sans font-medium text-ink-100 uppercase tracking-wider">
            Description <span className="text-ink-50 normal-case font-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="A short description of this channel"
            className="w-full bg-cream-100 border border-cream-300 rounded-xl px-4 py-3 text-ink-300 placeholder-ink-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/50 text-sm transition-colors resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </p>
        )}
      </main>

      {/* Fixed create button */}
      <div className="fixed bottom-0 inset-x-0 bg-cream-200/95 backdrop-blur-sm border-t border-cream-300/60 px-4 py-3 pointer-events-none">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
            className={[
              'w-full font-semibold py-3.5 rounded-2xl text-sm transition-all duration-200',
              !name.trim() || isCreating
                ? 'bg-cream-300 text-ink-50 cursor-not-allowed'
                : 'bg-ink-300 hover:bg-ink-200 active:scale-[0.98] text-cream-50 shadow-lg shadow-ink-300/25',
            ].join(' ')}
          >
            {isCreating ? 'Creating…' : 'Create Channel'}
          </button>
        </div>
      </div>
    </div>
  )
}
