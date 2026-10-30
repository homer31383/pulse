'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// Back / Forward through the browser's own history, like a browser's
// buttons. They call history.back() / history.forward(), so the browser (and
// Next's app router, which handles popstate) restores scroll and page state
// exactly as the system back gesture would. There is no separate stack to
// disagree with it.
//
// Enabled state:
// - Navigation API (window.navigation) where it exists: canGoBack /
//   canGoForward, refreshed on currententrychange. Its entries only cover
//   this origin, so Back is disabled on the app's first page even when the
//   tab came from another site, and it can never leave the app.
// - Elsewhere, HistoryTracker (mounted once in the root layout) keeps this
//   tab's visited URLs and the current position in sessionStorage. It reads
//   Next's navigations (pathname + search) and popstate; it never writes
//   history.state (Next owns it) and never patches pushState. When it can't
//   tell where a traversal landed it resets to "first page", so a wrong guess
//   disables Back rather than letting it leave the app.

const KEY = 'pulse-history-nav'
const PENDING_KEY = 'pulse-history-nav:pending' // direction of a traversal our buttons started
const CHANGE_EVENT = 'pulse-history-nav'

interface NavigationLike extends EventTarget {
  canGoBack: boolean
  canGoForward: boolean
}

function navigationApi(): NavigationLike | null {
  if (typeof window === 'undefined') return null
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation
  return nav && typeof nav.canGoBack === 'boolean' ? nav : null
}

// ── Fallback record (no Navigation API) ─────────────────────────────────────

interface HistoryRecord {
  urls: string[]
  index: number
}

function readRecord(): HistoryRecord | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (r && Array.isArray(r.urls) && Number.isInteger(r.index) && r.index >= 0 && r.index < r.urls.length) return r
  } catch {}
  return null
}

function writeRecord(r: HistoryRecord) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r))
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function takePending(): 'back' | 'forward' | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    return v === 'back' || v === 'forward' ? v : null
  } catch {
    return null
  }
}

// A traversal landed on `url`: step the position if it matches the entry
// before or after. A multi-step jump (the browser's long-press history menu)
// is followed only when the URL appears once in the record; otherwise start
// over at this page (Back disabled).
function settle(rec: HistoryRecord, url: string): HistoryRecord {
  const dir = takePending()
  const before = rec.urls[rec.index - 1] === url
  const after = rec.urls[rec.index + 1] === url
  if (dir === 'forward' && after) return { ...rec, index: rec.index + 1 }
  if (before) return { ...rec, index: rec.index - 1 }
  if (after) return { ...rec, index: rec.index + 1 }
  const at = rec.urls.indexOf(url)
  if (at >= 0 && rec.urls.lastIndexOf(url) === at) return { ...rec, index: at }
  return { urls: [url], index: 0 }
}

function push(rec: HistoryRecord | null, url: string): HistoryRecord {
  if (!rec) return { urls: [url], index: 0 }
  if (rec.urls[rec.index] === url) return rec
  const urls = [...rec.urls.slice(0, rec.index + 1), url].slice(-100)
  return { urls, index: urls.length - 1 }
}

// Set by popstate (a traversal), read by the next URL change. Registered at
// module load and in the capture phase so it runs before the app router's own
// popstate listener, which can re-render (and run the effect below) before a
// listener added later would fire.
let popped = false
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { popped = true }, true)
}

// Mounted once in the root layout (inside Suspense, for useSearchParams).
// Does nothing where the Navigation API exists.
export function HistoryTracker() {
  const pathname = usePathname()
  const search = useSearchParams()
  const first = useRef(true)

  useEffect(() => {
    if (navigationApi()) return
    const url = window.location.pathname + window.location.search
    const rec = readRecord()
    if (first.current) {
      // A document load: a fresh tab or app launch, a reload, a traversal
      // back into the app from another site, or a full-page load of a link.
      first.current = false
      popped = false
      const type = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
      if (!rec || window.history.length <= 1) return writeRecord({ urls: [url], index: 0 })
      if (rec.urls[rec.index] === url) return writeRecord(rec) // reload
      return writeRecord(type === 'back_forward' ? settle(rec, url) : push(rec, url))
    }
    if (popped) {
      popped = false
      return writeRecord(settle(rec ?? { urls: [url], index: 0 }, url))
    }
    const next = push(rec, url)
    if (next !== rec) writeRecord(next)
  }, [pathname, search])

  return null
}

// ── Enabled state ────────────────────────────────────────────────────────────

function useHistoryNav() {
  // Both disabled until mounted: same size either way, so no layout shift.
  const [state, setState] = useState({ canBack: false, canForward: false })
  useEffect(() => {
    const nav = navigationApi()
    const update = () => {
      if (nav) {
        setState({ canBack: nav.canGoBack, canForward: nav.canGoForward })
        return
      }
      const rec = readRecord()
      setState({
        canBack: !!rec && rec.index > 0 && window.history.length > 1,
        canForward: !!rec && rec.index < rec.urls.length - 1,
      })
    }
    update()
    // currententrychange fires once the new entry is current (push, replace or
    // traversal), so canGoBack/canGoForward are already up to date there;
    // `navigate` fires before that and would read the old values. It fires
    // synchronously inside Next's history push, which runs in a React
    // insertion effect where setState is not allowed, so update a tick later.
    const deferred = () => queueMicrotask(update)
    const target: EventTarget = nav ?? window
    const events = nav ? ['currententrychange', 'navigatesuccess'] : [CHANGE_EVENT]
    for (const e of events) target.addEventListener(e, deferred)
    return () => {
      for (const e of events) target.removeEventListener(e, deferred)
    }
  }, [])
  return state
}

function go(dir: 'back' | 'forward') {
  if (!navigationApi()) {
    try {
      sessionStorage.setItem(PENDING_KEY, dir)
    } catch {}
  }
  if (dir === 'back') window.history.back()
  else window.history.forward()
}

// Arrows, not chevrons: the headers' chevron is the "up to the parent page"
// link, and the reading view's text buttons are Previous / Next story.
function HistoryButton({ label, enabled, onClick, d }: { label: string; enabled: boolean; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={label}
      title={label}
      // 32px circle; the ::after grows the hit area to 44×44. 12px apart, so
      // the two hit areas meet without overlapping.
      className={[
        "relative w-8 h-8 flex items-center justify-center rounded-full transition-colors after:absolute after:-inset-1.5 after:content-['']",
        enabled ? 'text-press-accent hover:bg-press-accent/10' : 'text-press-faint cursor-default',
      ].join(' ')}
    >
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d} />
      </svg>
    </button>
  )
}

export function HistoryNav({ className = '' }: { className?: string }) {
  const { canBack, canForward } = useHistoryNav()
  return (
    <div role="group" aria-label="History" className={`flex items-center gap-3 flex-shrink-0 ${className}`}>
      <HistoryButton label="Back" enabled={canBack} onClick={() => canBack && go('back')} d="M19 12H5m6-6l-6 6 6 6" />
      <HistoryButton label="Forward" enabled={canForward} onClick={() => canForward && go('forward')} d="M5 12h14m-6-6l6 6-6 6" />
    </div>
  )
}
