'use client'

import { SpeechProvider } from '@/contexts/SpeechContext'
import { QueueProvider } from '@/contexts/QueueContext'
import { PlayerDock } from '@/components/press/PlayerDock'

// Speech (per-item player) + Listen Queue (playlist above it) live at the
// root so audio survives navigation; the player dock (mini bar + expanded
// sheet) renders on every page while the queue is non-empty.
export function SpeechProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SpeechProvider>
      <QueueProvider>
        {children}
        <PlayerDock />
      </QueueProvider>
    </SpeechProvider>
  )
}
