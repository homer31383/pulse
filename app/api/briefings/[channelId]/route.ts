import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { generateChannelBriefing } from '@/lib/generation'
import type { Channel } from '@/lib/types'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

interface Params {
  params: Promise<{ channelId: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const { channelId } = await params
  const { channel }: { channel: Channel } = await req.json()
  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const result = await generateChannelBriefing({
          channel: { ...channel, id: channelId },
          profileId,
          onEvent: send,
        })
        send({ type: 'done', briefingId: result.id, usage: result.usage })
      } catch (err) {
        send({
          type: 'error',
          error: err instanceof Error ? err.message : 'Briefing generation failed',
        })
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
