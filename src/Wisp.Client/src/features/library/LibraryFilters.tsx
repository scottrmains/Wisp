import type { TrackQuery } from '../../api/types'

interface Props {
  query: TrackQuery
  onChange: (next: TrackQuery) => void
  total: number
}

export function LibraryFilters({ query, onChange, total }: Props) {
  const set = <K extends keyof TrackQuery>(k: K, v: TrackQuery[K]) =>
    onChange({ ...query, [k]: v, page: 1 })

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
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

      <div className="ml-auto text-sm text-[var(--color-muted)]">
        {total.toLocaleString()} tracks
      </div>
    </div>
  )
}
