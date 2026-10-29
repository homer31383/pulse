// "Export channel as PDF".
//   GET  ?range=all|30|90|custom&from&to&order  -> what the selection holds
//        (count, estimated pages, limits, date splits when it's too big)
//   POST {range, from?, to?, order}             -> NDJSON stream: progress
//        lines, then one of ready / empty / too_large / error
// The channel must belong to the cookie's profile. The PDF is built in this
// request (the largest export fits well inside maxDuration), stored in the
// private pdf-exports bucket under the profile and a hash of the selection,
// and handed back as a short-lived signed URL. An unchanged selection reuses
// the stored file. Reads briefings only: nothing is marked read, the queue is
// untouched, and no model or TTS API is called.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  MAX_BRIEFINGS, MAX_PAGES, SIGNED_URL_TTL_S,
  cachedExists, downloadName, exportPath, fetchExportBriefings, ownedChannel,
  parseExportRequest, rangeLabel, signedDownloadUrl, splitByDate, storeExport, summarize,
} from '@/lib/channel-export'
import { ChannelPdfTooLarge, renderChannelPdf } from '@/lib/pdf/channel-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Measured Oct 28 2026: a 400-page export (the page cap) takes ~28 s locally
export const maxDuration = 300

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

type Params = { params: Promise<{ id: string }> }

async function resolve(id: string) {
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const channel = await ownedChannel(profileId, id)
  return { profileId, channel }
}

const notFound = () => NextResponse.json({ error: 'Channel not found' }, { status: 404 })

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const parsed = parseExportRequest(Object.fromEntries(req.nextUrl.searchParams))
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const { profileId, channel } = await resolve(id)
  if (!channel) return notFound()

  const briefings = await fetchExportBriefings(channel.id, parsed)
  const summary = summarize(briefings)
  let cached = false
  if (briefings.length && !summary.overLimit) {
    cached = await cachedExists(exportPath(profileId, channel, parsed, briefings)).catch(() => false)
  }
  return NextResponse.json({ channel: channel.name, rangeLabel: rangeLabel(parsed.range), ...summary, cached })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseExportRequest(body)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const { profileId, channel } = await resolve(id)
  if (!channel) return notFound()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      try {
        send({ type: 'progress', phase: 'loading', done: 0, total: 0 })
        const briefings = await fetchExportBriefings(channel.id, parsed)
        if (!briefings.length) {
          send({ type: 'empty', message: `No ${channel.name} briefings in this range, so there is nothing to export.` })
          return
        }
        const summary = summarize(briefings)
        if (briefings.length > MAX_BRIEFINGS) {
          send({ type: 'too_large', message: summary.overLimit, splits: summary.splits })
          return
        }

        const path = exportPath(profileId, channel, parsed, briefings)
        const filename = downloadName(channel.name, briefings)
        if (await cachedExists(path)) {
          send({ type: 'ready', url: await signedDownloadUrl(path, filename), filename, cached: true, expiresIn: SIGNED_URL_TTL_S })
          return
        }

        let result
        try {
          result = await renderChannelPdf(
            { channelName: channel.name, rangeLabel: rangeLabel(parsed.range), briefings },
            { maxPages: MAX_PAGES, onProgress: (p) => send({ type: 'progress', ...p }) },
          )
        } catch (err) {
          if (err instanceof ChannelPdfTooLarge) {
            send({
              type: 'too_large',
              message: `This selection comes to ${err.pageCount} pages, more than one export can hold (${MAX_PAGES}).`,
              pages: err.pageCount,
              splits: splitByDate(briefings, err.briefingPages),
            })
            return
          }
          throw err
        }

        send({ type: 'progress', phase: 'saving', done: 0, total: 0 })
        await storeExport(path, result.pdf)
        console.log(`[export] ${channel.name}: ${briefings.length} briefings, ${result.pageCount} pages, ${result.pdf.length} bytes`)
        send({
          type: 'ready',
          url: await signedDownloadUrl(path, filename),
          filename,
          cached: false,
          pages: result.pageCount,
          bytes: result.pdf.length,
          expiresIn: SIGNED_URL_TTL_S,
          notes: [...result.notes].map(([what, count]) => ({ what, count })),
        })
      } catch (err) {
        console.error('[export] failed:', err)
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
