import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { DailyArchiveClient } from '@/components/DailyArchiveClient'
import { PressNav } from '@/components/press/PressNav'
import type { Briefing, Digest, Source } from '@/lib/types'

export const dynamic = 'force-dynamic'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export default async function AllBriefingHistoryPage() {
  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const { data: channels } = await supabase
    .from('channels')
    .select('id, name')
    .eq('profile_id', profileId)

  const channelNames = new Map((channels ?? []).map((c) => [c.id, c.name as string]))
  const channelIds = [...channelNames.keys()]

  const [briefingsResult, digestsResult] = await Promise.all([
    channelIds.length > 0
      ? supabase
          .from('briefings')
          .select('*')
          .in('channel_id', channelIds)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] as Briefing[] }),
    supabase
      .from('digests')
      .select('id, content, sources, channel_ids, channel_names, model, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const briefings = ((briefingsResult.data ?? []) as Briefing[]).map((b) => ({
    ...b,
    channel_name: channelNames.get(b.channel_id),
  }))

  const digests: Digest[] = (digestsResult.data ?? []).map((d) => ({
    ...d,
    sources: (d.sources as unknown as Source[]) ?? [],
    channel_ids: d.channel_ids ?? [],
    channel_names: d.channel_names ?? [],
  }))

  const total = briefings.length + digests.length

  return (
    <div className="min-h-screen paper-page">
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink">The Archive</h1>
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted">
              {total === 0
                ? 'Nothing on file yet'
                : [
                    briefings.length > 0 && `${briefings.length} briefing${briefings.length !== 1 ? 's' : ''}`,
                    digests.length > 0 && `${digests.length} digest${digests.length !== 1 ? 's' : ''}`,
                  ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <DailyArchiveClient briefings={briefings} digests={digests} />
      <PressNav />
    </div>
  )
}
