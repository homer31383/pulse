import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { fetchPostPulseDataset } from '@/lib/post-pulse'
import { fetchInterestState } from '@/lib/post-pulse-interest'
import type { PpInterestState } from '@/lib/post-pulse-interest-types'
import { PostPulseShell } from '@/components/post-pulse/Shell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Post Pulse',
  description: 'AI tools across the VFX pipeline — what exists, where it fits, what changed',
}

// Loads the whole pp_* dataset once per navigation. It's small (tens of
// tools), so the sidebar, list, and compare overlay run client-side from
// this snapshot. router.refresh() after a queue action re-fetches it.
// The cookie profile's stars (migration 038) load here too, so every view
// shares one star state; fetchInterestState also runs the stars' lazy
// cleanup (lib/post-pulse-interest.ts).
const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'
const NO_STARS: PpInterestState = { tools: [], departments: [], queueItems: [], pending: [], collapsed: false }

export default async function PostPulseLayout({ children }: { children: React.ReactNode }) {
  let data
  try {
    data = await fetchPostPulseDataset()
  } catch (err) {
    // Most likely migration 021 hasn't been run yet: say so instead of a 500.
    const message = err instanceof Error ? err.message : String(err)
    return (
      <div className="min-h-screen bg-cream-200 text-ink-300 flex items-center justify-center px-6">
        <div className="max-w-md rounded-xl border border-cream-300 bg-cream-50 px-5 py-4">
          <h1 className="font-display text-lg">Post Pulse isn&apos;t set up yet</h1>
          <p className="text-sm text-ink-100 mt-2">
            Run <code className="text-brand-700">supabase/migrations/021_post_pulse.sql</code> and then{' '}
            <code className="text-brand-700">supabase/seed_post_pulse.sql</code> in the Supabase SQL editor.
          </p>
          <p className="text-xs text-ink-50 mt-3 break-words">{message}</p>
        </div>
      </div>
    )
  }
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  let interest = NO_STARS
  try {
    interest = await fetchInterestState(profileId, data)
  } catch (err) {
    // Stars are a convenience: never take Post-Pulse down with them
    console.warn(`[interest] stars skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
  return (
    <PostPulseShell data={data} interest={interest}>
      {children}
    </PostPulseShell>
  )
}
