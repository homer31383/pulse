import { notFound } from 'next/navigation'
import { getChatSession, getWorkflowDoc } from '@/lib/post-pulse'
import { ChatClient } from '@/components/post-pulse/ChatClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ rerun?: string }>
}

// ?rerun=<workflow doc id> submits that doc's saved prompt as a new turn
// (spec §11 "Re-run"); the saved doc is never overwritten from here.
export default async function ChatSessionPage({ params, searchParams }: PageProps) {
  const [{ id }, { rerun }] = await Promise.all([params, searchParams])
  const session = await getChatSession(id)
  if (!session) notFound()
  const rerunDoc = rerun ? await getWorkflowDoc(rerun) : null
  return (
    <ChatClient
      session={session}
      rerun={rerunDoc ? { docId: rerunDoc.id, title: rerunDoc.title, prompt: rerunDoc.prompt, departmentId: rerunDoc.department_id } : null}
    />
  )
}
