import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Stub for the scheduled Post Pulse pull (spec §5): RSS sources plus a
// web_search classification pass, every two weeks (vercel.json fires this
// on the 1st and 15th). Findings that confirm a verified entry auto-publish
// with a pp_changelog row; anything ambiguous goes to pp_queue via
// enqueueProposal(). Source list and query tuning are a follow-up pass.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  console.log('[post-pulse-sync] stub invoked — automation not implemented yet')
  return Response.json({ ok: true, stub: true, ranAt: new Date().toISOString() })
}
