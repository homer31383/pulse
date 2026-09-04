// Reading view for one briefing or digest — the destination of the queue's
// "Read" links. Playback (if any) continues underneath; the mini player
// stays docked. Reaching the end of the article marks it read.
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ReadArticleClient } from '@/components/ReadArticleClient'
import type { Source } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ kind: string; id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ReadPage({ params }: Params) {
  const { kind, id } = await params
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
        kind="briefing"
        id={data.id}
        title={title}
        subtitle={null}
        content={data.content ?? ''}
        sources={(data.sources ?? []) as Source[]}
        createdAt={data.created_at}
        alreadyRead={!!data.read_at}
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
      kind="digest"
      id={data.id}
      title="Morning Digest"
      subtitle={names.join(', ') || null}
      content={data.content ?? ''}
      sources={(data.sources ?? []) as Source[]}
      createdAt={data.created_at}
      alreadyRead={!!data.read_at}
    />
  )
}
