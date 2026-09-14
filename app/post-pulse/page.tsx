import { Suspense } from 'react'
import { ToolList } from '@/components/post-pulse/ToolList'

// The list view is entirely client-side over the layout's dataset snapshot;
// filters and the sidebar selection live in the query string (?dept=, ?tier=,
// ?host=, ?status=, ?q=, ?sort=). Suspense is required around
// useSearchParams() for the static shell.
export default function PostPulsePage() {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl bg-cream-300/50 animate-pulse" />}>
      <ToolList />
    </Suspense>
  )
}
