import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { BriefingHistoryClient } from '@/components/BriefingHistoryClient'
import type { Channel, Briefing } from '@/lib/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function BriefingHistoryPage({ params }: PageProps) {
  const { id } = await params

  const [channelResult, briefingsResult] = await Promise.all([
    supabase.from('channels').select('*').eq('id', id).single(),
    supabase
      .from('briefings')
      .select('*')
      .eq('channel_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (!channelResult.data) notFound()

  const channel = channelResult.data as Channel
  const briefings = (briefingsResult.data ?? []) as Briefing[]

  return (
    <div className="min-h-screen bg-cream-200">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href={`/channels/${id}/config`}
            className="p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-300 transition-colors flex-shrink-0"
            aria-label="Back to config"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-normal text-ink-300 truncate">{channel.name}</h1>
            <p className="text-xs text-ink-50">
              {briefings.length === 0
                ? 'No briefings yet'
                : `${briefings.length} briefing${briefings.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
      </header>

      <BriefingHistoryClient briefings={briefings} />
    </div>
  )
}
