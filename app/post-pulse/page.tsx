import { cookies } from 'next/headers'
import { PipelineMap } from '@/components/post-pulse/PipelineMap'
import { CatchupPanel } from '@/components/post-pulse/CatchupPanel'
import { fetchCatchup } from '@/lib/post-pulse-catchup'
import type { Catchup } from '@/lib/post-pulse-catchup-types'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

// Landing view: the "While you were away" catch-up panel (profile-scoped,
// compile only — lib/post-pulse-catchup.ts never calls the model), then the
// four-stage pipeline flowchart (migration 022). The tool list moved to
// /post-pulse/tools and is reached from a department doc or the sidebar.
export default async function PostPulsePage() {
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  let catchup: Catchup | null = null
  try {
    catchup = await fetchCatchup(profileId)
  } catch (err) {
    // The panel is a convenience: a failure (most likely migration 034 not
    // applied yet) must not take the pipeline map down with it.
    console.warn(`[catchup] panel skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
  return (
    <>
      {catchup && <CatchupPanel data={catchup} />}
      <PipelineMap />
    </>
  )
}
