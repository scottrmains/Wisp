import { useQuery } from '@tanstack/react-query'
import { tags as tagsApi } from '../../api/tags'
import type { TrackQuery } from '../../api/types'

interface Props {
  query: TrackQuery
  onChange: (next: TrackQuery) => void
  total: number
}

type ArchiveTab = 'active' | 'archived' | 'all'

function currentArchiveTab(q: TrackQuery): ArchiveTab {
  if (q.archivedOnly) return 'archived'
  if (q.includeArchived) return 'all'
  return 'active'
}

export function LibraryFilters({ query, onChange, total }: Props) {
  const set = <K extends keyof TrackQuery>(k: K, v: TrackQuery[K]) =>
    onChange({ ...query, [k]: v, page: 1 })

  const setTab = (tab: ArchiveTab) => {
    onChange({
      ...query,
      includeArchived: tab === 'all' || undefined,
      archivedOnly: tab === 'archived' || undefined,
      page: 1,
    })
  }

  const allTags = useQuery({
    queryKey: ['library-tags'],
    queryFn: () => tagsApi.all(),
    staleTime: 30_000,
  })

  const tab = currentArchiveTab(query)
  const activeTags = query.tag ?? []
  const toggleTag = (name: string) => {
    const next = activeTags.includes(name)
      ? activeTags.filter((t) => t !== name)
      : [...activeTags, name]
    set('tag', next.length > 0 ? next : undefined)
  }

  return (
    <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query.search ?? ''}
          onChange={(e) => set('search', e.target.value || undefined)}
          placeholder="Search artist / title / album"
          className="min-w-[16rem] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />

        <input
          value={query.key ?? ''}
          onChange={(e) => set('key', e.target.value || undefined)}
          placeholder="Key (e.g. 8A)"
          className="w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />

        <div className="flex items-center gap-1 text-sm">
          <span className="text-[var(--color-muted)]">BPM</span>
          <input
            type="number"
            min={40}
            max={240}
            value={query.bpmMin ?? ''}
            onChange={(e) => set('bpmMin', e.target.value ? Number(e.target.value) : undefined)}
            placeholder="min"
            className="w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          <span className="text-[var(--color-muted)]">–</span>
          <input
            type="number"
            min={40}
            max={240}
            value={query.bpmMax ?? ''}
            onChange={(e) => set('bpmMax', e.target.value ? Number(e.target.value) : undefined)}
            placeholder="max"
            className="w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={query.missing ?? false}
            onChange={(e) => set('missing', e.target.checked || undefined)}
          />
          Missing metadata
        </label>

        {/* Archive tabs — Active by default; All mixes archived back in; Archived shows only retired tracks. */}
        <div className="flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5 text-xs">
          {(['active', 'all', 'archived'] as ArchiveTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'rounded px-2 py-1 capitalize',
                tab === t ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)] hover:text-white',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="ml-auto text-sm text-[var(--color-muted)]">
          {total.toLocaleString()} tracks
        </div>
      </div>

      {/* Tag filter row — only render if there's at least one tag in the library. */}
      {allTags.data && allTags.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Tags:</span>
          {allTags.data.slice(0, 30).map((t) => {
            const active = activeTags.includes(t.name)
            return (
              <button
                key={t.name}
                onClick={() => toggleTag(t.name)}
                className={[
                  'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white'
                    : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-white',
                ].join(' ')}
                title={`${t.useCount} ${t.useCount === 1 ? 'track' : 'tracks'}`}
              >
                {t.name}
              </button>
            )
          })}
          {activeTags.length > 0 && (
            <button
              onClick={() => set('tag', undefined)}
              className="ml-1 text-[10px] text-[var(--color-muted)] hover:text-white"
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
