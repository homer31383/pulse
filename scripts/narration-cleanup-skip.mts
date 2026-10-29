// Rows the pre-heading narration cleanup must leave alone, by id, with why.
// Shared by narration-cleanup-dryrun.mts and narration-cleanup-apply.mts so
// the two can't disagree.
export const NARRATION_SKIP: ReadonlyMap<string, string> = new Map([
  [
    // Classic Movies, Jul 27 2026 (Seven Samurai). Its narration says web
    // search hit a usage limit and the briefing was written from established
    // film history with no fresh citations. Kept as stored so that record of
    // how the briefing was made survives with the row. The body also says it,
    // in a blockquote under the date line ("A quick note on sourcing: ...").
    'c3544b17-dbf3-425f-9c21-1375360a48c7',
    'narration records that search was unavailable and nothing was freshly cited',
  ],
])
