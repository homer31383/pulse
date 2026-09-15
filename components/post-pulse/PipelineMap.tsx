'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  PP_PIPELINE_STAGES,
  PP_PIPELINE_SUBSTAGES,
  type PpDepartment,
  type PpPipelineStage,
  type PpPipelineSubstage,
} from '@/lib/post-pulse-types'
import { usePostPulse } from './Shell'
import { ResearchButton } from './ResearchButton'

// Landing view: the production pipeline as a four-stage flow. A stage
// expands in place (no route change, same idea as the compare overlay).
// Post-production is the only stage with an inner structure, so it expands
// to its four sub-groups, each of which expands to department cards; the
// other stages expand straight to their department cards. Sub-groups and
// departments share one card (MapCard) so opening any stage looks the same
// whether or not that stage has a sub-group layer yet.
// Everything is driven by pp_departments.pipeline_stage / pipeline_substage.
export function PipelineMap() {
  const { departments, tools, pendingQueueCount } = usePostPulse()
  const [openStage, setOpenStage] = useState<PpPipelineStage | null>('post_production')
  const [openSub, setOpenSub] = useState<PpPipelineSubstage | null>(null)

  const toolCount = (d: PpDepartment) => tools.filter((t) => t.department_id === d.id).length
  const byStage = (stage: PpPipelineStage) => departments.filter((d) => d.pipeline_stage === stage)
  const bySub = (sub: PpPipelineSubstage) =>
    departments.filter((d) => d.pipeline_stage === 'post_production' && d.pipeline_substage === sub)
  const unmapped = departments.filter((d) => !d.pipeline_stage)
  // Post-production departments without a sub-group still need a home.
  const postUnsubbed = departments.filter((d) => d.pipeline_stage === 'post_production' && !d.pipeline_substage)

  function toggleStage(stage: PpPipelineStage) {
    setOpenStage((cur) => (cur === stage ? null : stage))
    setOpenSub(null)
  }

  const openMeta = openStage ? PP_PIPELINE_STAGES.find((s) => s.value === openStage) : null

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink-300">The pipeline</h1>
        <p className="text-sm text-ink-100 mt-1 max-w-2xl">
          Where AI has landed across a VFX show, stage by stage. Open a stage to see its departments; open a department
          for the tier breakdown and the tools behind it.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          <Link href="/post-pulse/tools" className="text-press-accent hover:underline">
            Browse all {tools.length} tools →
          </Link>
          {pendingQueueCount > 0 && (
            <Link href="/post-pulse/queue" className="text-press-accent hover:underline">
              {pendingQueueCount} {pendingQueueCount === 1 ? 'proposal' : 'proposals'} waiting for review →
            </Link>
          )}
          <Link href="/post-pulse/activity" className="text-press-accent hover:underline">
            Research activity →
          </Link>
        </div>
        {/* Global manual trigger (spec §5): same mechanism as the scheduled sweep, every department, now */}
        <div className="mt-3">
          <ResearchButton compact />
        </div>
      </header>

      {/* Stage row */}
      <ol className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-0 lg:items-stretch">
        {PP_PIPELINE_STAGES.map((stage, i) => {
          const list = byStage(stage.value)
          const isOpen = openStage === stage.value
          const empty = list.length === 0
          return (
            <li key={stage.value} className="flex items-stretch min-w-0">
              <button
                type="button"
                onClick={() => toggleStage(stage.value)}
                aria-expanded={isOpen}
                className={[
                  'relative flex-1 min-w-0 text-left rounded-xl border px-3.5 py-3 transition-colors',
                  isOpen
                    ? 'border-press-accent bg-press-accent/10 shadow-sm'
                    : empty
                      ? 'border-dashed border-cream-400 bg-cream-50/60 hover:border-press-accent/50'
                      : 'border-cream-300 bg-cream-50 hover:border-press-accent/50',
                ].join(' ')}
              >
                <p className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium">Stage {i + 1}</p>
                <p className={['font-medium mt-0.5 leading-tight', isOpen ? 'text-press-accent' : 'text-ink-300'].join(' ')}>
                  {stage.label}
                </p>
                <p className={['text-xs mt-1.5 tabular-nums', empty ? 'text-ink-50' : 'text-ink-100'].join(' ')}>
                  {list.length} {list.length === 1 ? 'department' : 'departments'}
                </p>
                {isOpen && (
                  <span
                    aria-hidden
                    className="hidden lg:block absolute left-1/2 -bottom-[9px] -translate-x-1/2 w-4 h-4 rotate-45 bg-cream-50 border-r border-b border-press-accent"
                  />
                )}
              </button>
              {i < PP_PIPELINE_STAGES.length - 1 && (
                <span aria-hidden className="hidden lg:flex items-center px-1.5 text-ink-50">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {/* Expansion panel — in place, under the row */}
      {openStage && openMeta && (
        <section
          aria-label={`${openMeta.label} departments`}
          className="mt-3 rounded-xl border border-press-accent/40 bg-cream-50 px-4 py-4"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
            <h2 className="font-display text-lg text-ink-300">{openMeta.label}</h2>
            <p className="text-xs text-ink-50">{openMeta.description}</p>
            <button
              type="button"
              onClick={() => toggleStage(openStage)}
              className="ml-auto text-xs text-ink-50 hover:text-ink-300"
            >
              Collapse
            </button>
          </div>
          {/* Frontier scan (spec §5a): open-ended discovery for this whole stage — the
              primary way the empty stages get populated on demand. */}
          <div className="mb-3">
            <ResearchButton stage={{ value: openStage, label: openMeta.label }} compact />
          </div>

          {openStage === 'post_production' ? (
            <>
              {/* Sub-group row */}
              <ol className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {PP_PIPELINE_SUBSTAGES.map((sub, i) => {
                  const list = bySub(sub.value)
                  const isOpen = openSub === sub.value
                  return (
                    <li key={sub.value} className="min-w-0">
                      <MapCard
                        as="button"
                        onClick={() => setOpenSub((cur) => (cur === sub.value ? null : sub.value))}
                        active={isOpen}
                        eyebrow={`${i + 1} of ${PP_PIPELINE_SUBSTAGES.length}`}
                        title={sub.label}
                        meta={`${list.length} ${list.length === 1 ? 'department' : 'departments'}`}
                      />
                    </li>
                  )
                })}
              </ol>

              {openSub && (
                <div className="mt-3 pt-3 border-t border-cream-300">
                  <p className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium mb-2">
                    {PP_PIPELINE_SUBSTAGES.find((s) => s.value === openSub)?.label} ·{' '}
                    <span className="text-ink-50 normal-case tracking-normal">
                      {PP_PIPELINE_SUBSTAGES.find((s) => s.value === openSub)?.description}
                    </span>
                  </p>
                  <DepartmentCards departments={bySub(openSub)} toolCount={toolCount} />
                </div>
              )}

              {postUnsubbed.length > 0 && (
                <div className="mt-3 pt-3 border-t border-cream-300">
                  <p className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Not in a sub-group yet</p>
                  <DepartmentCards departments={postUnsubbed} toolCount={toolCount} />
                </div>
              )}
            </>
          ) : (
            <DepartmentCards departments={byStage(openStage)} toolCount={toolCount} />
          )}
        </section>
      )}

      {unmapped.length > 0 && (
        <div className="mt-4 text-xs text-ink-50">
          <span className="font-medium text-ink-100">Not placed on the pipeline yet:</span>{' '}
          {unmapped.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link href={`/post-pulse/departments/${d.slug}`} className="text-press-accent hover:underline">
                {d.name}
              </Link>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// "checked 3d ago" on a department card: the guide's housekeeping step asks
// you to glance at these ages on the map and notice anything drifting past 14 days.
function checkedAge(iso: string | null): { label: string; stale: boolean } {
  if (!iso) return { label: 'never checked', stale: true }
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return { label: days <= 0 ? 'checked today' : `checked ${days}d ago`, stale: days >= 14 }
}

// The one card used inside an expanded stage: for a sub-group (a button that
// expands in place) and for a department (a link to its doc). Same size, same
// eyebrow / title / meta treatment, so a stage without sub-groups reads exactly
// like one with them. The eyebrow is the "1 of 4" counter for a sub-group and
// the research age for a department — the counter has no meaning there.
type MapCardProps = {
  eyebrow: string
  eyebrowTone?: 'default' | 'stale'
  title: string
  meta: string
  active?: boolean
  titleAttr?: string
} & ({ as: 'button'; onClick: () => void } | { as: 'link'; href: string })

function MapCard(props: MapCardProps) {
  const { eyebrow, eyebrowTone = 'default', title, meta, active = false, titleAttr } = props
  const className = [
    'block w-full h-full text-left rounded-lg border px-3 py-2.5 transition-colors',
    active ? 'border-press-accent bg-press-accent/10' : 'border-cream-300 bg-cream-100/60 hover:border-press-accent/50',
  ].join(' ')
  const body = (
    <>
      <p
        className={[
          'text-[10px] uppercase tracking-[1.5px] font-medium tabular-nums',
          eyebrowTone === 'stale' ? 'text-press-down' : 'text-ink-50',
        ].join(' ')}
      >
        {eyebrow}
      </p>
      <p className={['text-sm font-medium leading-tight mt-0.5', active ? 'text-press-accent' : 'text-ink-300'].join(' ')}>
        {title}
      </p>
      <p className="text-[11px] text-ink-50 mt-1 tabular-nums">{meta}</p>
    </>
  )
  if (props.as === 'link') {
    return (
      <Link href={props.href} title={titleAttr} className={[className, 'hover:text-press-accent'].join(' ')}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={props.onClick} aria-expanded={active} title={titleAttr} className={className}>
      {body}
    </button>
  )
}

function DepartmentCards({
  departments,
  toolCount,
}: {
  departments: PpDepartment[]
  toolCount: (d: PpDepartment) => number
}) {
  if (departments.length === 0) {
    return (
      <p className="text-sm text-ink-50 py-2">
        Nothing tracked here yet. Departments for this stage are future research, not a gap in the data.
      </p>
    )
  }
  return (
    <ul className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {departments.map((d) => {
        const n = toolCount(d)
        const age = checkedAge(d.last_researched_at)
        return (
          <li key={d.id} className="min-w-0">
            <MapCard
              as="link"
              href={`/post-pulse/departments/${d.slug}`}
              titleAttr={d.last_researched_at ? `Last checked ${new Date(d.last_researched_at).toLocaleString()}` : 'Never researched'}
              eyebrow={age.label}
              eyebrowTone={age.stale ? 'stale' : 'default'}
              title={d.name}
              meta={`${n} ${n === 1 ? 'tool' : 'tools'} tracked`}
            />
          </li>
        )
      })}
    </ul>
  )
}
