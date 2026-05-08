import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { discovery } from '../../api/discovery'
import type { DigitalMatch, DiscoveredTrack, DiscoveryStatus } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { SoulseekPanel } from './SoulseekPanel'

interface Props {
  trackId: string
  onClose: () => void
}

export function DiscoveredTrackDetail({ trackId, onClose }: Props) {
  const qc = useQueryClient()
  const detail = useQuery({
    queryKey: ['discovery-track', trackId],
    queryFn: () => discovery.getTrack(trackId),
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['discovery-track', trackId] })
    if (detail.data?.track.discoverySourceId) {
      qc.invalidateQueries({ queryKey: ['discovery-tracks', detail.data.track.discoverySourceId] })
    }
  }

  const setStatus = useMutation({
    mutationFn: (status: DiscoveryStatus) => discovery.updateStatus(trackId, status),
    onSuccess: invalidate,
  })

  const runMatch = useMutation({
    mutationFn: () => discovery.match(trackId),
    onSuccess: invalidate,
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {detail.data?.track.parsedArtist
                ? `${detail.data.track.parsedArtist} — ${detail.data.track.parsedTitle}`
                : (detail.data?.track.rawTitle ?? '…')}
            </h2>
            <p className="truncate text-xs text-[var(--color-muted)]">{detail.data?.track.rawTitle}</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-[var(--color-muted)] hover:text-white">
            ×
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-0 overflow-y-auto">
          <div className="border-r border-[var(--color-border)] p-4">
            {detail.data && (
              <div className="aspect-video w-full overflow-hidden rounded bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${detail.data.track.sourceVideoId}`}
                  title="YouTube preview"
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            {detail.data && (
              <ParseCorrectionForm
                track={detail.data.track}
                onSaved={invalidate}
              />
            )}
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-[var(--color-border)] p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Status
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {(['Want', 'AlreadyHave', 'Ignore'] as DiscoveryStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus.mutate(s)}
                    disabled={setStatus.isPending}
                    className={[
                      'rounded border px-2.5 py-1 text-xs',
                      detail.data?.track.status === s
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-white',
                    ].join(' ')}
                  >
                    {s === 'AlreadyHave' ? 'Already have' : s}
                  </button>
                ))}
                {detail.data?.track.status !== 'New' && (
                  <button
                    onClick={() => setStatus.mutate('New')}
                    className="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-white"
                  >
                    Reset
                  </button>
                )}
              </div>
              {detail.data?.track.isAlreadyInLibrary && (
                <p className="mt-2 text-[11px] text-blue-300">
                  ✓ Already in your library — Wisp matched this against your scanned tracks.
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Digital availability
                </h3>
                <button
                  onClick={() => runMatch.mutate()}
                  disabled={runMatch.isPending || !detail.data?.track.parsedArtist}
                  className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-white/5 disabled:opacity-40"
                  title={!detail.data?.track.parsedArtist ? 'Set artist + title first' : 'Run availability check'}
                >
                  {runMatch.isPending ? 'Searching…' : 'Check availability'}
                </button>
              </div>

              {!detail.data?.matches?.length ? (
                <p className="text-xs text-[var(--color-muted)]">
                  Click <strong>Check availability</strong> to query Discogs and build search links for Beatport / Juno / Bandcamp / Traxsource.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.data.matches.map((m) => <MatchRow key={m.id} match={m} />)}
                </ul>
              )}

              {detail.data && (
                <SoulseekPanel
                  artist={detail.data.track.parsedArtist}
                  title={detail.data.track.parsedTitle}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ParseCorrectionForm({ track, onSaved }: { track: DiscoveredTrack; onSaved: () => void }) {
  const [artist, setArtist] = useState(track.parsedArtist ?? '')
  const [title, setTitle] = useState(track.parsedTitle ?? '')
  const [version, setVersion] = useState(track.mixVersion ?? '')
  const [year, setYear] = useState(track.releaseYear?.toString() ?? '')

  const save = useMutation({
    mutationFn: () =>
      discovery.updateParse(track.id, {
        artist: artist || null,
        title: title || null,
        version: version || null,
        year: year ? Number(year) : null,
      }),
    onSuccess: onSaved,
  })

  const dirty =
    (artist || null) !== (track.parsedArtist ?? null) ||
    (title || null) !== (track.parsedTitle ?? null) ||
    (version || null) !== (track.mixVersion ?? null) ||
    (year ? Number(year) : null) !== (track.releaseYear ?? null)

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Parsed metadata
      </h3>
      <div className="space-y-2">
        <Field label="Artist" value={artist} onChange={setArtist} />
        <Field label="Title" value={title} onChange={setTitle} />
        <Field label="Version" value={version} onChange={setVersion} />
        <Field label="Year" value={year} onChange={setYear} type="number" />
      </div>
      <button
        onClick={() => save.mutate()}
        disabled={!dirty || save.isPending}
        className="mt-2 w-full rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white disabled:opacity-30"
      >
        {save.isPending ? 'Saving…' : 'Save correction'}
      </button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
      <label className="text-xs text-[var(--color-muted)]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
      />
    </div>
  )
}

function MatchRow({ match }: { match: DigitalMatch }) {
  const tone =
    match.confidenceScore >= 90
      ? 'bg-emerald-500/20 text-emerald-300'
      : match.confidenceScore >= 70
        ? 'bg-amber-500/20 text-amber-300'
        : match.confidenceScore >= 50
          ? 'bg-white/10 text-[var(--color-muted)]'
          : 'bg-white/5 text-[var(--color-muted)]'

  const isSearchLink = match.availability === 'SearchLink'
  const sourceColour =
    match.source === 'Discogs'
      ? 'text-orange-300'
      : match.source === 'Beatport'
        ? 'text-emerald-300'
        : match.source === 'Bandcamp'
          ? 'text-blue-300'
          : 'text-[var(--color-muted)]'

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`shrink-0 font-semibold ${sourceColour}`}>{match.source}</span>
        {isSearchLink ? (
          <span className="text-[var(--color-muted)]">search</span>
        ) : (
          <>
            <span className="truncate">{match.title}</span>
            {match.year && <span className="text-[var(--color-muted)]">{match.year}</span>}
            {match.confidenceScore > 0 && (
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${tone}`}>
                {match.confidenceScore}
              </span>
            )}
          </>
        )}
      </div>
      <button
        onClick={() => bridgeAvailable() && void bridge.openExternal(match.url)}
        disabled={!bridgeAvailable() || !match.url}
        className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-white disabled:opacity-30"
      >
        Open ↗
      </button>
    </li>
  )
}
