// Serves a cached premium-audio object from Supabase Storage through the app's
// own origin, with HTTP Range support so <audio> can seek. Chrome's media
// pipeline stalled on the storage signed-download URL; a same-origin stream
// with explicit Content-Length / Accept-Ranges plays and scrubs reliably.
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { TTS_BUCKET } from '@/lib/tts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const { data: row } = await supabase.from('tts_audio').select('storage_path').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: blob, error } = await supabase.storage.from(TTS_BUCKET).download(row.storage_path)
  if (error || !blob) return NextResponse.json({ error: error?.message ?? 'Audio missing' }, { status: 404 })

  const total = blob.size
  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }

  const range = req.headers.get('range')
  const m = range?.match(/^bytes=(\d*)-(\d*)$/)
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
    if (start >= total || start > end) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
    }
    const part = blob.slice(start, end + 1)
    return new NextResponse(part.stream(), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1) },
    })
  }

  return new NextResponse(blob.stream(), { status: 200, headers: { ...headers, 'Content-Length': String(total) } })
}
