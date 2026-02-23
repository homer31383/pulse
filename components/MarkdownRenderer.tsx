'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <div className="font-serif prose prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:font-sans prose-headings:text-warm-100 prose-p:text-warm-300 prose-p:leading-relaxed prose-li:text-warm-300 prose-strong:text-warm-100 prose-a:text-brand-400 prose-a:no-underline hover:prose-a:underline prose-hr:border-warm-700 prose-code:text-brand-300 prose-code:bg-warm-900/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-brand-500/50 prose-blockquote:text-warm-400">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
