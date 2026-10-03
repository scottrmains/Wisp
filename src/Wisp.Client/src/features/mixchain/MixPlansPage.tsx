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
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Play,
  Plus,
  Trash2,
  GripVertical,
  Pin,
  X,
  ArrowRight,
  ListOrdered,
  Columns3,
  Sparkles,
} from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { SectionTabs } from '../../components/ui/SectionTabs'
import { WorkspaceNavigation, NavigationToggle } from '../../components/ui/WorkspaceNavigation'
import type { MixPlanTrack, Track } from '../../api/types'
import { confirmDialog, promptDialog } from '../../components/dialog'
import { usePlayer } from '../../state/player'
import { formatBpm, trackDisplayTitle } from '../library/format'
import { RecommendationsList } from '../library/RecommendationPanel'
import { PreviewDialog } from '../preview/PreviewDialog'
import { ChainStats } from './ChainStats'
import { PlanHeader } from './PlanHeader'
import { SuggestRouteDialog } from './SuggestRouteDialog'
import { TransitionGap } from './TransitionGap'
import { computePlanSummary, indexWarningsByTransition } from './summary'
import { useMixPlan, useMixPlans } from './useMixPlans'
import { PlanRecordingLinks } from '../recordings/PlanRecordingLinks'

/// Mix Plans workspace as a routed peer page — list of plans on the left,
/// active plan on the right. No `fixed inset-0` overlay; lives inside the App
/// layout so the mini-player stays visible at the bottom.
export function MixPlansPage() {
  const {
    plans,
    loading: plansLoading,
    error: plansError,
    retry: retryPlans,
    activePlanId,
    setActivePlanId,
    create,
    remove,
    rename,
  } = useMixPlans()
  const {
    plan,
    loading,
    error,
    retry,
    addTrack,
    moveTrack,
    updateNotes,
    setAnchor,
    removeTrack,
    setScope,
  } = useMixPlan(activePlanId)
  const [preview, setPreview] = useState<{ a: Track; b: Track } | null>(null)
  const [suggest, setSuggest] = useState<{ from: MixPlanTrack; to: MixPlanTrack } | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [view, setView] = useState<'list' | 'chain'>('list')
  const [transitionId, setTransitionId] = useState<string | null>(null)
  const [recommendPlanId, setRecommendPlanId] = useState<string | null>(null)
  const [recommendSeedId, setRecommendSeedId] = useState('')
  const recommendationsOpen = !!plan && recommendPlanId === plan.id
  const seed =
    plan?.tracks.find((t) => t.id === recommendSeedId)?.track ?? plan?.tracks.at(-1)?.track
  const [planSearch, setPlanSearch] = useState('')
  const [dropError, setDropError] = useState<string | null>(null)

  // Library → plan drag-and-drop. Same shape as ChainDock's handlers.
  const isWispDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('application/x-wisp-track-ids')
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
    setDropError(null)
    try {
      const ids = JSON.parse(e.dataTransfer.getData('application/x-wisp-track-ids')) as string[]
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
        throw new Error('Invalid WISP track selection')
      let after: string | null = null
      for (const trackId of ids) {
        const created = await addTrack.mutateAsync({ trackId, after })
        after = created.id
      }
    } catch (err) {
      setDropError(
        `Could not add the full selection: ${(err as Error).message}. Successfully added tracks remain in the plan; check before retrying.`,
      )
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
    const name = await promptDialog({
      title: 'New mix plan',
      message: 'Give the plan a name — you can rename it later.',
      defaultValue: `Mix ${new Date().toLocaleDateString()}`,
      placeholder: 'Plan name',
      confirmLabel: 'Create',
    })
    if (!name) return
    create.mutate(name)
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Delete "${name}"?`,
      message:
        'The mix plan and its track ordering will be removed. The tracks themselves stay in your library.',
      danger: true,
    })
    if (!ok) return
    remove.mutate(id)
  }

  const summary = computePlanSummary(plan)
  const warningsByTransition = indexWarningsByTransition(summary.warnings)
  const transitionIndex = plan?.tracks.findIndex((t) => t.id === transitionId) ?? -1
  const from = transitionIndex >= 0 ? plan?.tracks[transitionIndex] : undefined
  const to = transitionIndex >= 0 ? plan?.tracks[transitionIndex + 1] : undefined
  const mutationError = [
    create,
    remove,
    rename,
    addTrack,
    moveTrack,
    updateNotes,
    setAnchor,
    removeTrack,
    setScope,
  ].find((m) => m.isError)?.error

  return (
    <div className="feature-workspace mix-plans-workspace">
      <header className="workspace-heading">
        <NavigationToggle navigation="plans" label="plans" />
        <div className="min-w-0 flex-1">
          <h1>Mix Plans</h1>
          <p>Shape the running order. Tune each transition.</p>
        </div>
        <Button variant="primary" onClick={() => void handleCreate()} disabled={create.isPending}>
          <Plus /> New mix plan
        </Button>
      </header>
      {mutationError && (
        <StatusMessage tone="error">
          Could not save plan change: {mutationError.message}. Try the action again.
        </StatusMessage>
      )}
      {dropError && <StatusMessage tone="error">{dropError}</StatusMessage>}

      <div className="flex min-h-0 flex-1">
        {/* Plan list */}
        <WorkspaceNavigation navigation="plans" label="Plans">
          <label className="workspace-nav-search">
            <span className="sr-only">Find a mix plan</span>
            <input
              value={planSearch}
              onChange={(e) => setPlanSearch(e.target.value)}
              placeholder="Find a plan…"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-auto">
            {plansLoading && (
              <p className="workspace-empty" role="status">
                Loading plans…
              </p>
            )}
            {plansError && (
              <StatusMessage tone="error">
                Could not load plans.{' '}
                <Button small onClick={() => void retryPlans()}>
                  Retry plans
                </Button>
              </StatusMessage>
            )}
            {!plansLoading && !plansError && plans.length === 0 && (
              <p className="px-3 py-4 text-xs text-[var(--color-muted)]">
                No plans yet. Create one to start building a set.
              </p>
            )}
            {plans.length > 0 &&
              !plans.some((p) => p.name.toLowerCase().includes(planSearch.toLowerCase())) && (
                <p className="workspace-empty">No plans match. Try a different name.</p>
              )}
            {plans
              .filter((p) => p.name.toLowerCase().includes(planSearch.toLowerCase()))
              .map((p) => (
                <div key={p.id} className="workspace-nav-row" data-active={p.id === activePlanId}>
                  <button
                    className="workspace-nav-choice"
                    aria-current={p.id === activePlanId ? 'page' : undefined}
                    onClick={() => {
                      setActivePlanId(p.id)
                      setTransitionId(null)
                    }}
                    title={p.name}
                  >
                    <span className="truncate">{p.name}</span>
                    <small>{p.trackCount} tracks</small>
                  </button>
                  <IconButton
                    small
                    variant="quiet"
                    label={`Delete ${p.name}`}
                    disabled={remove.isPending}
                    onClick={() => void handleDelete(p.id, p.name)}
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              ))}
          </div>
        </WorkspaceNavigation>

        {/* Active plan — drop zone for library drags */}
        <main
          aria-label="Plan workspace"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={[
            'flex min-h-0 min-w-0 flex-1 flex-col transition-colors',
            isDropTarget ? 'bg-[var(--color-accent)]/10' : '',
          ].join(' ')}
        >
          {error && (
            <StatusMessage tone="error">
              Could not load the plan: {error.message}.{' '}
              <Button small onClick={() => void retry()}>
                Retry plan
              </Button>
            </StatusMessage>
          )}
          {!plan && !loading && !error && (
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
                recommendationsOpen={recommendationsOpen}
                onRecommend={() => {
                  setRecommendPlanId(recommendationsOpen ? null : plan.id)
                  setRecommendSeedId('')
                  setTransitionId(null)
                }}
              />
              <PlanRecordingLinks planId={plan.id} />
              {plan.tracks.length > 0 && (
                <details className="plan-overview">
                  <summary>Energy, key and BPM journey</summary>
                  <ChainStats tracks={plan.tracks} />
                </details>
              )}
              <SectionTabs
                label="Plan view"
                active={view}
                onSelect={setView}
                items={[
                  { id: 'list', label: 'Tracklist', icon: <ListOrdered /> },
                  { id: 'chain', label: 'Chain view', icon: <Columns3 /> },
                ]}
              />

              <div className="plan-body">
                <div className="plan-track-scroll" aria-label="Plan tracks">
                  {plan.tracks.length === 0 && (
                    <p className="py-6 text-sm text-[var(--color-muted)]">
                      Empty plan. Head back to the Library and click{' '}
                      <span className="rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 font-mono text-[var(--color-accent)]">
                        +
                      </span>{' '}
                      on a row to add it here.
                    </p>
                  )}
                  {plan.tracks.length > 0 && (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={plan.tracks.map((t) => t.id)}
                        strategy={
                          view === 'chain'
                            ? horizontalListSortingStrategy
                            : verticalListSortingStrategy
                        }
                      >
                        <ol className={`plan-tracks plan-tracks--${view}`}>
                          {plan.tracks.map((mpt, i) => (
                            <Fragment key={mpt.id}>
                              <BigCard
                                mpt={mpt}
                                order={i + 1}
                                view={view}
                                onRemove={() => removeTrack.mutate(mpt.id)}
                                onNotesChange={(notes) =>
                                  updateNotes.mutate({ mptId: mpt.id, notes })
                                }
                                onToggleAnchor={() =>
                                  setAnchor.mutate({ mptId: mpt.id, isAnchor: !mpt.isAnchor })
                                }
                              />
                              {i < plan.tracks.length - 1 &&
                                (view === 'chain' ? (
                                  <li className="flex shrink-0">
                                    <TransitionGap
                                      warnings={
                                        warningsByTransition.get(
                                          `${mpt.id}|${plan.tracks[i + 1].id}`,
                                        ) ?? []
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
                                  </li>
                                ) : (
                                  <li className="plan-transition-row">
                                    <Button
                                      small
                                      variant="quiet"
                                      aria-pressed={transitionId === mpt.id}
                                      data-transition-track={mpt.id}
                                      onClick={() => {
                                        setTransitionId(mpt.id)
                                        setRecommendPlanId(null)
                                      }}
                                    >
                                      <ArrowRight /> Transition {i + 1} → {i + 2}
                                      {(warningsByTransition.get(
                                        `${mpt.id}|${plan.tracks[i + 1].id}`,
                                      )?.length ?? 0) > 0
                                        ? ' · review'
                                        : ''}
                                    </Button>
                                  </li>
                                ))}
                            </Fragment>
                          ))}
                        </ol>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
                {recommendationsOpen && seed && (
                  <aside
                    id="plan-recommendations"
                    className="plan-recommendations"
                    aria-label="Next track recommendations"
                  >
                    <header className="workspace-inspector-heading">
                      <h2>Find your next track</h2>
                      <IconButton
                        small
                        variant="quiet"
                        label="Close recommendations"
                        onClick={() => {
                          setRecommendPlanId(null)
                          document
                            .querySelector<HTMLButtonElement>(
                              '[aria-controls="plan-recommendations"]',
                            )
                            ?.focus()
                        }}
                      >
                        <X />
                      </IconButton>
                    </header>
                    <label className="flex flex-col gap-2 p-4 text-xs">
                      Match after
                      <select
                        aria-label="Recommendation seed"
                        value={
                          plan.tracks.some((t) => t.id === recommendSeedId) ? recommendSeedId : ''
                        }
                        onChange={(e) => setRecommendSeedId(e.target.value)}
                      >
                        <option value="">Last track in plan</option>
                        {plan.tracks.map((t, i) => (
                          <option key={t.id} value={t.id}>
                            {i + 1}. {trackDisplayTitle(t.track)}
                          </option>
                        ))}
                      </select>
                      <span className="text-[var(--color-muted)]">
                        {trackDisplayTitle(seed)} · additions go at the end of the plan.
                      </span>
                    </label>
                    <RecommendationsList
                      seed={seed}
                      existingTrackIds={new Set(plan.tracks.map((t) => t.track.id))}
                      adding={addTrack.isPending}
                      onAddToChain={(trackId) =>
                        addTrack.mutate({ trackId, after: plan.tracks.at(-1)?.id ?? null })
                      }
                    />
                  </aside>
                )}
                {!recommendationsOpen && from && to && (
                  <aside className="plan-transition-inspector" aria-label="Transition details">
                    <header className="workspace-inspector-heading">
                      <h2>
                        Transition {transitionIndex + 1} → {transitionIndex + 2}
                      </h2>
                      <IconButton
                        small
                        variant="quiet"
                        label="Close transition details"
                        onClick={() => {
                          document
                            .querySelector<HTMLButtonElement>(
                              `[data-transition-track="${window.CSS.escape(from.id)}"]`,
                            )
                            ?.focus()
                          setTransitionId(null)
                        }}
                      >
                        <X />
                      </IconButton>
                    </header>
                    <div className="p-4 space-y-4">
                      <div>
                        <p className="workspace-eyebrow">From</p>
                        <p>{trackDisplayTitle(from.track)}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {formatBpm(from.track.bpm)} BPM · {from.track.musicalKey ?? 'Unknown key'}
                        </p>
                      </div>
                      <div>
                        <p className="workspace-eyebrow">Into</p>
                        <p>{trackDisplayTitle(to.track)}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {formatBpm(to.track.bpm)} BPM · {to.track.musicalKey ?? 'Unknown key'}
                        </p>
                      </div>
                      {(warningsByTransition.get(`${from.id}|${to.id}`) ?? []).map((w) => (
                        <StatusMessage key={w.kind}>{w.message}</StatusMessage>
                      ))}
                      <p className="text-xs text-[var(--color-muted)]">
                        Warnings are preparation hints, not a verdict on the mix. Use the track's
                        Notes control for your transition notes.
                      </p>
                      <Button
                        variant="primary"
                        onClick={() => setPreview({ a: from.track, b: to.track })}
                      >
                        <Play /> Preview transition
                      </Button>
                      <Button
                        disabled={!from.isAnchor || !to.isAnchor}
                        tooltip="Pin both tracks as anchors to suggest filler tracks"
                        onClick={() => setSuggest({ from, to })}
                      >
                        <Sparkles /> Suggest filler tracks
                      </Button>
                    </div>
                  </aside>
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
  view,
  onRemove,
  onNotesChange,
  onToggleAnchor,
}: {
  mpt: MixPlanTrack
  order: number
  view: 'list' | 'chain'
  onRemove: () => void
  onNotesChange: (notes: string) => void
  onToggleAnchor: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mpt.id,
  })
  const [notes, setNotes] = useState(mpt.transitionNotes ?? '')
  const playTrack = usePlayer((s) => s.playTrack)

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
        `plan-track plan-track--${view}`,
        mpt.isAnchor
          ? 'border-[var(--color-accent)]/60 ring-1 ring-[var(--color-accent)]/40'
          : 'border-[var(--color-border)]',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <span className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded bg-[var(--color-accent)]/20 px-1.5 text-xs font-semibold text-[var(--color-accent)] tabular-nums">
          {order.toString().padStart(2, '0')}
        </span>
        <IconButton
          small
          variant="quiet"
          onClick={() => playTrack(mpt.track.id)}
          className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          label="Play in mini-player"
        >
          <Play size={11} fill="currentColor" />
        </IconButton>
        <IconButton
          small
          variant="quiet"
          {...attributes}
          {...listeners}
          className="cursor-grab text-[var(--color-muted)] hover:text-white active:cursor-grabbing"
          label="Drag to reorder"
        >
          <GripVertical />
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={trackDisplayTitle(mpt.track)}>
            {trackDisplayTitle(mpt.track)}
          </p>
          <p className="truncate text-xs text-[var(--color-muted)]" title={mpt.track.artist ?? ''}>
            {mpt.track.artist ?? 'Unknown'}
          </p>
        </div>
        <IconButton
          small
          variant="quiet"
          onClick={onToggleAnchor}
          label={mpt.isAnchor ? 'Unpin anchor' : 'Pin as anchor'}
          tooltip={
            mpt.isAnchor
              ? 'Unpin anchor — track can move freely'
              : 'Pin as anchor — fixed position for route suggester'
          }
          className={
            mpt.isAnchor
              ? 'text-[var(--color-accent)]'
              : 'text-[var(--color-muted)] hover:text-white'
          }
        >
          <Pin />
        </IconButton>
        <IconButton
          small
          variant="quiet"
          onClick={onRemove}
          label="Remove from plan"
          className="text-[var(--color-muted)] hover:text-red-400"
        >
          <X />
        </IconButton>
      </div>

      <div className="mt-3 flex justify-between text-xs text-[var(--color-muted)]">
        <span>{formatBpm(mpt.track.bpm)} BPM</span>
        <span>{mpt.track.musicalKey ?? '—'}</span>
        <span>E{mpt.track.energy ?? '—'}</span>
      </div>

      <details className="plan-track-notes" open={view === 'chain' ? true : undefined}>
        <summary>Notes{notes ? ' · added' : ''}</summary>
        <textarea
          aria-label={`Transition notes for ${trackDisplayTitle(mpt.track)}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (mpt.transitionNotes ?? '')) onNotesChange(notes)
          }}
          placeholder="Transition notes…"
          rows={3}
          className="mt-3 resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </details>
    </li>
  )
}
