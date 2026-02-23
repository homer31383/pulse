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
      // Navigate to the new channel's config page to set up instructions
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
    <div className="min-h-screen bg-warm-900">
      {/* Header */}
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
          <h1 className="text-lg font-semibold text-warm-100">New Channel</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-8 pb-32 space-y-6">
        <p className="text-sm text-warm-400">
          Give your channel a name to get started. You&apos;ll be able to configure instructions and search queries on the next screen.
        </p>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider">
            Channel name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            placeholder="e.g. AI & Machine Learning"
            className="w-full bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-3 text-warm-100 placeholder-warm-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider">
            Description <span className="text-warm-600 normal-case font-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="A short description of this channel"
            className="w-full bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-3 text-warm-100 placeholder-warm-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
            {error}
          </p>
        )}
      </main>

      {/* Fixed create button */}
      <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-10 bg-gradient-to-t from-warm-900 via-warm-900/90 to-transparent pointer-events-none">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
            className={[
              'w-full font-semibold py-4 rounded-2xl text-base transition-all duration-200',
              !name.trim() || isCreating
                ? 'bg-warm-700/60 text-warm-500 cursor-not-allowed'
                : 'bg-brand-600 hover:bg-brand-500 active:scale-[0.98] text-white shadow-lg shadow-brand-600/25',
            ].join(' ')}
          >
            {isCreating ? 'Creating…' : 'Create Channel'}
          </button>
        </div>
      </div>
    </div>
  )
}
