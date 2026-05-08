import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tags as tagsApi } from '../../api/tags'
import type { TagType } from '../../api/types'

interface Props {
  trackIds: string[]
  onClose: () => void
  onApplied?: (count: number) => void
}

const SEED: Record<TagType, string[]> = {
  Role: ['opener', 'warm-up', 'builder', 'peak-time', 'closer', 'emergency', 'tool'],
  Vibe: ['dark', 'uplifting', 'deep', 'tribal', 'garagey', 'dub', 'funky', 'soulful', 'minimal'],
  Vocal: ['vocal-heavy', 'instrumental', 'acapella', 'dub'],
  Era: ['90s', 'early-00s', 'blog-era', 'current'],
  Custom: [],
}

/// Apply a single tag to N tracks at once. Reuses the existing add endpoint
/// (idempotent — already-tagged tracks return the existing row, no error).
export function BulkTagDialog({ trackIds, onClose, onApplied }: Props) {
  const qc = useQueryClient()
  const [type, setType] = useState<TagType>('Role')
  const [name, setName] = useState('')

  const all = useQuery({
    queryKey: ['library-tags'],
    queryFn: () => tagsApi.all(),
    staleTime: 30_000,
  })

  const apply = useMutation({
    mutationFn: async ({ tagName, tagType }: { tagName: string; tagType: TagType }) => {
      // Sequential to avoid hammering SQLite with N parallel writes; the action is bounded
      // by the user's selection size which is typically <100 tracks.
      for (const id of trackIds) await tagsApi.add(id, tagName, tagType)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracks'] })
      qc.invalidateQueries({ queryKey: ['library-tags'] })
      // Each track's per-track cache is invalidated cheaply by the broad pattern.
      onApplied?.(trackIds.length)
      onClose()
    },
  })

  const submit = (n: string, t: TagType) => {
    const trimmed = n.trim()
    if (!trimmed) return
    apply.mutate({ tagName: trimmed, tagType: t })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
        <h2 className="text-base font-semibold">Tag {trackIds.length} tracks</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Picks one tag and applies it to every selected track. Already-tagged tracks are skipped silently.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TagType)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
          >
            <option value="Role">Role</option>
            <option value="Vibe">Vibe</option>
            <option value="Vocal">Vocal</option>
            <option value="Era">Era</option>
            <option value="Custom">Custom</option>
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(name, type) }}
            placeholder="tag name"
            list="bulk-tag-datalist"
            autoFocus
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
          <datalist id="bulk-tag-datalist">
            {(all.data ?? []).map((t) => (
              <option key={`${t.type}:${t.name}`} value={t.name}>{t.type}</option>
            ))}
          </datalist>
        </div>

        {/* Quick-pick chips for the selected type */}
        {SEED[type].length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Quick pick</p>
            <div className="flex flex-wrap gap-1">
              {SEED[type].map((p) => (
                <button
                  key={p}
                  onClick={() => submit(p, type)}
                  className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {apply.isError && (
          <p className="mt-2 text-xs text-red-400">{(apply.error as Error).message}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => submit(name, type)}
            disabled={!name.trim() || apply.isPending}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {apply.isPending ? `Tagging…` : `Tag ${trackIds.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}
