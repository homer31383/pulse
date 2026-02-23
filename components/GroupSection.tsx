'use client'

import { useState, useRef, useEffect } from 'react'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChannelCard } from './ChannelCard'
import type { Channel, ChannelGroup } from '@/lib/types'

interface GroupSectionProps {
  group: ChannelGroup
  channels: Channel[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string) => void
}

export function GroupSection({
  group,
  channels,
  selectedIds,
  onToggle,
  onRename,
  onDelete,
}: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftName, setDraftName] = useState(group.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const sortableId = `group:${group.id}`
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, data: { type: 'group' } })

  // Focus input when renaming starts
  useEffect(() => {
    if (isRenaming) inputRef.current?.focus()
  }, [isRenaming])

  function commitRename() {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== group.name) {
      onRename(group.id, trimmed)
    } else {
      setDraftName(group.name)
    }
    setIsRenaming(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'z-50 relative opacity-80' : ''}
    >
      {/* Group header */}
      <div className="flex items-center gap-1.5 mb-1.5 mt-3 group/hdr">
        {/* Drag handle for group */}
        <button
          {...attributes}
          {...listeners}
          className="touch-none p-1 text-slate-700 hover:text-slate-500 cursor-grab active:cursor-grabbing flex-shrink-0"
          tabIndex={-1}
          aria-label="Drag to reorder group"
          suppressHydrationWarning
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
          </svg>
        </button>

        {/* Collapse toggle + name */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1 flex-1 min-w-0"
        >
          <svg
            className={`w-3 h-3 text-slate-600 flex-shrink-0 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
          {isRenaming ? (
            <input
              ref={inputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setDraftName(group.name); setIsRenaming(false) }
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 min-w-0 w-36"
            />
          ) : (
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider truncate">
              {group.name}
            </span>
          )}
          <span className="text-xs text-slate-700 flex-shrink-0 ml-1">
            {channels.length}
          </span>
        </button>

        {/* Group actions */}
        {!isRenaming && !confirmDelete && (
          <div className="flex items-center gap-1 opacity-0 group-hover/hdr:opacity-100 transition-opacity">
            <button
              onClick={() => { setIsRenaming(true); setDraftName(group.name) }}
              className="p-1 text-slate-600 hover:text-slate-300 transition-colors"
              title="Rename group"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1 text-slate-600 hover:text-red-400 transition-colors"
              title="Delete group"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
        {confirmDelete && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-red-400">Delete group?</span>
            <button
              onClick={() => onDelete(group.id)}
              className="text-[10px] text-white bg-red-700 hover:bg-red-600 px-1.5 py-0.5 rounded transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Channels within group */}
      {!collapsed && (
        <SortableContext
          items={channels.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 pl-4 border-l border-slate-800">
            {channels.length === 0 ? (
              <p className="text-xs text-slate-700 py-1 italic">No channels in this group</p>
            ) : (
              channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  isSelected={selectedIds.has(channel.id)}
                  onToggle={onToggle}
                  groupId={group.id}
                />
              ))
            )}
          </div>
        </SortableContext>
      )}
    </div>
  )
}
