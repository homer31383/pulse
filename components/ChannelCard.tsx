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
}

export function ChannelCard({ channel, isSelected, onToggle, groupId }: ChannelCardProps) {
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
          'relative flex items-center gap-2 p-4 rounded-2xl border cursor-pointer',
          'transition-all duration-150 select-none',
          isDragging
            ? 'bg-slate-700/80 border-slate-600 shadow-xl scale-[1.02]'
            : isSelected
            ? 'bg-indigo-950/60 border-indigo-500/50 shadow-sm shadow-indigo-500/10'
            : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600 active:scale-[0.99]',
        ].join(' ')}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="touch-none flex-shrink-0 p-1 -ml-1 text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing"
          tabIndex={-1}
          aria-label="Drag to reorder"
          suppressHydrationWarning
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
          </svg>
        </button>

        {/* Circular checkbox */}
        <div
          className={[
            'flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-150',
            isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600',
          ].join(' ')}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-slate-100 truncate">{channel.name}</p>
          {channel.description && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{channel.description}</p>
          )}
          {lastBriefed && (
            <p className="text-xs text-slate-600 mt-1">Last briefed {lastBriefed}</p>
          )}
        </div>

        {/* Config gear */}
        <Link
          href={`/channels/${channel.id}/config`}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
          aria-label={`Configure ${channel.name}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
