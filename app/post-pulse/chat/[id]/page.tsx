import { notFound } from 'next/navigation'
import { getChatSession } from '@/lib/post-pulse'
import { ChatClient } from '@/components/post-pulse/ChatClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ChatSessionPage({ params }: PageProps) {
  const { id } = await params
  const session = await getChatSession(id)
  if (!session) notFound()
  return <ChatClient session={session} />
}
