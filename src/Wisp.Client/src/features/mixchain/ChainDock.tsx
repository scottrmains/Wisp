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
import { usePlayer } from '../../state/player'
import { formatBpm } from '../library/format'
import { PreviewDialog } from '../preview/PreviewDialog'
import { useMixPlan, useMixPlans } from './useMixPlans'
import { ChainStats } from './ChainStats'
import { PlanHeader } from './PlanHeader'
import { TransitionGap } from './TransitionGap'
import {
  computePlanSummary,
  indexWarningsByTransition,
} from './summary'

interface Props {
  planId: string
  collapsed: boolean
  onToggle: () => void
}

export function ChainDock({ planId, collapsed, onToggle }: Props) {
  const { plan, loading, addTrack, moveTrack, updateNotes, removeTrack } = useMixPlan(planId)
  const { rename } = useMixPlans()
  const [preview, setPreview] = useState<{ a: Track; b: Track } | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const playTrack = usePlayer((s) => s.playTrack)
  const summary = computePlanSummary(plan)
  const warningsByTransition = indexWarningsByTransition(summary.warnings)

  // Library → chain drag-and-drop. The library writes the wisp track-ids payload on dragstart;
  // we accept here and append each track to the active plan in selection order.
  const isWispDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('application/x-wisp-track-ids')
  const onDragOver = (e: React.DragEvent) => {
    if (!isWispDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDropTarget) setIsDropTarget(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the entire dock — `dragleave` fires for child traversals too.
    if (e.currentTarget === e.target) setIsDropTarget(false)
  }
  const onDrop = async (e: React.DragEvent) => {
    if (!isWispDrag(e)) return
    e.preventDefault()
    setIsDropTarget(false)
    try {
      const ids = JSON.parse(e.dataTransfer.getData('application/x-wisp-track-ids')) as string[]
      // Sequential addTrack chain: each call's result feeds the next as `after` so order is preserved.
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

    // After-anchor logic: when moving down, the item lands AFTER `over`. When moving up,
    // it lands BEFORE `over` — i.e. AFTER the item just before `over` (or null if `over` is first).
    let after: string | null
    if (newIndex > oldIndex) {
      after = plan.tracks[newIndex].id
    } else if (newIndex === 0) {
      after = null
    } else {
      after = plan.tracks[newIndex - 1].id
    }

    moveTrack.mutate({ mptId: String(active.id), after })
  }

  return (
    <section
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        'flex max-h-[26rem] flex-col border-t bg-[var(--color-surface)] transition-colors',
        isDropTarget
          ? 'border-[var(--color-accent)] ring-2 ring-inset ring-[var(--color-accent)]/40'
          : 'border-[var(--color-border)]',
      ].join(' ')}
    >
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className="text-[var(--color-muted)] hover:text-white"
            aria-label={collapsed ? 'Expand chain' : 'Collapse chain'}
          >
            {collapsed ? '▴' : '▾'}
          </button>
          <h2 className="text-sm font-semibold">{plan?.name ?? 'Mix chain'}</h2>
          <span className="text-xs text-[var(--color-muted)]">
            {plan ? `${plan.tracks.length} tracks` : ''}
          </span>
        </div>
      </header>

      {!collapsed && (
        <>
          {plan && (
            <PlanHeader
              plan={plan}
              compact
              onRename={(name) => rename.mutate({ id: plan.id, name })}
            />
          )}
          {plan && plan.tracks.length > 0 && <ChainStats tracks={plan.tracks} />}

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4">
            {loading && <p className="py-6 text-sm text-[var(--color-muted)]">Loading…</p>}
            {plan && plan.tracks.length === 0 && (
              <p className="py-6 text-sm text-[var(--color-muted)]">
                Click the <span className="rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 font-mono text-[var(--color-accent)]">+</span> next to any library row or recommendation to add it here. Drag cards to reorder once you've added a few.
              </p>
            )}
            {plan && plan.tracks.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={plan.tracks.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
                  <ol className="flex items-stretch gap-2 pt-2">
                    {plan.tracks.map((mpt, i) => (
                      <Fragment key={mpt.id}>
                        <SortableCard
                          mpt={mpt}
                          order={i + 1}
                          onRemove={() => removeTrack.mutate(mpt.id)}
                          onNotesChange={(notes) => updateNotes.mutate({ mptId: mpt.id, notes })}
                          onPlay={() => playTrack(mpt.track.id)}
                        />
                        {i < plan.tracks.length - 1 && (
                          <TransitionGap
                            warnings={
                              warningsByTransition.get(`${mpt.id}|${plan.tracks[i + 1].id}`) ?? []
                            }
                            onPreview={() =>
                              setPreview({ a: mpt.track, b: plan.tracks[i + 1].track })
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

      {preview && (
        <PreviewDialog
          trackA={preview.a}
          trackB={preview.b}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}

function SortableCard({
  mpt,
  order,
  onRemove,
  onNotesChange,
  onPlay,
}: {
  mpt: MixPlanTrack
  order: number
  onRemove: () => void
  onNotesChange: (notes: string) => void
  onPlay: () => void
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
      className="flex w-52 shrink-0 flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2"
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1">
          <span className="inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded bg-[var(--color-accent)]/20 px-1 text-[10px] font-semibold text-[var(--color-accent)] tabular-nums">
            {order.toString().padStart(2, '0')}
          </span>
          <button
            onClick={onPlay}
            className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            title="Play in mini-player"
            aria-label="Play in mini-player"
          >
            ▶
          </button>
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab text-[var(--color-muted)] hover:text-white active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            ⋮⋮
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={mpt.track.title ?? ''}>
            {mpt.track.title ?? mpt.track.fileName}
          </p>
          <p className="truncate text-[11px] text-[var(--color-muted)]" title={mpt.track.artist ?? ''}>
            {mpt.track.artist ?? 'Unknown'}
          </p>
        </div>
        <button
          onClick={onRemove}
          aria-label="Remove from chain"
          className="text-[var(--color-muted)] hover:text-red-400"
        >
          ×
        </button>
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-[var(--color-muted)]">
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
        rows={2}
        className="mt-2 resize-none rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
    </li>
  )
}
