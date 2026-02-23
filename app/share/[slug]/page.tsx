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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-slate-400 text-sm mb-4">This link is invalid or has expired.</p>
          <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
        <p className="text-slate-400 text-sm">Briefing not found.</p>
      </div>
    )
  }

  const channelName = channel?.name ?? 'Briefing'
  const date = new Date(briefing.created_at).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center shadow shadow-indigo-500/30">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-slate-200 truncate">{channelName}</h1>
            <p className="text-xs text-slate-500">{date}</p>
          </div>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700">
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
