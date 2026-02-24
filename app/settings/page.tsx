import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { SettingsClient } from '@/components/SettingsClient'
import { SETTINGS_DEFAULTS } from '@/app/api/settings/route'
import type { AppSettings } from '@/lib/types'

export default async function SettingsPage() {
  const { data } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 'default')
    .single()

  const settings = (data as AppSettings | null) ?? SETTINGS_DEFAULTS

  return (
    <div className="min-h-screen bg-cream-200">
      <header className="sticky top-0 z-20 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-300 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="font-display text-lg font-normal text-ink-300">Settings</h1>
        </div>
      </header>

      <SettingsClient initialSettings={settings} />
    </div>
  )
}
