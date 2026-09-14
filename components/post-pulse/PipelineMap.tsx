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

// Landing view: the production pipeline as a four-stage flow. A stage
// expands in place (no route change, same idea as the compare overlay).
// Post-production is the only stage with an inner structure, so it expands
// to its four sub-groups, each of which expands to department chips; the
// other stages expand straight to their (currently empty) department list.
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

          {openStage === 'post_production' ? (
            <>
              {/* Sub-group row */}
              <ol className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {PP_PIPELINE_SUBSTAGES.map((sub, i) => {
                  const list = bySub(sub.value)
                  const isOpen = openSub === sub.value
                  return (
                    <li key={sub.value} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setOpenSub((cur) => (cur === sub.value ? null : sub.value))}
                        aria-expanded={isOpen}
                        className={[
                          'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
                          isOpen
                            ? 'border-press-accent bg-press-accent/10'
                            : 'border-cream-300 bg-cream-100/60 hover:border-press-accent/50',
                        ].join(' ')}
                      >
                        <p className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium">
                          {i + 1} of {PP_PIPELINE_SUBSTAGES.length}
                        </p>
                        <p className={['text-sm font-medium leading-tight mt-0.5', isOpen ? 'text-press-accent' : 'text-ink-300'].join(' ')}>
                          {sub.label}
                        </p>
                        <p className="text-[11px] text-ink-50 mt-1 tabular-nums">
                          {list.length} {list.length === 1 ? 'department' : 'departments'}
                        </p>
                      </button>
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
                  <DepartmentChips departments={bySub(openSub)} toolCount={toolCount} />
                </div>
              )}

              {postUnsubbed.length > 0 && (
                <div className="mt-3 pt-3 border-t border-cream-300">
                  <p className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Not in a sub-group yet</p>
                  <DepartmentChips departments={postUnsubbed} toolCount={toolCount} />
                </div>
              )}
            </>
          ) : (
            <DepartmentChips departments={byStage(openStage)} toolCount={toolCount} />
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

function DepartmentChips({
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
    <ul className="flex flex-wrap gap-2">
      {departments.map((d) => {
        const n = toolCount(d)
        return (
          <li key={d.id}>
            <Link
              href={`/post-pulse/departments/${d.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-cream-400 bg-cream-50 pl-3 pr-2 py-1.5 text-sm text-ink-300 hover:border-press-accent hover:text-press-accent transition-colors"
            >
              {d.name}
              <span className="text-[11px] tabular-nums px-1.5 py-px rounded-full bg-cream-300/70 text-ink-100">
                {n}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
