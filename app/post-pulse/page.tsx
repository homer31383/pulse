import { PipelineMap } from '@/components/post-pulse/PipelineMap'

// Landing view: the four-stage pipeline flowchart (migration 022). The
// tool list moved to /post-pulse/tools and is reached from a department
// doc or the sidebar.
export default function PostPulsePage() {
  return <PipelineMap />
}
