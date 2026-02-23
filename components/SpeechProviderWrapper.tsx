'use client'

import { SpeechProvider } from '@/contexts/SpeechContext'

export function SpeechProviderWrapper({ children }: { children: React.ReactNode }) {
  return <SpeechProvider>{children}</SpeechProvider>
}
