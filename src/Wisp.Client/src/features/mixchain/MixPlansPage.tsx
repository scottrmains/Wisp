import { Fragment, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { MixPlanTrack, Track } from '../../api/types'
import { formatBpm } from '../library/format'
import { PreviewDialog } from '../preview/PreviewDialog'
import { ChainStats } from './ChainStats'
import { PlanHeader } from './PlanHeader'
import { SuggestRouteDialog } from './SuggestRouteDialog'
import { TransitionGap } from './TransitionGap'
import { computePlanSummary, indexWarningsByTransition } from './summary'
import { useMixPlan, useMixPlans } from './useMixPlans'

/// Mix Plans workspace as a routed peer page — list of plans on the left,
/// active plan on the right. No `fixed inset-0` overlay; lives inside the App
/// layout so the mini-player stays visible at the bottom.
export function MixPlansPage() {
  const { plans, activePlanId, setActivePlanId, create, remove, rename } = useMixPlans()
  const { plan, loading, addTrack, moveTrack, updateNotes, setAnchor, removeTrack, setScope } = useMixPlan(activePlanId)
  const [preview, setPreview] = useState<{ a: Track; b: Track } | null>(null)
  const [suggest, setSuggest] = useState<{ from: MixPlanTrack; to: MixPlanTrack } | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)

  // Library → plan drag-and-drop. Same shape as ChainDock's handlers.
  const isWispDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('application/x-wisp-track-ids')
  const onDragOver = (e: React.DragEvent) => {
    if (!isWispDrag(e) || !activePlanId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDropTarget) setIsDropTarget(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDropTarget(false)
  }
  const onDrop = async (e: React.DragEvent) => {
    if (!isWispDrag(e) || !activePlanId) return
    e.preventDefault()
    setIsDropTarget(false)
    try {
      const ids = JSON.parse(e.dataTransfer.getData('application/x-wisp-track-ids')) as string[]
      let after: string | null = null
      for (const trackId of ids) {
        const created = await addTrack.mutateAsync({ trackId, after })
        after = created.id
      }
    } catch (err) {
      console.error('Drop failed', err)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!plan || !over || active.id === over.id) return
    const oldIndex = plan.tracks.findIndex((t) => t.id === active.id)
    const newIndex = plan.tracks.findIndex((t) => t.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    let after: string | null
    if (newIndex > oldIndex) after = plan.tracks[newIndex].id
    else if (newIndex === 0) after = null
    else after = plan.tracks[newIndex - 1].id
    moveTrack.mutate({ mptId: String(active.id), after })
  }

  const handleCreate = async () => {
    const name = window.prompt('Mix plan name', `Mix ${new Date().toLocaleDateString()}`)
    if (!name?.trim()) return
    await create.mutateAsync(name.trim())
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return
    await remove.mutateAsync(id)
  }

  const summary = computePlanSummary(plan)
  const warningsByTransition = indexWarningsByTransition(summary.warnings)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Mix Plans</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Build, preview and tune sets. Drag to reorder, click between cards to audition the transition.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Plan list */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)]">
          <div className="border-b border-[var(--color-border)] p-2">
            <button
              onClick={handleCreate}
              className="w-full rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
            >
              + New mix plan
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {plans.length === 0 && (
              <p className="px-3 py-4 text-xs text-[var(--color-muted)]">
                No plans yet. Create one to start building a set.
              </p>
            )}
            {plans.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePlanId(p.id)}
                className={[
                  'group flex w-full items-center justify-between border-b border-[var(--color-border)]/40 px-3 py-2 text-left text-sm hover:bg-white/5',
                  p.id === activePlanId ? 'bg-[var(--color-accent)]/15 text-white' : 'text-[var(--color-muted)]',
                ].join(' ')}
              >
                <span className="min-w-0 flex-1 truncate">
                  {p.name}
                  <span className="ml-2 text-[10px] text-[var(--color-muted)]">
                    {p.trackCount} tracks
                  </span>
                </span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDelete(p.id, p.name)
                  }}
                  className="ml-2 text-xs text-[var(--color-muted)] opacity-0 hover:text-red-400 group-hover:opacity-100"
                  aria-label={`Delete ${p.name}`}
                >
                  delete
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Active plan — drop zone for library drags */}
        <main
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={[
            'flex min-h-0 min-w-0 flex-1 flex-col transition-colors',
            isDropTarget ? 'bg-[var(--color-accent)]/10' : '',
          ].join(' ')}
        >
          {!plan && !loading && (
            <p className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
              Pick a plan from the left, or create a new one.
            </p>
          )}
          {loading && <p className="px-6 py-6 text-sm text-[var(--color-muted)]">Loading…</p>}

          {plan && (
            <>
              <PlanHeader
                plan={plan}
                onRename={(name) => rename.mutate({ id: plan.id, name })}
                onScopeChange={(playlistId) => setScope.mutate(playlistId)}
              />
              {plan.tracks.length > 0 && <ChainStats tracks={plan.tracks} />}

              <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-6 py-4">
                {plan.tracks.length === 0 && (
                  <p className="py-6 text-sm text-[var(--color-muted)]">
                    Empty plan. Head back to the Library and click <span className="rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 font-mono text-[var(--color-accent)]">+</span> on a row to add it here.
                  </p>
                )}
                {plan.tracks.length > 0 && (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={plan.tracks.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
                      <ol className="flex items-stretch gap-2">
                        {plan.tracks.map((mpt, i) => (
                          <Fragment key={mpt.id}>
                            <BigCard
                              mpt={mpt}
                              order={i + 1}
                              onRemove={() => removeTrack.mutate(mpt.id)}
                              onNotesChange={(notes) => updateNotes.mutate({ mptId: mpt.id, notes })}
                              onToggleAnchor={() => setAnchor.mutate({ mptId: mpt.id, isAnchor: !mpt.isAnchor })}
                            />
                            {i < plan.tracks.length - 1 && (
                              <TransitionGap
                                warnings={
                                  warningsByTransition.get(`${mpt.id}|${plan.tracks[i + 1].id}`) ?? []
                                }
                                onPreview={() =>
                                  setPreview({ a: mpt.track, b: plan.tracks[i + 1].track })
                                }
                                // Suggest only fires when both sides are anchored — otherwise the
                                // suggester has no clear "must include" pair to bridge between.
                                onSuggest={
                                  mpt.isAnchor && plan.tracks[i + 1].isAnchor
                                    ? () => setSuggest({ from: mpt, to: plan.tracks[i + 1] })
                                    : undefined
                                }
                              />
                            )}
                          </Fragment>
                        ))}
                      </ol>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {preview && (
        <PreviewDialog trackA={preview.a} trackB={preview.b} onClose={() => setPreview(null)} />
      )}

      {suggest && (
        <SuggestRouteDialog
          planId={activePlanId!}
          fromMpt={suggest.from}
          toMpt={suggest.to}
          onClose={() => setSuggest(null)}
          onAccept={async (newTracks) => {
            // Insert sequentially after the `from` anchor. Each addTrack returns and we use
            // that response's id as the next `after` so the order is preserved.
            let after: string | null = suggest.from.id
            for (const t of newTracks) {
              const created = await addTrack.mutateAsync({ trackId: t.id, after })
              after = created.id
            }
          }}
        />
      )}
    </div>
  )
}

function BigCard({
  mpt,
  order,
  onRemove,
  onNotesChange,
  onToggleAnchor,
}: {
  mpt: MixPlanTrack
  order: number
  onRemove: () => void
  onNotesChange: (notes: string) => void
  onToggleAnchor: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: mpt.id })
  const [notes, setNotes] = useState(mpt.transitionNotes ?? '')

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'flex w-64 shrink-0 flex-col rounded-md border bg-[var(--color-surface)] p-3',
        mpt.isAnchor ? 'border-[var(--color-accent)]/60 ring-1 ring-[var(--color-accent)]/40' : 'border-[var(--color-border)]',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <span className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded bg-[var(--color-accent)]/20 px-1.5 text-xs font-semibold text-[var(--color-accent)] tabular-nums">
          {order.toString().padStart(2, '0')}
        </span>
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-[var(--color-muted)] hover:text-white active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          ⋮⋮
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={mpt.track.title ?? ''}>
            {mpt.track.title ?? mpt.track.fileName}
          </p>
          <p className="truncate text-xs text-[var(--color-muted)]" title={mpt.track.artist ?? ''}>
            {mpt.track.artist ?? 'Unknown'}
          </p>
        </div>
        <button
          onClick={onToggleAnchor}
          aria-label={mpt.isAnchor ? 'Unpin anchor' : 'Pin as anchor'}
          title={mpt.isAnchor ? 'Unpin anchor — track can move freely' : 'Pin as anchor — fixed position for route suggester'}
          className={mpt.isAnchor ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-white'}
        >
          📌
        </button>
        <button
          onClick={onRemove}
          aria-label="Remove from plan"
          className="text-[var(--color-muted)] hover:text-red-400"
        >
          ×
        </button>
      </div>

      <div className="mt-3 flex justify-between text-xs text-[var(--color-muted)]">
        <span>{formatBpm(mpt.track.bpm)} BPM</span>
        <span>{mpt.track.musicalKey ?? '—'}</span>
        <span>E{mpt.track.energy ?? '—'}</span>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes !== (mpt.transitionNotes ?? '')) onNotesChange(notes)
        }}
        placeholder="Transition notes…"
        rows={3}
        className="mt-3 resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
    </li>
  )
}
