'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <div className="font-serif prose prose-sm max-w-none prose-headings:font-semibold prose-headings:font-sans prose-headings:text-ink-300 prose-p:text-ink-200 prose-p:leading-relaxed prose-li:text-ink-200 prose-strong:text-ink-300 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline prose-hr:border-cream-300 prose-code:text-brand-700 prose-code:bg-cream-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-brand-500/50 prose-blockquote:text-ink-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
