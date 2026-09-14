'use client'

import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { slugifyHeading } from '@/lib/post-pulse-types'
import { MARKDOWN_COMPONENTS } from '@/components/MarkdownRenderer'

// Department docs are markdown whose headings get stable ids so tool
// entries can deep-link into them. A heading may pin its own id with a
// trailing `{#my-id}` (stripped from the rendered text); otherwise the id
// is the slugified heading text.
const ANCHOR_RE = /\s*\{#([a-z0-9-]+)\}\s*$/i

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: React.ReactNode } }).props.children)
  }
  return ''
}

function stripAnchor(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') return children.replace(ANCHOR_RE, '')
  if (Array.isArray(children)) {
    const last = children[children.length - 1]
    if (typeof last === 'string') return [...children.slice(0, -1), last.replace(ANCHOR_RE, '')]
  }
  return children
}

function headingId(children: React.ReactNode): string {
  const raw = textOf(children)
  const m = raw.match(ANCHOR_RE)
  return m ? m[1].toLowerCase() : slugifyHeading(raw)
}

function Heading({ level, children }: { level: 1 | 2 | 3 | 4; children: React.ReactNode }) {
  const id = headingId(children)
  const Tag = `h${level}` as const
  return (
    <Tag id={id} className="group scroll-mt-20 target:text-press-accent">
      <a href={`#${id}`} className="!no-underline !text-inherit">
        {stripAnchor(children)}
      </a>
      <span className="ml-2 text-ink-50/0 group-hover:text-ink-50/70 text-sm font-normal select-none" aria-hidden>
        #
      </span>
    </Tag>
  )
}

const COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  h1: ({ children }) => <Heading level={1}>{children}</Heading>,
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  h4: ({ children }) => <Heading level={4}>{children}</Heading>,
}

interface Props {
  content: string
}

export function AnchoredMarkdown({ content }: Props) {
  // Client-side navigation doesn't always re-run the browser's hash jump,
  // so nudge it once the markdown has rendered.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    // Next's own post-navigation scroll (to top) runs after commit; wait a
    // frame so the hash jump lands last.
    const t = setTimeout(() => {
      const el = document.getElementById(hash)
      if (el) el.scrollIntoView({ block: 'start' })
    }, 60)
    return () => clearTimeout(t)
  }, [content])

  return (
    <div className="font-serif prose prose-sm sm:prose-base max-w-none prose-headings:font-sans prose-headings:font-semibold prose-headings:text-ink-300 prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-2 prose-h2:pt-4 prose-h2:border-t prose-h2:border-cream-300 prose-h3:text-base prose-p:text-ink-200 prose-p:leading-relaxed prose-li:text-ink-200 prose-strong:text-ink-300 prose-a:text-press-accent prose-a:no-underline hover:prose-a:underline prose-hr:border-cream-300 prose-blockquote:border-press-accent/40 prose-blockquote:text-ink-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
