// Shell for the research chat (spec §6). The backend (Claude with the
// web_search tool, scoped to the pp_* dataset) is a follow-up pass. When it
// lands, every proposal it makes must go through pp_queue, never a direct
// pp_tools write, so the review queue is the only publish path from chat.
export default function ChatStubPage() {
  return (
    <div className="max-w-2xl">
      <header className="mb-5">
        <h1 className="font-display text-2xl text-ink-300">Research chat</h1>
        <p className="text-sm text-ink-100 mt-1">
          Ask about a tool, add a missing department, or check something you heard about. Anything it proposes lands
          in the review queue.
        </p>
      </header>

      <div className="rounded-xl border border-dashed border-cream-400 bg-cream-50/60 px-5 py-8 text-center">
        <p className="text-sm text-ink-200">Not wired up yet.</p>
        <p className="text-xs text-ink-50 mt-1">The chat backend (Claude + web search) is the next pass.</p>
      </div>

      <div className="mt-4 flex gap-2">
        <textarea
          disabled
          rows={2}
          placeholder="What does Beeble actually do, and where would it fit?"
          className="flex-1 rounded-xl border border-cream-300 bg-cream-100 px-3 py-2 text-sm text-ink-300 placeholder:text-ink-50 resize-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          className="self-end px-4 py-2 rounded-xl bg-press-accent text-white text-sm font-medium opacity-40 cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  )
}
