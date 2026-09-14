import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AudioLines, CircleCheck, CircleDot, Search, Star, Upload } from 'lucide-react'
import { apiGet } from '../../api/client'
import type { Session } from './useRecorderStatus'
import { useRecordingNavigation } from './useRecordingTracklist'

export interface Mix {
  session: Session
  rating: number | null
  reviewStatus?: string
  plannedSet?: string | null
  duration: number
  missing: boolean
}
const mixClock = (n: number) =>
  `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`

function Thumbnail({ mix }: { mix: Mix }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '80px',
    })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const peaks = useQuery({
    queryKey: ['recording-thumbnail', mix.session.id],
    queryFn: async () =>
      (await apiGet<number[] | null>(`/api/recording-workspace/${mix.session.id}/thumbnail`)) ??
      null,
    enabled: visible && !mix.missing && mix.session.state === 'Ready',
    staleTime: 60_000,
  })
  return (
    <div ref={ref} className="wm-thumbnail" aria-hidden="true">
      {peaks.data?.length ? (
        peaks.data.map((peak, i) => (
          <span key={i} style={{ height: `${Math.max(2, Math.min(1, peak) * 100)}%` }} />
        ))
      ) : (
        <AudioLines />
      )}
    </div>
  )
}

export function MixesLibrary({
  mixes,
  loading,
  importMix,
  importDisabled,
}: {
  mixes: Mix[]
  loading: boolean
  importMix: () => void
  importDisabled: boolean
}) {
  const nav = useRecordingNavigation()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('date')
  const [filter, setFilter] = useState('all')
  const rows = mixes
    .filter(
      (m) =>
        m.session.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (filter === 'all' ||
          (filter === 'recovery'
            ? m.missing || m.session.state === 'Recoverable'
            : m.reviewStatus === filter)),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.session.title.localeCompare(b.session.title)
        : sort === 'duration'
          ? b.duration - a.duration
          : sort === 'rating'
            ? (b.rating ?? 0) - (a.rating ?? 0)
            : b.session.startedAt.localeCompare(a.session.startedAt),
    )
  return (
    <>
      <header className="wm-heading">
        <div>
          <p className="wm-eyebrow">Record / listen / refine</p>
          <h1>Your mixes</h1>
          <p className="wm-subtitle">A home for every take. A little better each time.</p>
        </div>
        <div className="wm-actions">
          <button className="wm-button wm-quiet" disabled={importDisabled} onClick={importMix}>
            <Upload /> Import a mix
          </button>
          <button className="wm-button wm-primary" onClick={nav.record}>
            <CircleDot /> Record a mix
          </button>
        </div>
      </header>
      <div className="wm-library-tools">
        <label className="wm-search">
          <Search />
          <input
            placeholder="Find a mix…"
            aria-label="Find a mix"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="wm-field"
          aria-label="Filter mixes"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All mixes</option>
          <option>Needs review</option>
          <option>Ready to share</option>
          <option value="recovery">Needs attention</option>
        </select>
        <select
          className="wm-field"
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="date">Newest first</option>
          <option value="title">Title A–Z</option>
          <option value="duration">Longest first</option>
          <option value="rating">Highest rated</option>
        </select>
      </div>
      <section aria-label="Mix history" className="wm-library-list">
        {loading ? (
          <p role="status">Loading your mixes…</p>
        ) : rows.length === 0 ? (
          <div className="wm-empty">
            <AudioLines />
            <h2>
              {search || filter !== 'all' ? 'No matching mixes' : 'Your next practice starts here'}
            </h2>
            <p>
              {search || filter !== 'all'
                ? 'Try a different title or filter.'
                : 'Record your mixer’s stereo input, or import a mix you already made.'}
            </p>
          </div>
        ) : (
          rows.map((m) => (
            <button
              key={m.session.id}
              className="wm-mix-row"
              onClick={() => nav.select(m.session.id)}
            >
              <Thumbnail mix={m} />
              <span className="wm-mix-name">
                <strong>{m.session.title}</strong>
                <span className="wm-subtitle">
                  {new Date(m.session.startedAt).toLocaleDateString()} · {mixClock(m.duration)}
                  {m.plannedSet && ` · Planned set: ${m.plannedSet}`}
                  {m.session.previousTakeId && ' · Linked take'}
                </span>
              </span>
              <span className="wm-mix-meta">
                <span
                  className="wm-stars"
                  aria-label={m.rating ? `${m.rating} out of 5` : 'Unrated'}
                >
                  {m.rating
                    ? [1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={n <= m.rating! ? 'is-filled' : ''} />
                      ))
                    : 'Unrated'}
                </span>
                <span
                  className={
                    m.missing || m.session.state === 'Recoverable' ? 'wm-warning' : 'wm-muted'
                  }
                >
                  {m.missing ? (
                    'Missing file'
                  ) : m.session.state !== 'Ready' ? (
                    m.session.state
                  ) : m.reviewStatus === 'Ready to share' ? (
                    <>
                      <CircleCheck /> Ready to share
                    </>
                  ) : (
                    (m.reviewStatus ?? 'Not reviewed')
                  )}
                </span>
              </span>
            </button>
          ))
        )}
      </section>
    </>
  )
}
