// Broadsheet masthead — thin rule, PULSE nameplate, subtitle, heavy rule, dateline
export function Masthead({ dateline = 'Brooklyn, New York' }: { dateline?: string }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4">
      <div className="press-rule-h" />
      <h1 className="font-georgia text-[32px] font-normal uppercase tracking-[2px] text-center text-press-ink leading-tight mt-2">
        Pulse
      </h1>
      <p className="font-chrome text-[9px] uppercase tracking-[3px] text-press-muted text-center mt-1 mb-2">
        Your morning intelligence briefing
      </p>
      <div className="border-b-2 border-press-ink" />
      <div className="flex items-center justify-between font-chrome text-[10px] uppercase tracking-[1px] text-press-muted py-1.5">
        <span>{dateline}</span>
        <span suppressHydrationWarning>{today}</span>
      </div>
      <div className="press-rule-h" />
    </div>
  )
}
