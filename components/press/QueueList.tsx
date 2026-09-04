'use client'

import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueue } from '@/contexts/QueueContext'
import { useSpeech } from '@/contexts/SpeechContext'
import { formatTtsCost } from '@/lib/elevenlabs'
import type { ListenQueueItem } from '@/lib/types'

// The ordered "what's next" list, shared by the expanded player and /listen.
// Tap a row to jump playback to it; "Read" opens the item's reading view
// without touching playback; drag to reorder; × removes.

export function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function resumeLabel(item: ListenQueueItem): string | null {
  if (item.progress_seconds > 0) {
    const m = Math.floor(item.progress_seconds / 60)
    const s = String(Math.floor(item.progress_seconds % 60)).padStart(2, '0')
    return `resumes at ${m}:${s}`
  }
  if (item.progress_sentence > 0) return `resumes at sentence ${item.progress_sentence + 1}`
  return null
}

function Row({ item, index, isCurrent, isPlaying, onPlay, onRemove, onNavigate }: {
  item: ListenQueueItem
  index: number
  isCurrent: boolean
  isPlaying: boolean
  onPlay: () => void
  onRemove: () => void
  onNavigate?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const resume = resumeLabel(item)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[
        'flex items-center gap-2.5 px-1 py-2.5 border-b-[0.5px] border-press-hair',
        isDragging ? 'bg-white/60 shadow-[0_8px_30px_rgba(60,50,80,0.14)] relative z-10' : '',
        isCurrent ? 'bg-press-accent/[0.06]' : '',
      ].join(' ')}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab active:cursor-grabbing text-press-pin hover:text-press-accent touch-none p-1 flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      <span className={`font-chrome text-[10px] w-4 text-right flex-shrink-0 ${isCurrent ? 'text-press-accent' : 'text-press-faint'}`}>
        {isPlaying ? '▶' : index + 1}
      </span>
      <button onClick={onPlay} className="flex-1 min-w-0 text-left group">
        <span className={`block font-georgia text-[14px] leading-tight truncate ${isCurrent ? 'text-press-accent' : 'text-press-ink group-hover:text-press-accent'}`}>
          {item.title}
        </span>
        <span className="block font-chrome text-[10px] text-press-muted truncate">
          {item.subtitle ? `${item.subtitle} · ` : ''}{dateLabel(item.created_at)} · ~{item.minutes} min
          {item.cached ? ' · audio ready' : ''}
          {resume ? ` · ${resume}` : ''}
        </span>
      </button>
      <Link
        href={`/read/${item.kind}/${item.item_id}`}
        onClick={onNavigate}
        className="flex-shrink-0 font-chrome text-[10px] uppercase tracking-[1px] text-press-muted hover:text-press-accent px-1.5 py-1"
      >
        Read
      </Link>
      <button onClick={onRemove} aria-label="Remove from queue" className="flex-shrink-0 p-1 text-press-faint hover:text-press-down transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </li>
  )
}

export function QueueCostLine({ className = '' }: { className?: string }) {
  const { cost, unplayed } = useQueue()
  if (!cost || unplayed.length === 0) return null
  return (
    <p className={`font-chrome text-[11px] text-press-muted ${className}`}>
      <span className="text-press-ink">{unplayed.length} item{unplayed.length !== 1 ? 's' : ''}</span> · ~{cost.minutes} min
      {cost.provider === 'elevenlabs'
        ? cost.uncachedChars > 0
          ? ` · Premium: ~${formatTtsCost(cost.estimatedCost)} to generate${cost.cachedCount > 0 ? ` (${cost.cachedCount} ready)` : ''}`
          : ' · Premium: all audio ready'
        : ' · Standard voice, no cost'}
    </p>
  )
}

export function QueueList({ onNavigate }: { onNavigate?: () => void }) {
  const queue = useQueue()
  const speech = useSpeech()
  const { unplayed, current, isCurrentActive } = queue

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = unplayed.map((i) => i.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void queue.reorder(arrayMove(ids, from, to))
  }

  if (unplayed.length === 0) {
    return (
      <p className="font-georgia italic text-press-muted text-[13px] py-6 text-center">
        Nothing queued. New briefings and digests join automatically; the Queue button on any article adds older ones.
      </p>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={unplayed.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul>
          {unplayed.map((item, index) => (
            <Row
              key={item.id}
              item={item}
              index={index}
              isCurrent={item.id === current?.id}
              isPlaying={item.id === current?.id && isCurrentActive && speech.status === 'playing'}
              onPlay={() => queue.playItem(item.id)}
              onRemove={() => void queue.remove(item.id)}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
