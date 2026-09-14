import { listChatSessions } from '@/lib/post-pulse'
import { ChatSessionsClient } from '@/components/post-pulse/ChatSessionsClient'

export const dynamic = 'force-dynamic'

// Research chat (spec §6): the session list. Sessions are named and
// resumable; new ones start here (optionally scoped to a department) or
// in-context from a department doc via /post-pulse/chat/start?dept=slug.
export default async function ChatSessionsPage() {
  const sessions = await listChatSessions()
  return <ChatSessionsClient sessions={sessions} />
}
