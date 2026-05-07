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
import { useMixPlan } from './useMixPlans'
import { ChainStats } from './ChainStats'

interface Props {
  planId: string
  collapsed: boolean
  onToggle: () => void
}

export function ChainDock({ planId, collapsed, onToggle }: Props) {
  const { plan, loading, moveTrack, updateNotes, removeTrack } = useMixPlan(planId)
  const [preview, setPreview] = useState<{ a: Track; b: Track } | null>(null)

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
    <section className="flex max-h-[26rem] flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]">
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
                          onRemove={() => removeTrack.mutate(mpt.id)}
                          onNotesChange={(notes) => updateNotes.mutate({ mptId: mpt.id, notes })}
                        />
                        {i < plan.tracks.length - 1 && (
                          <button
                            onClick={() =>
                              setPreview({ a: mpt.track, b: plan.tracks[i + 1].track })
                            }
                            title="Preview transition"
                            aria-label="Preview transition"
                            className="self-stretch px-1 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                          >
                            ▶
                          </button>
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
  onRemove,
  onNotesChange,
}: {
  mpt: MixPlanTrack
  onRemove: () => void
  onNotesChange: (notes: string) => void
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
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-[var(--color-muted)] hover:text-white active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          ⋮⋮
        </button>
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
