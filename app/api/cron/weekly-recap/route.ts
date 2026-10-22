import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { compileAndSendRecap, hoursSinceRecapSlot, smtpConfigured } from '@/lib/recap'

// Weekly Recap Email — runs hourly (vercel.json), sends once a week per profile.
//
// COMPILE ONLY: this route reads what the last 7 days already produced and
// emails a summary. It never imports lib/generation.ts and never triggers a
// briefing or digest. A channel that didn't generate this week is absent.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Same eligibility shape as the scheduled-briefings cron: the profile's
// (day, hour) slot plus a few catch-up hours, deduped by a last-run stamp.
const CATCH_UP_HOURS = 3
const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows, error } = await supabase
    .from('settings')
    .select('id, recap_day, recap_time, recap_last_run_at, email_address')
    .eq('recap_email_enabled', true)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const now = new Date()
  const results: Array<Record<string, unknown>> = []

  for (const s of rows ?? []) {
    const profileId: string = s.id
    const since = hoursSinceRecapSlot(s.recap_day ?? 0, s.recap_time ?? '07:00', now)
    if (since > CATCH_UP_HOURS) continue

    const lastRun = s.recap_last_run_at ? new Date(s.recap_last_run_at).getTime() : 0
    if (now.getTime() - lastRun < DEDUPE_WINDOW_MS) {
      results.push({ profileId, status: 'already_ran' })
      continue
    }

    if (!smtpConfigured()) {
      console.error('[recap] SMTP_USER / SMTP_PASS not set; skipping')
      results.push({ profileId, status: 'error', detail: 'SMTP not configured' })
      continue
    }

    try {
      const recipient: string | null = s.email_address ?? process.env.RECAP_TO ?? null
      const result = await compileAndSendRecap(profileId, recipient, now)
      // Stamp whether or not an email went out so an empty week is checked
      // once at the slot, not again every catch-up hour.
      await supabase.from('settings').update({ recap_last_run_at: now.toISOString() }).eq('id', profileId)
      console.log(`[recap] ${profileId}: ${result.status}`, result)
      results.push({ profileId, ...result })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error(`[recap] ${profileId}: failed — ${detail}`)
      results.push({ profileId, status: 'error', detail })
    }
  }

  return Response.json({ ok: true, ranAt: now.toISOString(), results })
}
