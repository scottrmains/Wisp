import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TagType, Track, TrackTag } from '../../api/types'
import { tracks as tracksApi } from '../../api/library'
import { tags as tagsApi } from '../../api/tags'
import { useCues } from '../cues/useCues'
import { formatBpm, formatDuration } from '../library/format'
import { RecommendationsList } from '../library/RecommendationPanel'
import { usePlayer } from '../../state/player'
import { useUiPrefs, type InspectorTab as Tab } from '../../state/uiPrefs'

interface Props {
  track: Track
  onClose: () => void
  onAddToChain?: (trackId: string) => void
  onCleanup?: (track: Track) => void
  onArchive?: (track: Track) => void
  /// External requests to focus a particular tab (e.g. `R` keyboard shortcut from
  /// the parent). Changing this prop snaps the inspector to that tab.
  focusTab?: Tab
}

export function TrackInspector({ track, onClose, onAddToChain, onCleanup, onArchive, focusTab }: Props) {
  const lastTab = useUiPrefs((s) => s.lastInspectorTab)
  const setLastTab = useUiPrefs((s) => s.setLastInspectorTab)
  const width = useUiPrefs((s) => s.inspectorWidth)
  const setWidth = useUiPrefs((s) => s.setInspectorWidth)
  const collapsed = useUiPrefs((s) => s.inspectorCollapsed)
  const toggleCollapsed = useUiPrefs((s) => s.toggleInspectorCollapsed)

  const [tab, setTab] = useState<Tab>(lastTab)

  // Persist tab changes back to prefs so the next selection lands on the same tab.
  const switchTab = useCallback((next: Tab) => {
    setTab(next)
    setLastTab(next)
  }, [setLastTab])

  // Parent-driven focus (e.g. `R` keyboard shortcut) wins over remembered tab.
  useEffect(() => {
    if (focusTab) {
      setTab(focusTab)
      setLastTab(focusTab)
    }
  }, [focusTab, setLastTab])

  const playTrack = usePlayer((s) => s.playTrack)
  const playerTrackId = usePlayer((s) => s.trackId)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)

  const isLoadedHere = playerTrackId === track.id
  const playLabel = isLoadedHere && isPlaying ? '❚❚ Pause' : '▶ Play'

  // Drag-to-resize. We attach pointermove to window during a drag so the user can
  // overshoot the inspector's edge without losing the grip.
  const dragStateRef = useRef<{ startX: number; startW: number } | null>(null)
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    dragStateRef.current = { startX: e.clientX, startW: width }
    const move = (ev: PointerEvent) => {
      const s = dragStateRef.current
      if (!s) return
      // Inspector is on the right edge — dragging LEFT widens it.
      const dx = s.startX - ev.clientX
      setWidth(s.startW + dx)
    }
    const up = () => {
      dragStateRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Collapsed state hides the body but keeps a thin rail with an expand affordance.
  if (collapsed) {
    return (
      <aside className="flex h-full w-8 shrink-0 flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-surface)] py-2">
        <button
          onClick={toggleCollapsed}
          className="mb-2 text-[var(--color-muted)] hover:text-white"
          title="Expand inspector"
          aria-label="Expand inspector"
        >
          ‹
        </button>
        <span
          className="mt-2 select-none text-[10px] uppercase tracking-widest text-[var(--color-muted)]"
          style={{ writingMode: 'vertical-rl' }}
        >
          {track.title ?? track.fileName}
        </span>
      </aside>
    )
  }

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ width: `${width}px` }}
    >
      {/* Drag handle on the left edge */}
      <div
        onPointerDown={onResizePointerDown}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-[var(--color-accent)]/30"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
      />

      <header className="border-b border-[var(--color-border)] px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Track</p>
            <h2 className="mt-1 truncate text-base font-semibold" title={track.title ?? ''}>
              {track.title ?? track.fileName}
            </h2>
            <p className="truncate text-sm text-[var(--color-muted)]" title={track.artist ?? ''}>
              {track.artist ?? 'Unknown artist'}
              {track.version && ` (${track.version})`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={toggleCollapsed}
              className="text-base leading-none text-[var(--color-muted)] hover:text-white"
              title="Collapse inspector"
              aria-label="Collapse inspector"
            >
              ›
            </button>
            <button onClick={onClose} className="text-xl leading-none text-[var(--color-muted)] hover:text-white" aria-label="Close inspector">
              ×
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => (isLoadedHere ? togglePlay() : playTrack(track.id))}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
          >
            {playLabel}
          </button>
          {onAddToChain && (
            <button
              onClick={() => onAddToChain(track.id)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-white/5"
              title="Add to active mix plan"
            >
              + Add to mix
            </button>
          )}
          <button
            onClick={() => switchTab('recommendations')}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-white/5"
            title="Find compatible tracks"
          >
            ✨ Find matches
          </button>
          {(track.isDirtyName || track.isMissingMetadata) && onCleanup && (
            <button
              onClick={() => onCleanup(track)}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
              title="Cleanup suggested"
            >
              ⚠ Cleanup
            </button>
          )}
          {onArchive && (
            <button
              onClick={() => onArchive(track)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-white/5 hover:text-white"
              title={track.isArchived ? 'Restore to active library' : 'Retire from active library'}
            >
              {track.isArchived ? '♻ Restore' : '📦 Archive'}
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex shrink-0 border-b border-[var(--color-border)] text-xs">
        <TabButton active={tab === 'overview'} onClick={() => switchTab('overview')}>Overview</TabButton>
        <TabButton active={tab === 'recommendations'} onClick={() => switchTab('recommendations')}>Recs</TabButton>
        <TabButton active={tab === 'cues'} onClick={() => switchTab('cues')}>Cues</TabButton>
        <TabButton active={tab === 'metadata'} onClick={() => switchTab('metadata')}>Meta</TabButton>
        <TabButton active={tab === 'notes'} onClick={() => switchTab('notes')}>Notes</TabButton>
        <TabButton active={tab === 'tags'} onClick={() => switchTab('tags')}>Tags</TabButton>
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'overview' && <OverviewTab track={track} />}
        {tab === 'recommendations' && (
          <RecommendationsList seed={track} onAddToChain={onAddToChain} />
        )}
        {tab === 'cues' && <CuesTab track={track} />}
        {tab === 'metadata' && <MetadataTab track={track} />}
        {tab === 'notes' && <NotesTab track={track} />}
        {tab === 'tags' && <TagsTab track={track} />}
      </div>
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 px-3 py-2 transition-colors',
        active
          ? 'border-b-2 border-[var(--color-accent)] text-white'
          : 'border-b-2 border-transparent text-[var(--color-muted)] hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function OverviewTab({ track }: { track: Track }) {
  return (
    <div className="space-y-4 overflow-auto px-5 py-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="BPM" value={formatBpm(track.bpm)} />
        <Stat label="Key" value={track.musicalKey ?? '—'} />
        <Stat label="Energy" value={track.energy !== null ? `E${track.energy}` : '—'} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Field label="Genre" value={track.genre} />
        <Field label="Year" value={track.releaseYear?.toString() ?? null} />
        <Field label="Album" value={track.album} />
        <Field label="Duration" value={formatDuration(track.durationSeconds)} />
      </div>
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">File</p>
        <p className="mt-0.5 break-all text-[11px] text-[var(--color-muted)]" title={track.filePath}>
          {track.filePath}
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className={value ? 'truncate' : 'truncate text-[var(--color-muted)]'} title={value ?? ''}>
        {value ?? '—'}
      </p>
    </div>
  )
}

function CuesTab({ track }: { track: Track }) {
  const { cues, loading } = useCues(track.id)
  const seek = usePlayer((s) => s.seek)
  const playerTrackId = usePlayer((s) => s.trackId)
  const playTrack = usePlayer((s) => s.playTrack)

  if (loading) return <p className="px-5 py-6 text-sm text-[var(--color-muted)]">Loading cues…</p>
  if (cues.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-[var(--color-muted)]">
        No cue points yet. Open the blend preview from the mix plan to add cue markers.
      </p>
    )
  }

  return (
    <ul className="overflow-auto py-2">
      {cues.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-1.5 text-sm hover:bg-white/5">
          <span className="min-w-0 flex-1 truncate" title={c.label}>
            <span className="text-[var(--color-muted)]">{c.type}</span>
            {c.label && c.label !== c.type ? ` — ${c.label}` : ''}
          </span>
          <span className="tabular-nums text-xs text-[var(--color-muted)]">
            {formatDuration(c.timeSeconds)}
          </span>
          <button
            onClick={() => {
              if (playerTrackId !== track.id) playTrack(track.id)
              // Brief pause to let the load complete; user can also click again if they jump too early.
              setTimeout(() => seek(c.timeSeconds), 50)
            }}
            className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            title="Jump to cue"
          >
            ↪
          </button>
        </li>
      ))}
    </ul>
  )
}

function MetadataTab({ track }: { track: Track }) {
  const rows: { label: string; value: string | null }[] = [
    { label: 'File path', value: track.filePath },
    { label: 'File name', value: track.fileName },
    { label: 'Artist', value: track.artist },
    { label: 'Title', value: track.title },
    { label: 'Version', value: track.version },
    { label: 'Album', value: track.album },
    { label: 'Genre', value: track.genre },
    { label: 'Year', value: track.releaseYear?.toString() ?? null },
    { label: 'BPM', value: formatBpm(track.bpm) },
    { label: 'Key', value: track.musicalKey },
    { label: 'Energy', value: track.energy !== null ? `E${track.energy}` : null },
    { label: 'Duration', value: formatDuration(track.durationSeconds) },
    { label: 'Added', value: new Date(track.addedAt).toLocaleString() },
    { label: 'Last scanned', value: track.lastScannedAt ? new Date(track.lastScannedAt).toLocaleString() : null },
  ]

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-[var(--color-border)]/40">
              <td className="w-32 px-5 py-1.5 text-[var(--color-muted)]">{r.label}</td>
              <td className="break-all px-5 py-1.5">{r.value ?? <span className="text-[var(--color-muted)]">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NotesTab({ track }: { track: Track }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(track.notes ?? '')
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Reset the draft whenever we land on a different track. Otherwise switching
  // between rows in the inspector would carry one track's draft into the next.
  useEffect(() => {
    setDraft(track.notes ?? '')
    setSavedAt(null)
  }, [track.id, track.notes])

  const save = useMutation({
    mutationFn: (notes: string | null) => tracksApi.updateNotes(track.id, notes),
    onSuccess: (updated) => {
      // Refresh anywhere this track lives in the cache (track list, inspector header, mini-player).
      qc.setQueryData(['track', track.id], updated)
      qc.invalidateQueries({ queryKey: ['tracks'] })
      setSavedAt(Date.now())
    },
  })

  const dirty = draft !== (track.notes ?? '')

  return (
    <div className="flex h-full flex-col px-5 py-4">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (dirty) save.mutate(draft.trim() ? draft : null)
        }}
        placeholder="Notes about this track — best transitions, vinyl shop, bootleg history, anything you want to remember…"
        className="min-h-[10rem] flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm leading-relaxed placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span>Saves on blur. Empty clears the field.</span>
        <span>
          {save.isPending
            ? 'Saving…'
            : save.isError
              ? <span className="text-red-400">Save failed</span>
              : dirty
                ? 'Unsaved changes'
                : savedAt
                  ? 'Saved'
                  : ''}
        </span>
      </div>
    </div>
  )
}

function TagsTab({ track }: { track: Track }) {
  const qc = useQueryClient()
  const [draftName, setDraftName] = useState('')
  const [draftType, setDraftType] = useState<TagType>('Role')

  const list = useQuery({
    queryKey: ['track-tags', track.id],
    queryFn: () => tagsApi.forTrack(track.id),
  })

  const all = useQuery({
    queryKey: ['library-tags'],
    queryFn: () => tagsApi.all(),
    staleTime: 30_000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['track-tags', track.id] })
    qc.invalidateQueries({ queryKey: ['library-tags'] })
  }

  const add = useMutation({
    mutationFn: ({ name, type }: { name: string; type: TagType }) =>
      tagsApi.add(track.id, name, type),
    onSuccess: () => {
      setDraftName('')
      refresh()
    },
  })

  const remove = useMutation({
    mutationFn: (tagId: string) => tagsApi.remove(track.id, tagId),
    onSuccess: refresh,
  })

  const submit = (name: string, type: TagType) => {
    const trimmed = name.trim()
    if (!trimmed) return
    add.mutate({ name: trimmed, type })
  }

  // Quick-pick chips per tag-type. Filtered to those NOT already on this track.
  const existingNames = new Set((list.data ?? []).map((t) => t.name.toLowerCase()))
  const pickable = (vals: string[]) =>
    vals.filter((v) => !existingNames.has(v.toLowerCase()))

  return (
    <div className="space-y-4 overflow-auto p-4 text-sm">
      {/* Currently applied tags */}
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Applied</p>
        {(list.data ?? []).length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">No tags yet — add some below.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {(list.data ?? []).map((t) => (
              <ChipRemovable key={t.id} tag={t} onRemove={() => remove.mutate(t.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Free-form add */}
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Add tag</p>
        <div className="flex items-center gap-1">
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as TagType)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
          >
            <option value="Role">Role</option>
            <option value="Vibe">Vibe</option>
            <option value="Vocal">Vocal</option>
            <option value="Era">Era</option>
            <option value="Custom">Custom</option>
          </select>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(draftName, draftType)
            }}
            placeholder="tag name"
            list="library-tags-datalist"
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs focus:border-[var(--color-accent)] focus:outline-none"
          />
          {/* Datalist gives autocomplete from existing library tags */}
          <datalist id="library-tags-datalist">
            {(all.data ?? []).map((t) => (
              <option key={`${t.type}:${t.name}`} value={t.name}>
                {t.type}
              </option>
            ))}
          </datalist>
          <button
            onClick={() => submit(draftName, draftType)}
            disabled={!draftName.trim() || add.isPending}
            className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            +
          </button>
        </div>
        {add.isError && (
          <p className="mt-1 text-[11px] text-red-400">{(add.error as Error).message}</p>
        )}
      </div>

      {/* Quick picks */}
      <div className="space-y-2">
        <QuickPickRow label="Role" type="Role" picks={pickable(SEED_ROLE)} onPick={(n) => submit(n, 'Role')} />
        <QuickPickRow label="Vibe" type="Vibe" picks={pickable(SEED_VIBE)} onPick={(n) => submit(n, 'Vibe')} />
        <QuickPickRow label="Vocal" type="Vocal" picks={pickable(SEED_VOCAL)} onPick={(n) => submit(n, 'Vocal')} />
        <QuickPickRow label="Era" type="Era" picks={pickable(SEED_ERA)} onPick={(n) => submit(n, 'Era')} />
      </div>
    </div>
  )
}

const SEED_ROLE = ['opener', 'warm-up', 'builder', 'peak-time', 'closer', 'emergency', 'tool']
const SEED_VIBE = ['dark', 'uplifting', 'deep', 'tribal', 'garagey', 'dub', 'funky', 'soulful', 'minimal']
const SEED_VOCAL = ['vocal-heavy', 'instrumental', 'acapella', 'dub']
const SEED_ERA = ['90s', 'early-00s', 'blog-era', 'current']

function QuickPickRow({
  label,
  type: _type,
  picks,
  onPick,
}: {
  label: string
  type: TagType
  picks: string[]
  onPick: (name: string) => void
}) {
  if (picks.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <div className="flex flex-wrap gap-1">
        {picks.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
          >
            + {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function ChipRemovable({ tag, onRemove }: { tag: TrackTag; onRemove: () => void }) {
  const tone =
    tag.type === 'Role' ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' :
    tag.type === 'Vibe' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' :
    tag.type === 'Vocal' ? 'border-pink-500/40 bg-pink-500/10 text-pink-200' :
    tag.type === 'Era' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' :
    'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-muted)]'
  return (
    <span className={`group inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${tone}`}>
      <span>{tag.name}</span>
      <button
        onClick={onRemove}
        className="text-current opacity-50 hover:opacity-100"
        title="Remove tag"
        aria-label={`Remove ${tag.name}`}
      >
        ×
      </button>
    </span>
  )
}
