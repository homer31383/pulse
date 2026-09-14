import { NextRequest } from 'next/server'

// Stub for the Post Pulse research chat (spec §6). The real endpoint will
// stream a Claude conversation with the web_search tool, scoped to the
// pp_* dataset, and file EVERY proposal it makes through enqueueProposal()
// in lib/post-pulse.ts — never a direct pp_tools write, even mid-conversation.
export async function POST(_req: NextRequest) {
  return Response.json(
    {
      error: 'Post Pulse chat is not implemented yet',
      note: 'Proposals from chat must land in pp_queue for review; see POST_PULSE_SPEC.md §6.',
    },
    { status: 501 }
  )
}
