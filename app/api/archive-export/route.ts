// "Channel archive": several channels' briefings as one PDF, or as volumes.
//   GET  ?channels=id,id&range&from&to&order  -> what the selection holds
//        (per-channel counts, estimated pages and volumes)
//   POST {channels, range, from?, to?, order, volumes?, expectVolumes?}
//        -> NDJSON stream: progress lines (phase loading / plan / layout /
//        draw / saving, with the volume), one plan, a volume_ready per
//        volume, then done (or empty / too_many / error). Volumes that won't
//        fit the rest of this request's time come back as pending; POST
//        again with volumes: [index] (and expectVolumes) to build them.
// Every channel id must belong to the cookie's profile, or the whole request
// is refused. One volume renders in ~12 s locally at the 400-page cap (Oct 28
// 2026), well inside maxDuration. Volumes are cached in the private
// pdf-exports bucket by a hash of what they show and handed back as
// short-lived signed URLs. Reads briefings only: nothing is marked read, the
// queue is untouched, and no model or TTS API is called.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { cachedExists, MAX_BRIEFINGS, MAX_PAGES, rangeLabel, signedDownloadUrl, SIGNED_URL_TTL_S } from '@/lib/channel-export'
import {
  archiveDownloadName, archiveVolumePath, fetchArchiveInput, ownedChannels,
  parseArchiveRequest, storeArchive, summarizeArchive,
} from '@/lib/archive-export'
import { layoutArchive, renderArchiveVolume } from '@/lib/pdf/archive-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// A volume starts only if its predicted time still ends within this much of
// maxDuration. PULSE_ARCHIVE_BUDGET_MS overrides it (tests force pending
// volumes with a tiny budget).
const BUDGET_MS = Number(process.env.PULSE_ARCHIVE_BUDGET_MS) || 240_000
const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

async function resolve(ids: string[]) {
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  return { profileId, channels: await ownedChannels(profileId, ids) }
}

const refused = () => NextResponse.json({ error: 'Channel not found' }, { status: 404 })

export async function GET(req: NextRequest) {
  const parsed = parseArchiveRequest(Object.fromEntries(req.nextUrl.searchParams))
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const { channels } = await resolve(parsed.channelIds)
  if (!channels) return refused()
  const input = await fetchArchiveInput(channels, parsed)
  return NextResponse.json({ rangeLabel: rangeLabel(parsed.range), ...summarizeArchive(input) })
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseArchiveRequest(body)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const wanted = Array.isArray(body.volumes) ? new Set(body.volumes.map(Number).filter(Number.isInteger)) : null
  const expectVolumes = typeof body.expectVolumes === 'number' ? body.expectVolumes : null
  const { profileId, channels } = await resolve(parsed.channelIds)
  if (!channels) return refused()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      // Layout and drawing are CPU-bound and never give the event loop a
      // turn, so a progress line queued there only reaches the client when
      // the work ends. Yielding a macrotask after each one lets it flush.
      const progress = async (event: Record<string, unknown>) => {
        send({ type: 'progress', ...event })
        await new Promise((resolve) => setImmediate(resolve))
      }
      try {
        send({ type: 'progress', phase: 'loading', done: 0, total: 0 })
        const input = await fetchArchiveInput(channels, parsed)
        const summary = summarizeArchive(input)
        if (!summary.count) {
          send({ type: 'empty', message: 'No briefings in this range for these channels, so there is nothing to export.' })
          return
        }
        if (summary.tooMany) {
          send({ type: 'too_many', message: summary.tooMany })
          return
        }

        // The plan: every briefing laid out once, volumes from exact pages
        const layoutStart = Date.now()
        const layout = await layoutArchive(input, { maxPages: MAX_PAGES, maxBriefings: MAX_BRIEFINGS },
          (p) => progress({ phase: 'plan', done: p.done, total: p.total }))
        const msPerBriefing = (Date.now() - layoutStart) / summary.count
        const volumes = layout.volumes.length
        if (expectVolumes !== null && expectVolumes !== volumes) {
          send({ type: 'error', message: 'The selection changed since the volumes were planned. Generate again.' })
          return
        }
        const paths = layout.volumes.map((_, i) => archiveVolumePath(profileId, layout, i, parsed))
        send({
          type: 'plan',
          volumes: layout.volumes.map((v, i) => ({
            index: i,
            filename: archiveDownloadName(layout, i),
            pages: v.pages,
            briefings: v.briefings,
            channels: [...new Set(v.parts.map((p) => layout.channels[p.channel].name))],
          })),
          skipped: summary.empty,
        })

        const pending: number[] = []
        for (let i = 0; i < volumes; i++) {
          if (wanted && !wanted.has(i)) continue
          const filename = archiveDownloadName(layout, i)
          if (await cachedExists(paths[i])) {
            send({ type: 'volume_ready', index: i, url: await signedDownloadUrl(paths[i], filename), filename, pages: layout.volumes[i].pages, cached: true, expiresIn: SIGNED_URL_TTL_S })
            continue
          }
          // Re-layout plus drawing costs about twice the plan's layout time
          const predicted = msPerBriefing * layout.volumes[i].briefings * 2.5
          if (pending.length || Date.now() - started + predicted > BUDGET_MS) { pending.push(i); continue }

          const result = await renderArchiveVolume(layout, i, { rangeLabel: rangeLabel(parsed.range) },
            (p) => progress({ volume: i, ...p }))
          send({ type: 'progress', volume: i, phase: 'saving', done: 0, total: 0 })
          await storeArchive(paths[i], result.pdf, paths)
          console.log(`[archive-export] volume ${i + 1} of ${volumes}: ${layout.volumes[i].briefings} briefings, ${result.pageCount} pages, ${result.pdf.length} bytes`)
          send({
            type: 'volume_ready', index: i, url: await signedDownloadUrl(paths[i], filename), filename,
            pages: result.pageCount, bytes: result.pdf.length, cached: false, expiresIn: SIGNED_URL_TTL_S,
          })
        }
        if (pending.length) send({ type: 'pending', volumes: pending, expectVolumes: volumes })
        send({ type: 'done', notes: [...layout.notes].map(([what, count]) => ({ what, count })) })
      } catch (err) {
        console.error('[archive-export] failed:', err)
        send({ type: 'error', message: (err as Error).message || 'Export failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
