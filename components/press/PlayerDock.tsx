'use client'

import { MiniPlayer } from './MiniPlayer'
import { ExpandedPlayer } from './ExpandedPlayer'

// Mounted once in the root layout, above every page: the collapsed bar and
// the expanded sheet share the queue provider's state.
export function PlayerDock() {
  return (
    <>
      <MiniPlayer />
      <ExpandedPlayer />
    </>
  )
}
