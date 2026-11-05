import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { HistoryNav } from '@/components/press/HistoryNav'
import { ChannelHistoryClient } from '@/components/ChannelHistoryClient'
import { ExportPdfButton, type ExportChannel } from '@/components/ExportPdfSheet'
import { channelsInAppOrder } from '@/lib/archive-export'
import { fetchChannelHistory } from '@/lib/channel-history'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

// One channel's briefings and digests (digests whose channel_ids include it).
// Profile-scoped like the export routes: another profile's channel is a 404.
// Read only: listing, filtering and searching never mark anything read.
export default async function ChannelHistoryPage({ params }: PageProps) {
  const { id } = await params
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const [history, profileChannels] = await Promise.all([
    fetchChannelHistory(profileId, id),
    // The export picker lists the profile's channels, in app order
    channelsInAppOrder(profileId),
  ])
  if (!history) notFound()

  const { channel, entries } = history
  const briefingCount = entries.filter((e) => e.kind === 'briefing').length
  const digestCount = entries.length - briefingCount
  const exportChannels: ExportChannel[] = profileChannels.map((c) => ({
    id: c.id, name: c.name, recapGroup: c.recap_group === 'post_pulse' ? 'post_pulse' : 'pulse',
  }))

  const countLine = entries.length === 0
    ? 'Nothing on file yet'
    : [
        `${briefingCount} briefing${briefingCount !== 1 ? 's' : ''}`,
        digestCount > 0 ? `${digestCount} digest${digestCount !== 1 ? 's' : ''}` : null,
      ].filter(Boolean).join(' · ') + ' on file'

  return (
    <div className="min-h-screen paper-page">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href={`/channels/${channel.id}/config`}
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors flex-shrink-0"
            aria-label="Back to config"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink truncate">{channel.name}</h1>
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted truncate">{countLine}</p>
          </div>
          <HistoryNav />
          {briefingCount > 0 && <ExportPdfButton channels={exportChannels} preselect={[channel.id]} />}
        </div>
      </header>

      <ChannelHistoryClient channelId={channel.id} entries={entries} />
    </div>
  )
}
