import type { MixPlanTrack } from '../../api/types'

interface Props {
  tracks: MixPlanTrack[]
}

/// Compact strip above the chain showing energy curve + key path + BPM run.
/// Width is given by parent (flex column), height fixed.
export function ChainStats({ tracks }: Props) {
  if (tracks.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-2 text-xs">
      <EnergyCurve tracks={tracks} />
      <KeyPathView tracks={tracks} />
      <BpmStrip tracks={tracks} />
    </div>
  )
}

function EnergyCurve({ tracks }: { tracks: MixPlanTrack[] }) {
  const W = 800
  const H = 28
  const padX = 8

  const energies = tracks.map((t) => t.track.energy ?? null)
  const knownIdx = energies.flatMap((e, i) => (e === null ? [] : [i]))
  if (knownIdx.length === 0) {
    return <Row label="Energy"><span className="text-[var(--color-muted)]">—</span></Row>
  }

  const xStep = tracks.length > 1 ? (W - padX * 2) / (tracks.length - 1) : 0
  const points = tracks
    .map((t, i) => ({ i, e: t.track.energy ?? null }))
    .filter((p) => p.e !== null)
    .map((p) => `${padX + p.i * xStep},${H - 4 - ((p.e! - 1) / 9) * (H - 8)}`)
    .join(' ')

  return (
    <Row label="Energy">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full">
        <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
        {tracks.map((t, i) =>
          t.track.energy === null ? null : (
            <circle
              key={t.id}
              cx={padX + i * xStep}
              cy={H - 4 - ((t.track.energy - 1) / 9) * (H - 8)}
              r="2.5"
              fill="var(--color-accent)"
            />
          ),
        )}
      </svg>
    </Row>
  )
}

function KeyPathView({ tracks }: { tracks: MixPlanTrack[] }) {
  return (
    <Row label="Key">
      <div className="flex flex-wrap items-center gap-1">
        {tracks.map((t, i) => {
          const k = t.track.musicalKey
          const prev = i > 0 ? tracks[i - 1].track.musicalKey : null
          const warn = isBadTransition(prev, k)
          return (
            <span key={t.id} className="flex items-center gap-1">
              {i > 0 && (
                <span className={warn ? 'text-amber-400' : 'text-[var(--color-muted)]'}>
                  {warn ? '⚠' : '→'}
                </span>
              )}
              <span
                className={[
                  'inline-flex h-5 min-w-[2rem] items-center justify-center rounded px-1.5 text-[11px]',
                  k ? 'bg-[var(--color-bg)]' : 'bg-transparent text-[var(--color-muted)]',
                ].join(' ')}
              >
                {k ?? '—'}
              </span>
            </span>
          )
        })}
      </div>
    </Row>
  )
}

function BpmStrip({ tracks }: { tracks: MixPlanTrack[] }) {
  return (
    <Row label="BPM">
      <div className="flex flex-wrap items-center gap-1">
        {tracks.map((t, i) => {
          const b = t.track.bpm
          const prev = i > 0 ? tracks[i - 1].track.bpm : null
          const delta = prev !== null && b !== null ? b - prev : null
          return (
            <span key={t.id} className="flex items-center gap-1">
              {i > 0 && (
                <span
                  className={[
                    'text-[11px]',
                    delta === null
                      ? 'text-[var(--color-muted)]'
                      : Math.abs(delta) <= 2
                        ? 'text-emerald-400'
                        : Math.abs(delta) <= 6
                          ? 'text-amber-400'
                          : 'text-red-400',
                  ].join(' ')}
                >
                  {delta === null
                    ? '?'
                    : delta === 0
                      ? '='
                      : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}`}
                </span>
              )}
              <span className="inline-flex h-5 min-w-[2.5rem] items-center justify-center rounded bg-[var(--color-bg)] px-1.5 text-[11px]">
                {b !== null ? b.toFixed(0) : '—'}
              </span>
            </span>
          )
        })}
      </div>
    </Row>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[3rem_1fr] items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      <div>{children}</div>
    </div>
  )
}

/// Heuristic: same key, adjacent (±1 same letter), and relative major/minor are "ok".
/// Anything else flags as a warning. Wheel wraps 12 ↔ 1.
function isBadTransition(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const pa = parseCamelot(a)
  const pb = parseCamelot(b)
  if (!pa || !pb) return false
  if (pa.n === pb.n && pa.major === pb.major) return false        // same
  if (pa.n === pb.n) return false                                  // relative major/minor
  const diff = Math.min(Math.abs(pa.n - pb.n), 12 - Math.abs(pa.n - pb.n))
  if (diff === 1 && pa.major === pb.major) return false            // adjacent
  return true
}

function parseCamelot(code: string): { n: number; major: boolean } | null {
  const m = /^(\d{1,2})([AB])$/i.exec(code.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n < 1 || n > 12) return null
  return { n, major: m[2].toUpperCase() === 'B' }
}
