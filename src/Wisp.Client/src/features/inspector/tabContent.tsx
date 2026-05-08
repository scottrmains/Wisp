import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tracks as tracksApi } from '../../api/library'
import { tags as tagsApi } from '../../api/tags'
import type { TagType, Track, TrackTag } from '../../api/types'
import { usePlayer } from '../../state/player'
import { useCues } from '../cues/useCues'
import { formatBpm, formatDuration } from '../library/format'

/// Shared tab content components for the track inspector / track prep workspace.
/// Each tab is a self-contained, scrollable region — host components decide how
/// to lay out the surrounding chrome (header, action row, tab bar).

export function OverviewTab({ track }: { track: Track }) {
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

const CUE_TYPES = ['FirstBeat', 'Intro', 'MixIn', 'Breakdown', 'Drop', 'VocalIn', 'MixOut', 'Outro', 'Custom'] as const
type CueTypeName = typeof CUE_TYPES[number]

export function CuesTab({ track }: { track: Track }) {
  const { cues, loading, update, remove, generatePhraseMarkers } = useCues(track.id)
  const seek = usePlayer((s) => s.seek)
  const position = usePlayer((s) => s.position)
  const playerTrackId = usePlayer((s) => s.trackId)
  const playTrack = usePlayer((s) => s.playTrack)

  const handleJump = (timeSeconds: number) => {
    if (playerTrackId !== track.id) playTrack(track.id)
    setTimeout(() => seek(timeSeconds), 50)
  }

  /// "Generate phrases" anchors at the current playhead and walks the rest of
  /// the track at 16-beat (4-bar) intervals using the track's BPM. Mirrors the
  /// MiK pattern: pause at the kick on bar 1, click generate, the rest of the
  /// markers extrapolate from there. No DSP needed because dance music holds
  /// its grid throughout a tagged BPM.
  const phraseAnchorTime = playerTrackId === track.id && position > 0 ? position : 0
  const handleGeneratePhrases = () => {
    if (track.bpm === null) return
    if (cues.some((c) => c.isAutoSuggested) && !window.confirm(
      'This track already has auto-generated phrase markers. Generate again will keep them and add more — clear them first via the trash icon if you want a fresh set. Continue?',
    )) return
    generatePhraseMarkers.mutate({
      firstBeatSeconds: phraseAnchorTime,
      stepBeats: 16,
      replaceExisting: false,
    })
  }

  // Header — "Generate phrases" is always available; cue list renders below.
  // We don't gate the header behind cues.length > 0 because the empty state
  // is the most common moment the user wants to use generate.
  const header = track.bpm !== null && (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)]/40 px-5 py-2 text-xs">
      <span className="text-[var(--color-muted)]">Anchor at</span>
      <span className="tabular-nums text-white">{formatDuration(phraseAnchorTime)}</span>
      <span className="text-[var(--color-muted)]">
        · {Number(track.bpm).toFixed(0)} BPM · 16-beat phrases
      </span>
      <button
        onClick={handleGeneratePhrases}
        disabled={generatePhraseMarkers.isPending}
        className="ml-auto rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        title="Use the current playhead as the first beat; extrapolate phrase markers across the rest of the track using the BPM"
      >
        {generatePhraseMarkers.isPending ? 'Generating…' : '✨ Generate phrases'}
      </button>
    </div>
  )

  if (loading) return <p className="px-5 py-6 text-sm text-[var(--color-muted)]">Loading cues…</p>
  if (cues.length === 0) {
    return (
      <div>
        {header}
        <div className="space-y-2 px-5 py-6 text-sm text-[var(--color-muted)]">
          <p>
            No cue points yet. Press <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 text-[10px]">Q</kbd> while a track is playing to add one at the playhead, or click <strong>＋ Cue</strong> in the action row.
          </p>
          {track.bpm !== null && (
            <p className="text-xs">
              For phrase markers across the whole track: pause at the kick on bar 1, then click <strong>✨ Generate phrases</strong> above — Wisp uses the playhead as the first beat and extrapolates from your BPM tag.
            </p>
          )}
          {track.bpm === null && (
            <p className="text-xs italic">
              "Generate phrases" needs a BPM tag on this track. Add one via the cleanup flow first.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}
      <ul className="overflow-auto py-1">
      {cues.map((c, i) => (
        <li
          key={c.id}
          className="flex items-center gap-2 border-b border-[var(--color-border)]/30 px-5 py-1.5 text-sm hover:bg-white/5"
        >
          {/* Index badge — matches the 1-8 hotkey assignment so the user sees
              which number jumps to which cue. */}
          {i < 8 ? (
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--color-bg)] text-[10px] font-semibold tabular-nums text-[var(--color-muted)]">
              {i + 1}
            </span>
          ) : (
            <span className="w-5" />
          )}

          {/* Type dropdown — quick way to re-classify a cue without going through a modal. */}
          <select
            value={c.type}
            onChange={(e) => update.mutate({ id: c.id, type: e.target.value as CueTypeName })}
            className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px]"
          >
            {CUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Inline-editable label. Saves on blur; empty input falls back to type name. */}
          <InlineLabelEdit
            initial={c.label && c.label !== c.type ? c.label : ''}
            placeholder={c.type}
            onSave={(label) => update.mutate({ id: c.id, label })}
          />

          <span className="shrink-0 tabular-nums text-xs text-[var(--color-muted)]">
            {formatDuration(c.timeSeconds)}
          </span>
          <button
            onClick={() => handleJump(c.timeSeconds)}
            className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            title="Jump to cue"
            aria-label="Jump to cue"
          >
            ↪
          </button>
          <button
            onClick={() => remove.mutate(c.id)}
            className="shrink-0 text-[var(--color-muted)] hover:text-red-400"
            title="Delete cue"
            aria-label="Delete cue"
          >
            🗑
          </button>
        </li>
      ))}
      </ul>
    </div>
  )
}

function InlineLabelEdit({
  initial,
  placeholder,
  onSave,
}: {
  initial: string
  placeholder: string
  onSave: (label: string) => void
}) {
  const [value, setValue] = useState(initial)
  // Reset draft when the cue's saved label changes externally (rename via another path).
  useEffect(() => { setValue(initial) }, [initial])

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initial) onSave(value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setValue(initial)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:bg-[var(--color-bg)] focus:outline-none"
    />
  )
}

export function MetadataTab({ track }: { track: Track }) {
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

export function NotesTab({ track }: { track: Track }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(track.notes ?? '')
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Reset the draft whenever we land on a different track.
  useEffect(() => {
    setDraft(track.notes ?? '')
    setSavedAt(null)
  }, [track.id, track.notes])

  const save = useMutation({
    mutationFn: (notes: string | null) => tracksApi.updateNotes(track.id, notes),
    onSuccess: (updated) => {
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
        className="min-h-[6rem] flex-1 resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm leading-relaxed placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
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

const SEED_ROLE = ['opener', 'warm-up', 'builder', 'peak-time', 'closer', 'emergency', 'tool']
const SEED_VIBE = ['dark', 'uplifting', 'deep', 'tribal', 'garagey', 'dub', 'funky', 'soulful', 'minimal']
const SEED_VOCAL = ['vocal-heavy', 'instrumental', 'acapella', 'dub']
const SEED_ERA = ['90s', 'early-00s', 'blog-era', 'current']

export function TagsTab({ track }: { track: Track }) {
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

  const existingNames = new Set((list.data ?? []).map((t) => t.name.toLowerCase()))
  const pickable = (vals: string[]) =>
    vals.filter((v) => !existingNames.has(v.toLowerCase()))

  return (
    <div className="space-y-4 overflow-auto p-4 text-sm">
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
          <datalist id="library-tags-datalist">
            {(all.data ?? []).map((t) => (
              <option key={`${t.type}:${t.name}`} value={t.name}>{t.type}</option>
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

      <div className="space-y-2">
        <QuickPickRow label="Role" picks={pickable(SEED_ROLE)} onPick={(n) => submit(n, 'Role')} />
        <QuickPickRow label="Vibe" picks={pickable(SEED_VIBE)} onPick={(n) => submit(n, 'Vibe')} />
        <QuickPickRow label="Vocal" picks={pickable(SEED_VOCAL)} onPick={(n) => submit(n, 'Vocal')} />
        <QuickPickRow label="Era" picks={pickable(SEED_ERA)} onPick={(n) => submit(n, 'Era')} />
      </div>
    </div>
  )
}

function QuickPickRow({
  label,
  picks,
  onPick,
}: {
  label: string
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
