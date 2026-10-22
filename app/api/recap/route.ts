import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import {
  compileRecap,
  fetchRecapInputs,
  recapIsEmpty,
  renderRecapHtml,
  renderRecapText,
  sendRecapEmail,
  recapSubject,
  smtpConfigured,
} from '@/lib/recap'

// Weekly Recap for the current profile (cookie-scoped, like the other APIs).
//   GET  → preview: the email as it would be sent now (?format=text|json for the alternatives)
//   POST → send it now to the profile's address (or {to} in the body)
// Neither path generates anything, and neither touches recap_last_run_at.
export const dynamic = 'force-dynamic'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

async function getProfileId(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID
}

export async function GET(req: NextRequest) {
  const profileId = await getProfileId()
  const format = req.nextUrl.searchParams.get('format') ?? 'html'
  const recap = compileRecap(await fetchRecapInputs(profileId))

  if (format === 'json') return Response.json(recap)
  if (format === 'text') {
    return new Response(renderRecapText(recap), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  if (recapIsEmpty(recap)) {
    return new Response(
      `<!doctype html><body style="font-family:Georgia,serif;padding:2rem;color:#2C2522;background:#F0ECF4">Nothing was generated in the past 7 days, so no recap would be sent this week.</body>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
  return new Response(renderRecapHtml(recap), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function POST(req: NextRequest) {
  const profileId = await getProfileId()
  const body = await req.json().catch(() => ({}))

  let to: string | null = typeof body?.to === 'string' && body.to.trim() ? body.to.trim() : null
  if (!to) {
    const { data } = await supabase.from('settings').select('email_address').eq('id', profileId).maybeSingle()
    to = data?.email_address ?? process.env.RECAP_TO ?? null
  }
  if (!to) return Response.json({ error: 'No recipient: set an email address in Settings first.' }, { status: 400 })
  if (!smtpConfigured()) return Response.json({ error: 'SMTP is not configured on the server (SMTP_USER / SMTP_PASS).' }, { status: 503 })

  const recap = compileRecap(await fetchRecapInputs(profileId))
  if (recapIsEmpty(recap)) {
    return Response.json({ status: 'empty', message: 'Nothing was generated in the past 7 days, so there is nothing to send.' })
  }

  try {
    const { messageId } = await sendRecapEmail({
      to,
      subject: recapSubject(recap),
      html: renderRecapHtml(recap),
      text: renderRecapText(recap),
    })
    return Response.json({
      status: 'sent',
      to,
      messageId,
      briefingCount: recap.briefingCount,
      digestCount: recap.digestCount,
      sections: recap.sections.map((s) => s.label),
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
