import { redirect } from 'next/navigation'
import { createChatSession, fetchDepartmentBySlug, findLatestDepartmentSession } from '@/lib/post-pulse'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ dept?: string; fresh?: string; rerun?: string }>
}

// In-context launch from a department doc. Resumes the most recent session
// already scoped to that department when one exists — the research on a
// department accumulates, and a new empty session per click would litter
// the list — and creates one otherwise. ?fresh=1 forces a new session.
export default async function ChatStartPage({ searchParams }: PageProps) {
  const { dept, fresh, rerun } = await searchParams
  const department = dept ? await fetchDepartmentBySlug(dept) : null
  if (!department) redirect('/post-pulse/chat')
  const suffix = rerun ? `?rerun=${encodeURIComponent(rerun)}` : ''

  if (!fresh) {
    const existing = await findLatestDepartmentSession(department.id)
    if (existing) redirect(`/post-pulse/chat/${existing.id}${suffix}`)
  }
  const session = await createChatSession({
    name: `${department.name} research`,
    departmentContextId: department.id,
  })
  redirect(`/post-pulse/chat/${session.id}${suffix}`)
}
