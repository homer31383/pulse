import { fetchPendingQueue } from '@/lib/post-pulse'
import { QueueClient } from '@/components/post-pulse/QueueClient'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const items = await fetchPendingQueue()
  return (
    <div className="max-w-3xl">
      <header className="mb-5">
        <h1 className="font-display text-2xl text-ink-300">Review queue</h1>
        <p className="text-sm text-ink-100 mt-1">
          Proposed changes waiting for a decision. Accepting writes the tool and records the change; rejecting just
          closes the item.
        </p>
      </header>
      <QueueClient items={items} />
    </div>
  )
}
