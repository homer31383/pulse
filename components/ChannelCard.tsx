'use client'

import Link from 'next/link'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Channel } from '@/lib/types'

interface ChannelCardProps {
  channel: Channel
  isSelected: boolean
  onToggle: (id: string) => void
  groupId?: string | null
  hasBriefing?: boolean
}

export function ChannelCard({ channel, isSelected, onToggle, groupId, hasBriefing = false }: ChannelCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: channel.id, data: { type: 'channel', groupId: groupId ?? null } })

  const lastBriefed = channel.last_briefed_at
    ? new Date(channel.last_briefed_at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'z-50 relative' : ''}
    >
      <div
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={0}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && onToggle(channel.id)}
        onClick={() => onToggle(channel.id)}
        className={[
          'group relative p-4 rounded-2xl cursor-pointer select-none',
          'transition-all duration-200 ease-out',
          isDragging
            ? 'bg-cream-100 shadow-[0_8px_30px_rgba(0,0,0,0.14)] scale-[1.02]'
            : isSelected
            ? 'bg-cream-50 ring-2 ring-brand-500/70 shadow-[0_4px_20px_rgba(124,111,205,0.12)] -translate-y-0.5'
            : 'bg-cream-50 shadow-[0_2px_12px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.10)]',
        ].join(' ')}
      >
        {/* Drag handle — top-left, hover-reveal */}
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="touch-none absolute top-2 left-2 p-1 text-ink-50/40 hover:text-ink-200 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-all duration-150"
          tabIndex={-1}
          aria-label="Drag to reorder"
          suppressHydrationWarning
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
          </svg>
        </button>

        {/* Briefing indicator dot + config gear — top-right */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          {hasBriefing && (
            <span className="w-1.5 h-1.5 bg-brand-500 rounded-full flex-shrink-0" />
          )}
          <Link
            href={`/channels/${channel.id}/config`}
            onClick={(e) => e.stopPropagation()}
            className="p-2 text-ink-50/50 hover:text-ink-300 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-all duration-150 rounded"
            aria-label={`Configure ${channel.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        </div>

        {/* Text content */}
        <div className="pr-6 pt-1">
          <p className="font-display text-lg font-normal tracking-wide text-ink-300 leading-snug">
            {channel.name}
          </p>
          {channel.description && (
            <p className="font-sans font-light text-sm text-ink-100 mt-1 leading-snug">
              {channel.description}
            </p>
          )}
          {lastBriefed && (
            <p className="font-sans text-xs text-ink-50 mt-3">
              {lastBriefed}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
