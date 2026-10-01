import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Disc3, ExternalLink, X } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { youtubeLinks } from '../discover/youtubeLinks'
import { discovery } from '../../api/discovery'
import type { DigitalMatch, DiscoveredTrack, DiscoveryStatus } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { SoulseekDialog } from '../soulseek/SoulseekDialog'

interface Props {
  trackId: string
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
}

export function DiscoveredTrackDetail({ trackId, onClose, onDirtyChange }: Props) {
  const qc = useQueryClient()
  const [slskdOpen, setSlskdOpen] = useState(false)
  const detail = useQuery({
    queryKey: ['discovery-track', trackId],
    queryFn: () => discovery.getTrack(trackId),
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't close the inspector when the user hits Esc with the
      // Soulseek dialog open — that dialog handles its own Esc.
      if (
        e.key === 'Escape' &&
        !slskdOpen &&
        !e.defaultPrevented &&
        !document.querySelector('dialog:modal')
      )
        onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, slskdOpen])

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
    <aside className="crate-track-inspector" aria-label="Discovery track details">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {detail.data?.track.parsedArtist
                ? `${detail.data.track.parsedArtist} — ${detail.data.track.parsedTitle}`
                : (detail.data?.track.rawTitle ?? '…')}
            </h2>
            <p className="truncate text-xs text-[var(--color-muted)]">
              {detail.data?.track.rawTitle}
            </p>
          </div>
          <IconButton small variant="quiet" label="Close discovery details" onClick={onClose}>
            <X />
          </IconButton>
        </header>

        {detail.isLoading && (
          <p role="status" className="workspace-empty">
            Loading track details…
          </p>
        )}
        {detail.error && (
          <StatusMessage tone="error">
            Could not load track details: {detail.error.message}.{' '}
            <Button small onClick={() => void detail.refetch()}>
              Retry discovery details
            </Button>
          </StatusMessage>
        )}
        {setStatus.error && (
          <StatusMessage tone="error">
            Could not save status: {setStatus.error.message}. Try the status action again.
          </StatusMessage>
        )}
        {runMatch.error && (
          <StatusMessage tone="error">
            Availability check failed: {runMatch.error.message}. Try Check availability again.
          </StatusMessage>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-r border-[var(--color-border)] p-4">
            {detail.data && (
              <div className="aspect-video w-full overflow-hidden rounded bg-black">
                <iframe
                  src={youtubeLinks.embed(detail.data.track.sourceVideoId)}
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
                onDirtyChange={onDirtyChange}
              />
            )}
          </div>

          <div className="flex min-h-0 flex-col">
            {/* Status — mutually exclusive trio. Want/Have/Ignore as a tight segmented control,
                Reset breaks out as a tertiary link so it doesn't compete with the primary three. */}
            <div className="border-b border-[var(--color-border)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Status
                </h3>
                {detail.data && detail.data.track.status !== 'New' && (
                  <Button
                    small
                    variant="quiet"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate('New')}
                    className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-white"
                    title="Clear status back to New"
                  >
                    Reset
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['Want', 'AlreadyHave', 'Ignore'] as DiscoveryStatus[]).map((s) => {
                  const active = detail.data?.track.status === s
                  return (
                    <Button
                      small
                      variant={active ? 'primary' : 'secondary'}
                      key={s}
                      onClick={() => setStatus.mutate(s)}
                      disabled={setStatus.isPending || !detail.data}
                      aria-pressed={active}
                      className={[
                        'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                        active
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white'
                          : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-white',
                      ].join(' ')}
                    >
                      {s === 'AlreadyHave' ? 'Already have' : s}
                    </Button>
                  )
                })}
              </div>
              {detail.data?.track.isAlreadyInLibrary && (
                <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-300">
                  <Check size={11} strokeWidth={2} /> Already in your library — Wisp matched this
                  against your scanned tracks.
                </p>
              )}
            </div>

            {/* Find this track — actions block. Soulseek panel sits inline (per design call:
                stays grouped with the rest of Crate Digger; not split into a separate header). */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Find this track
              </h3>

              <section className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[11px] font-medium text-[var(--color-muted)]">
                    Digital availability
                  </h4>
                  <Button
                    small
                    onClick={() => runMatch.mutate()}
                    disabled={runMatch.isPending || !detail.data?.track.parsedArtist}
                    className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-white/5 disabled:opacity-40"
                    title={
                      !detail.data?.track.parsedArtist
                        ? 'Set artist + title first'
                        : 'Run availability check'
                    }
                  >
                    {runMatch.isPending ? 'Searching…' : 'Check availability'}
                  </Button>
                </div>

                {!detail.data?.matches?.length ? (
                  <p className="text-xs text-[var(--color-muted)]">
                    Click <strong>Check availability</strong> to query Discogs and build search
                    links for Beatport / Juno / Bandcamp / Traxsource.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.data.matches.map((m) => (
                      <MatchRow key={m.id} match={m} />
                    ))}
                  </ul>
                )}
              </section>

              {detail.data && (
                <section className="mt-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                    Soulseek (slskd)
                  </h3>
                  <Button
                    small
                    onClick={() => setSlskdOpen(true)}
                    disabled={!detail.data.track.parsedArtist && !detail.data.track.parsedTitle}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--color-accent)]/40 px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40"
                    title="Open Soulseek search dialog"
                  >
                    <Disc3 size={14} strokeWidth={1.75} /> Search Soulseek
                  </Button>
                </section>
              )}
              {slskdOpen && detail.data && (
                <SoulseekDialog
                  initialArtist={detail.data.track.parsedArtist}
                  initialTitle={detail.data.track.parsedTitle}
                  onClose={() => setSlskdOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function ParseCorrectionForm({
  track,
  onSaved,
  onDirtyChange,
}: {
  track: DiscoveredTrack
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
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
    onSuccess: () => {
      onSaved()
      onDirtyChange(false)
    },
  })

  const dirty =
    (artist || null) !== (track.parsedArtist ?? null) ||
    (title || null) !== (track.parsedTitle ?? null) ||
    (version || null) !== (track.mixVersion ?? null) ||
    (year ? Number(year) : null) !== (track.releaseYear ?? null)

  return (
    <details className="mt-4">
      <summary className="text-xs font-medium">Correct artist / title</summary>
      <div className="mt-3">
        <div className="space-y-2">
          <Field
            label="Artist"
            disabled={save.isPending}
            value={artist}
            onChange={(value) => {
              setArtist(value)
              onDirtyChange(true)
            }}
          />
          <Field
            label="Title"
            disabled={save.isPending}
            value={title}
            onChange={(value) => {
              setTitle(value)
              onDirtyChange(true)
            }}
          />
          <Field
            label="Version"
            disabled={save.isPending}
            value={version}
            onChange={(value) => {
              setVersion(value)
              onDirtyChange(true)
            }}
          />
          <Field
            label="Year"
            disabled={save.isPending}
            value={year}
            onChange={(value) => {
              setYear(value)
              onDirtyChange(true)
            }}
            type="number"
          />
        </div>
        <Button
          small
          variant="primary"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="mt-2 w-full rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white disabled:opacity-30"
        >
          {save.isPending ? 'Saving…' : 'Save correction'}
        </Button>
        {save.error && (
          <StatusMessage tone="error">
            Could not save correction: {save.error.message}. Your fields are still here; try Save
            correction again.
          </StatusMessage>
        )}
      </div>
    </details>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  disabled?: boolean
}) {
  return (
    <label className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <input
        type={type}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
      />
    </label>
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
        className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-white disabled:opacity-30"
      >
        Open <ExternalLink size={10} strokeWidth={1.75} />
      </button>
    </li>
  )
}
