import { Suspense } from 'react'
import { ToolList } from '@/components/post-pulse/ToolList'
import { WorkflowsDisclosure } from '@/components/post-pulse/WorkflowsDisclosure'
import { fetchDepartmentBySlug, listWorkflowDocs } from '@/lib/post-pulse'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ dept?: string }>
}

// The list view is client-side over the layout's dataset snapshot; filters
// and the sidebar selection live in the query string (?dept=, ?tier=,
// ?host=, ?status=, ?q=, ?sort=). Suspense is required around
// useSearchParams(). When a department is selected this is its main page,
// so its workflow docs (spec §11) hang below the list as a collapsed
// disclosure — out of the department doc's reading flow.
export default async function ToolsPage({ searchParams }: PageProps) {
  const { dept } = await searchParams
  const department = dept ? await fetchDepartmentBySlug(dept) : null
  const workflows = department ? await listWorkflowDocs(department.id) : []
  return (
    <>
      <Suspense fallback={<div className="h-40 rounded-xl bg-cream-300/50 animate-pulse" />}>
        <ToolList />
      </Suspense>
      {department && <WorkflowsDisclosure departmentSlug={department.slug} workflows={workflows} />}
    </>
  )
}
