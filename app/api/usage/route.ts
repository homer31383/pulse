import { supabase } from '@/lib/supabase'

export interface UsageData {
  totals: {
    today:   number
    week:    number
    month:   number
    year:    number
    allTime: number
  }
  daily:     Array<{ date: string; cost: number }>   // last 30 days
  byChannel: Array<{ channelName: string; cost: number; calls: number }>
}

export async function GET() {
  const now = new Date()
  const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1)
  const yearStart   = new Date(now.getFullYear(), 0, 1)

  // Week starts on Monday
  const weekStart = new Date(todayStart)
  const dow = weekStart.getDay()
  weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1))

  // Fetch this year's logs (covers today/week/month/year + daily chart)
  const [yearResult, allTimeResult] = await Promise.all([
    supabase
      .from('usage_logs')
      .select('cost_usd, created_at, channel_name')
      .gte('created_at', yearStart.toISOString())
      .order('created_at', { ascending: true }),
    supabase
      .from('usage_logs')
      .select('cost_usd'),
  ])

  const logs       = yearResult.data  ?? []
  const allLogs    = allTimeResult.data ?? []

  // ── Time-period totals ────────────────────────────────────────────────────
  const sum = (filter: (d: Date) => boolean) =>
    logs
      .filter((r) => filter(new Date(r.created_at)))
      .reduce((s, r) => s + Number(r.cost_usd), 0)

  const totals = {
    today:   sum((d) => d >= todayStart),
    week:    sum((d) => d >= weekStart),
    month:   sum((d) => d >= monthStart),
    year:    logs.reduce((s, r) => s + Number(r.cost_usd), 0),
    allTime: allLogs.reduce((s, r) => s + Number(r.cost_usd), 0),
  }

  // ── Daily chart — last 30 days ────────────────────────────────────────────
  const chartStart = new Date(todayStart)
  chartStart.setDate(chartStart.getDate() - 29)

  const dailyMap = new Map<string, number>()
  for (let i = 0; i < 30; i++) {
    const d = new Date(chartStart)
    d.setDate(d.getDate() + i)
    dailyMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (const r of logs) {
    const day = r.created_at.slice(0, 10)
    if (dailyMap.has(day)) {
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + Number(r.cost_usd))
    }
  }
  const daily = Array.from(dailyMap.entries()).map(([date, cost]) => ({ date, cost }))

  // ── Per-channel breakdown ─────────────────────────────────────────────────
  const channelMap = new Map<string, { cost: number; calls: number }>()
  for (const r of logs) {
    if (!r.channel_name) continue
    const cur = channelMap.get(r.channel_name) ?? { cost: 0, calls: 0 }
    channelMap.set(r.channel_name, {
      cost:  cur.cost + Number(r.cost_usd),
      calls: cur.calls + 1,
    })
  }
  const byChannel = Array.from(channelMap.entries())
    .map(([channelName, { cost, calls }]) => ({ channelName, cost, calls }))
    .sort((a, b) => b.cost - a.cost)

  return Response.json({ totals, daily, byChannel } satisfies UsageData)
}
