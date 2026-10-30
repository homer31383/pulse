'use client'

import { useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

// Markdown component overrides for broadsheet body copy. Georgia for
// editorial text, system sans never appears here (chrome only).
export const PRESS_MD_COMPONENTS: Components = {
  p({ children, ...props }) {
    return (
      <p className="font-georgia text-[13px] text-press-body leading-[1.65] my-2" {...props}>
        {children}
      </p>
    )
  },
  h1({ children, ...props }) {
    return (
      <h3 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink mt-4 mb-2" {...props}>
        {children}
      </h3>
    )
  },
  h2({ children, ...props }) {
    return (
      <h3 className="font-georgia text-[15px] font-normal text-press-ink mt-4 mb-1.5" {...props}>
        {children}
      </h3>
    )
  },
  h3({ children, ...props }) {
    return (
      <h3 className="font-georgia text-[15px] font-normal text-press-ink mt-4 mb-1.5" {...props}>
        {children}
      </h3>
    )
  },
  h4({ children, ...props }) {
    return (
      <h4 className="font-georgia text-[13px] font-semibold text-press-ink mt-3 mb-1" {...props}>
        {children}
      </h4>
    )
  },
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-press-accent no-underline hover:underline"
        {...props}
      >
        {children}
      </a>
    )
  },
  strong({ children, ...props }) {
    return (
      <strong className="text-press-ink font-semibold" {...props}>
        {children}
      </strong>
    )
  },
  ul({ children, ...props }) {
    return (
      <ul className="my-2 list-none pl-0 divide-y divide-press-hair" {...props}>
        {children}
      </ul>
    )
  },
  ol({ children, ...props }) {
    return (
      <ol className="my-2 list-decimal list-inside marker:text-press-muted divide-y divide-press-hair" {...props}>
        {children}
      </ol>
    )
  },
  li({ children, ...props }) {
    return (
      <li className="font-georgia text-[13px] text-press-body leading-[1.6] py-1.5" {...props}>
        {children}
      </li>
    )
  },
  blockquote({ children, ...props }) {
    return (
      <blockquote className="border-l-2 border-press-accent pl-3 my-2 italic text-press-muted" {...props}>
        {children}
      </blockquote>
    )
  },
  hr(props) {
    return <hr className="my-4 border-0 border-t-[0.5px] border-press-hair" {...props} />
  },
  code({ children, ...props }) {
    return (
      <code className="font-chrome text-[12px] text-press-accent bg-press-accent/[0.06] px-1 py-0.5 rounded-sm" {...props}>
        {children}
      </code>
    )
  },
}

import { parsePressSections, type PressSection as Section } from '@/lib/press-sections'
import { imageSearchUrl, parseArtworkHeading, type Artwork } from '@/lib/artwork-links'

// Small "Image" label after an artwork's title. The ::after grows the hit
// area to 44×44 around the label without moving anything.
function ImageSearchLink({ artwork }: { artwork: Artwork }) {
  return (
    <a
      href={imageSearchUrl(artwork)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Image search: ${artwork.title}, ${artwork.artist}`}
      className="press-label relative ml-2 align-middle whitespace-nowrap no-underline hover:underline after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
    >
      Image
    </a>
  )
}

// A heading's markdown rebuilt from its parsed tree, keeping the italics the
// artwork parser keys on ("Artist, *Title*, year").
type HastNode = { type: string; value?: string; tagName?: string; children?: HastNode[] }
function headingMarkdown(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  const inner = (node.children ?? []).map(headingMarkdown).join('')
  if (node.tagName === 'em') return `*${inner}*`
  if (node.tagName === 'strong') return `**${inner}**`
  return inner
}

// Body components for channels with artwork links: `#` headings that parse
// as "Artist, *Title*" get the Image link. Everything else is unchanged.
const ARTWORK_MD_COMPONENTS: Components = {
  ...PRESS_MD_COMPONENTS,
  h1({ node, children, ...props }) {
    const artwork = parseArtworkHeading(headingMarkdown(node as HastNode | undefined))
    return (
      <h3 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink mt-4 mb-2" {...props}>
        {children}
        {artwork && <ImageSearchLink artwork={artwork} />}
      </h3>
    )
  },
}

interface Props {
  content: string
  channelName?: string | null
  sourceDate?: string | null
  pinnable?: boolean
  // Image search links on artwork headings (see lib/artwork-links.ts)
  artworkLinks?: boolean
}

export function PressArticle({ content, channelName = null, sourceDate = null, pinnable = true, artworkLinks = false }: Props) {
  const { headline, sections } = useMemo(() => parsePressSections(content), [content])
  const mdComponents = artworkLinks ? ARTWORK_MD_COMPONENTS : PRESS_MD_COMPONENTS
  const headlineArtwork = useMemo(
    () => (artworkLinks && headline ? parseArtworkHeading(headline) : null),
    [artworkLinks, headline],
  )
  const [pinned, setPinned] = useState<Record<number, boolean>>({})
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  async function pinSection(index: number) {
    if (pinned[index]) return
    const section = sections[index]
    const text = section.title ? `## ${section.title}\n\n${section.body}` : section.body
    setPinned((prev) => ({ ...prev, [index]: true }))
    try {
      const res = await fetch('/api/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, channelName, sourceDate }),
      })
      if (!res.ok) throw new Error()
      clearTimeout(timersRef.current[index])
      timersRef.current[index] = setTimeout(() => {
        setPinned((prev) => ({ ...prev, [index]: false }))
      }, 1800)
    } catch {
      setPinned((prev) => ({ ...prev, [index]: false }))
    }
  }

  function PinButton({ index, floating = false }: { index: number; floating?: boolean }) {
    if (!pinnable) return null
    return (
      <button
        onClick={() => pinSection(index)}
        aria-label={pinned[index] ? 'Pinned' : 'Pin this section'}
        title={pinned[index] ? 'Pinned' : 'Pin this section'}
        className={[
          // 22px visible button; the ::after grows the hit area 18px up (22px
          // reached into the line above) and, in a header row, 11px each side
          // (44×40), never into the text below. A floating pin (untitled
          // section) sits over the body's first line, so it doesn't grow
          // sideways: 22×40, no overlap beyond the button.
          "relative flex-shrink-0 p-1 transition-colors after:absolute after:-top-[18px] after:bottom-0 after:content-['']",
          floating ? 'after:inset-x-0' : 'after:-inset-x-[11px]',
          pinned[index] ? 'text-press-accent' : 'text-press-pin hover:text-press-accent',
        ].join(' ')}
      >
        {pinned[index] ? (
          <svg className="w-3.5 h-3.5 animate-pin-pop" fill="currentColor" viewBox="0 0 24 24">
            <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        )}
      </button>
    )
  }

  const foldAfter = sections.length >= 5 ? Math.floor(sections.length / 2) - 1 : -1

  return (
    <article>
      {headline && (
        <h2 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink leading-snug mb-3">
          {headline}
          {headlineArtwork && <ImageSearchLink artwork={headlineArtwork} />}
        </h2>
      )}

      {sections.map((section, i) => (
        <div key={i}>
          {section.isAside ? (
            /* ── Analyst note aside ── */
            <aside className="my-4 p-[14px] bg-press-accent/[0.06] border-l-2 border-press-accent">
              <div className="flex items-center justify-between mb-1.5">
                <span className="press-label">Analyst note</span>
                <PinButton index={i} />
              </div>
              <div className="[&_p]:!text-[12px] [&_li]:!text-[12px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {section.body}
                </ReactMarkdown>
              </div>
            </aside>
          ) : (
            /* ── Standard section ── */
            <section className="my-4">
              {section.title && (
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="press-label min-w-0">{section.title}</span>
                  <div className="flex-1 press-rule-h" />
                  <PinButton index={i} />
                </div>
              )}
              {!section.title && pinnable && (
                <div className="flex justify-end -mb-5 relative z-10">
                  <PinButton index={i} floating />
                </div>
              )}
              <div className={section.body.length > 1100 ? 'press-columns' : undefined}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {section.body}
                </ReactMarkdown>
              </div>
            </section>
          )}
          {i === foldAfter && <div className="press-fold my-5" />}
        </div>
      ))}
    </article>
  )
}
