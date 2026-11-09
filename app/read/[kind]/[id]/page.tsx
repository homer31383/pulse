// Reading view for one briefing or digest — the destination of the queue's
// "Read" links. Playback (if any) continues underneath; the mini player
// stays docked. Reaching the end of the article marks it read.
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ReadArticleClient } from '@/components/ReadArticleClient'
import { artworkLinksEnabled } from '@/lib/artwork-links'
import { channelFromParam, channelIdFromParam, fullTextQueryError, normalizeFullTextQuery } from '@/lib/channel-history-types'
import { CATCHUP_FROM_PARAM } from '@/lib/post-pulse-catchup-types'
import type { Source } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ kind: string; id: string }>
  searchParams: Promise<{ from?: string; q?: string; w?: string; story?: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ReadPage({ params, searchParams }: Params) {
  const { kind, id } = await params
  // Rows in the Post-Pulse catch-up panel link here with ?from=post-pulse and
  // channel history rows with ?from=channel:<uuid>, so the back arrow returns
  // there instead of the listen queue. backQuery is carried by Previous/Next.
  const sp = await searchParams
  const from = sp.from
  // Full-text search results (channel history) pass ?q= (and &w=1 for whole
  // word, &story=<channel> for a digest story) so the first match is
  // highlighted and scrolled to. Ignored when malformed.
  const highlight = typeof sp.q === 'string' && !fullTextQueryError(sp.q)
    ? { q: normalizeFullTextQuery(sp.q), whole: sp.w === '1', story: typeof sp.story === 'string' ? sp.story.slice(0, 200) : null }
    : null
  const historyChannelId = channelIdFromParam(from)
  const { backHref, backQuery, backLabel } = from === 'post-pulse'
    ? { backHref: '/post-pulse', backQuery: `?${CATCHUP_FROM_PARAM}`, backLabel: 'Back to Post-Pulse' }
    : historyChannelId
      ? { backHref: `/channels/${historyChannelId}/history`, backQuery: `?${channelFromParam(historyChannelId)}`, backLabel: 'Back to channel history' }
      : { backHref: '/listen', backQuery: '', backLabel: 'Back to the listen queue' }
  if ((kind !== 'briefing' && kind !== 'digest') || !UUID_RE.test(id)) notFound()

  if (kind === 'briefing') {
    const { data } = await supabase
      .from('briefings')
      .select('id, content, sources, created_at, read_at, channel_id, channels(name)')
      .eq('id', id)
      .single()
    if (!data) notFound()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (data as any).channels as { name?: string } | { name?: string }[] | null
    const title = (Array.isArray(ch) ? ch[0]?.name : ch?.name) ?? 'Briefing'
    return (
      <ReadArticleClient
        key={`briefing:${data.id}`}
        kind="briefing"
        id={data.id}
        title={title}
        subtitle={null}
        content={data.content ?? ''}
        sources={(data.sources ?? []) as Source[]}
        createdAt={data.created_at}
        alreadyRead={!!data.read_at}
        backHref={backHref}
        backQuery={backQuery}
        backLabel={backLabel}
        artworkLinks={artworkLinksEnabled({ id: data.channel_id, name: title })}
        highlight={highlight}
      />
    )
  }

  const { data } = await supabase
    .from('digests')
    .select('id, content, sources, created_at, read_at, channel_names')
    .eq('id', id)
    .single()
  if (!data) notFound()
  const names = (data.channel_names ?? []) as string[]
  return (
    <ReadArticleClient
      key={`digest:${data.id}`}
      kind="digest"
      id={data.id}
      title="Morning Digest"
      subtitle={names.join(', ') || null}
      content={data.content ?? ''}
      sources={(data.sources ?? []) as Source[]}
      createdAt={data.created_at}
      alreadyRead={!!data.read_at}
      backHref={backHref}
      backQuery={backQuery}
      backLabel={backLabel}
      highlight={highlight}
    />
  )
}
