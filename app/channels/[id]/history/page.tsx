import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { BriefingHistoryClient } from '@/components/BriefingHistoryClient'
import { ExportPdfButton, type ExportChannel } from '@/components/ExportPdfSheet'
import { channelsInAppOrder } from '@/lib/archive-export'
import type { Channel, Briefing } from '@/lib/types'

interface PageProps {
  params: Promise<{ id: string }>
}

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export default async function BriefingHistoryPage({ params }: PageProps) {
  const { id } = await params
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const [channelResult, briefingsResult, profileChannels] = await Promise.all([
    supabase.from('channels').select('*').eq('id', id).single(),
    supabase
      .from('briefings')
      .select('*')
      .eq('channel_id', id)
      .order('created_at', { ascending: false }),
    // The export picker lists the profile's channels, in app order
    channelsInAppOrder(profileId),
  ])

  if (!channelResult.data) notFound()

  const channel = channelResult.data as Channel
  const briefings = (briefingsResult.data ?? []) as Briefing[]
  const exportChannels: ExportChannel[] = profileChannels.map((c) => ({
    id: c.id, name: c.name, recapGroup: c.recap_group === 'post_pulse' ? 'post_pulse' : 'pulse',
  }))

  return (
    <div className="min-h-screen paper-page">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href={`/channels/${id}/config`}
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors flex-shrink-0"
            aria-label="Back to config"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink truncate">{channel.name}</h1>
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted">
              {briefings.length === 0
                ? 'No briefings yet'
                : `${briefings.length} briefing${briefings.length !== 1 ? 's' : ''} on file`}
            </p>
          </div>
          {briefings.length > 0 && <ExportPdfButton channels={exportChannels} preselect={[channel.id]} />}
        </div>
      </header>

      <BriefingHistoryClient briefings={briefings} channelName={channel.name} />
    </div>
  )
}
