import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { generateProfileDigest } from '@/lib/generation'
import type { Channel } from '@/lib/types'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export async function POST(req: NextRequest) {
  const { channels }: { channels: Channel[] } = await req.json()

  if (!channels?.length) {
    return Response.json({ error: 'No channels provided' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const result = await generateProfileDigest({
          channels,
          profileId,
          onEvent: send,
        })
        send({ type: 'done', briefingId: result.id, usage: result.usage })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Digest generation failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
