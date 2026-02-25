import { supabase } from '@/lib/supabase'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import Link from 'next/link'

interface Params {
  params: Promise<{ slug: string }>
}

export default async function SharePage({ params }: Params) {
  const { slug } = await params

  // Resolve slug → briefing
  const { data: share } = await supabase
    .from('shared_briefings')
    .select('briefing_id')
    .eq('slug', slug)
    .single()

  if (!share) {
    return (
      <div className="min-h-screen bg-cream-200 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-ink-100 text-sm mb-4">This link is invalid or has expired.</p>
          <Link href="/" className="text-brand-600 hover:text-brand-700 text-sm">
            Open Pulse
          </Link>
        </div>
      </div>
    )
  }

  const { data: briefing } = await supabase
    .from('briefings')
    .select('content, created_at, channel_id')
    .eq('id', share.briefing_id)
    .single()

  const { data: channel } = briefing?.channel_id
    ? await supabase.from('channels').select('name').eq('id', briefing.channel_id).single()
    : { data: null }

  if (!briefing) {
    return (
      <div className="min-h-screen bg-cream-200 flex items-center justify-center px-4">
        <p className="text-ink-100 text-sm">Briefing not found.</p>
      </div>
    )
  }

  const channelName = channel?.name ?? 'Briefing'
  const date = new Date(briefing.created_at).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-cream-200">
      <header className="sticky top-0 z-20 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#7c6fcd" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="17" x2="20" y2="17"/>
            <g transform="rotate(-45, 5, 17)">
              <polyline points="5,17 10,17 11,10 12,20 14,17 20,17"/>
            </g>
          </svg>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-sm font-normal text-ink-300 truncate">{channelName}</h1>
            <p className="text-xs text-ink-50">{date}</p>
          </div>
          <span className="text-xs bg-cream-300 text-ink-100 px-2 py-0.5 rounded-full border border-cream-400">
            Shared via Pulse
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <MarkdownRenderer content={briefing.content} />
      </main>
    </div>
  )
}
