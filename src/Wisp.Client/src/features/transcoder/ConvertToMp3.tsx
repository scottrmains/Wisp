import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Track } from '../../api/types'
import { transcoder } from '../../api/transcoder'
import { bridge, bridgeAvailable } from '../../bridge'

/// Workspace action button + inline dialog for Phase 23's "Convert to MP3 320".
/// Only renders when:
///   - the transcoder backend reports ready (FFmpeg detected)
///   - the loaded track isn't already MP3 (no point converting MP3 → MP3)
///
/// Discovery + conversion are decoupled: the status query stays warm in
/// TanStack cache so flipping between tracks doesn't re-probe FFmpeg.

const NON_MP3_EXTENSIONS = new Set(['flac', 'wav', 'aiff', 'aif', 'ogg', 'opus', 'm4a'])

function getExtension(path: string): string {
  const idx = path.lastIndexOf('.')
  return idx >= 0 ? path.slice(idx + 1).toLowerCase() : ''
}

export function ConvertToMp3Button({ track }: { track: Track }) {
  const status = useQuery({
    queryKey: ['transcoder-status'],
    queryFn: () => transcoder.status(),
    staleTime: 5 * 60_000, // FFmpeg presence doesn't change mid-session
  })
  const [open, setOpen] = useState(false)

  const ext = getExtension(track.filePath)
  // Hide entirely for already-MP3 tracks — there's nothing useful to do.
  if (ext === 'mp3') return null
  // Hide when the source isn't a format we support converting from. Avoids
  // surfacing the button for, say, OGG-Vorbis-only tracks where FFmpeg
  // could in theory transcode but isn't the user's intent here.
  if (!NON_MP3_EXTENSIONS.has(ext)) return null
  // Hide while we don't know the status; flicker-safe.
  if (!status.data) return null

  const isReady = status.data.isReady
  const tooltip = isReady
    ? `Convert this ${ext.toUpperCase()} to MP3 320 kbps (lands next to the source file)`
    : 'FFmpeg not found — bundle it via tools/get-ffmpeg.ps1 or set the path in Settings.'

  return (
    <>
      <button
        onClick={() => isReady && setOpen(true)}
        disabled={!isReady}
        title={tooltip}
        className={[
          'rounded-md border px-3 py-1.5 text-xs',
          isReady
            ? 'border-[var(--color-border)] text-[var(--color-muted)] hover:bg-white/5 hover:text-white'
            : 'border-[var(--color-border)] text-[var(--color-muted)]/50 cursor-not-allowed',
        ].join(' ')}
      >
        ⚙ MP3 320
      </button>
      {open && <ConvertDialog track={track} onClose={() => setOpen(false)} />}
    </>
  )
}

function ConvertDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const convert = useMutation({
    mutationFn: () => transcoder.convertToMp3(track.id, { bitrate: 320 }),
  })

  // Auto-fire the mutation on first render. Wraps in a one-shot effect-ish
  // pattern via mutate() being idempotent under React Query — safe because
  // we re-mount this component each time the dialog opens.
  if (convert.isIdle) convert.mutate()

  const close = () => {
    if (convert.isPending) return // don't close mid-convert; user could orphan a process
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
        <h2 className="text-base font-semibold">Convert to MP3 320</h2>
        <p className="mt-1 truncate text-xs text-[var(--color-muted)]" title={track.filePath}>
          {track.artist ?? 'Unknown'} — {track.title ?? track.fileName}
        </p>

        {convert.isPending && (
          <div className="mt-4 flex items-center gap-3 text-sm text-[var(--color-muted)]">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-[var(--color-accent)]" />
            Converting…
          </div>
        )}

        {convert.isError && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-red-400">{(convert.error as Error).message}</p>
            <p className="text-xs text-[var(--color-muted)]">
              See the Wisp log file for the full FFmpeg output.
            </p>
          </div>
        )}

        {convert.isSuccess && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-emerald-300">✓ Done</p>
            <p className="break-all text-xs text-[var(--color-muted)]">
              {convert.data.outputPath}
            </p>
            <p className="text-[11px] text-[var(--color-muted)]">
              {(convert.data.sizeBytes / (1024 * 1024)).toFixed(1)} MB · {Math.round(convert.data.durationSeconds)}s audio
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {convert.isSuccess && bridgeAvailable() && (
            <button
              onClick={() => bridge.openInExplorer(convert.data!.outputPath)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
            >
              ↗ Reveal
            </button>
          )}
          <button
            onClick={close}
            disabled={convert.isPending}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {convert.isPending ? 'Converting…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
