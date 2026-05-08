import type { MixPlan, MixPlanTrack } from '../../api/types'

export type WarningKind = 'bpm-jump' | 'key-clash' | 'same-artist'

export interface ChainWarning {
  kind: WarningKind
  /// `mpt.id` of the track ON THE LEFT of the transition.
  fromId: string
  /// `mpt.id` of the track ON THE RIGHT of the transition.
  toId: string
  message: string
}

export interface PlanSummary {
  trackCount: number
  estimatedDurationSeconds: number
  avgBpm: number | null
  firstEnergy: number | null
  lastEnergy: number | null
  warnings: ChainWarning[]
}

const BPM_JUMP_THRESHOLD = 8

/// Heuristic copy of the same logic the existing ChainStats `KeyPathView` uses.
/// Same key, same Camelot number (relative major/minor), or adjacent number with
/// matching letter all read as compatible. Anything else flags.
function isKeyClash(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const pa = parseCamelot(a)
  const pb = parseCamelot(b)
  if (!pa || !pb) return false
  if (pa.n === pb.n && pa.major === pb.major) return false        // same
  if (pa.n === pb.n) return false                                   // relative major/minor
  const diff = Math.min(Math.abs(pa.n - pb.n), 12 - Math.abs(pa.n - pb.n))
  if (diff === 1 && pa.major === pb.major) return false             // adjacent, same letter
  return true
}

function parseCamelot(code: string): { n: number; major: boolean } | null {
  const m = /^(\d{1,2})([AB])$/i.exec(code.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n < 1 || n > 12) return null
  return { n, major: m[2].toUpperCase() === 'B' }
}

export function computeWarnings(tracks: MixPlanTrack[]): ChainWarning[] {
  const out: ChainWarning[] = []
  for (let i = 1; i < tracks.length; i++) {
    const a = tracks[i - 1]
    const b = tracks[i]

    if (a.track.bpm !== null && b.track.bpm !== null) {
      const delta = b.track.bpm - a.track.bpm
      if (Math.abs(delta) > BPM_JUMP_THRESHOLD) {
        out.push({
          kind: 'bpm-jump',
          fromId: a.id,
          toId: b.id,
          message: `BPM jump ${delta > 0 ? '+' : ''}${delta.toFixed(0)} (${a.track.bpm.toFixed(0)} → ${b.track.bpm.toFixed(0)})`,
        })
      }
    }

    if (isKeyClash(a.track.musicalKey, b.track.musicalKey)) {
      out.push({
        kind: 'key-clash',
        fromId: a.id,
        toId: b.id,
        message: `Key clash: ${a.track.musicalKey} → ${b.track.musicalKey}`,
      })
    }

    if (
      a.track.artist &&
      b.track.artist &&
      a.track.artist.trim().toLowerCase() === b.track.artist.trim().toLowerCase()
    ) {
      out.push({
        kind: 'same-artist',
        fromId: a.id,
        toId: b.id,
        message: `Same artist back-to-back: ${a.track.artist}`,
      })
    }
  }
  return out
}

export function computePlanSummary(plan: MixPlan | undefined): PlanSummary {
  if (!plan) {
    return {
      trackCount: 0,
      estimatedDurationSeconds: 0,
      avgBpm: null,
      firstEnergy: null,
      lastEnergy: null,
      warnings: [],
    }
  }
  const tracks = plan.tracks
  const knownBpms = tracks.map((t) => t.track.bpm).filter((b): b is number => b !== null)
  const knownEnergies = tracks
    .map((t) => t.track.energy)
    .filter((e): e is number => e !== null)

  return {
    trackCount: tracks.length,
    estimatedDurationSeconds: tracks.reduce((s, t) => s + (t.track.durationSeconds || 0), 0),
    avgBpm: knownBpms.length > 0 ? knownBpms.reduce((a, b) => a + b, 0) / knownBpms.length : null,
    firstEnergy: knownEnergies.length > 0 ? knownEnergies[0] : null,
    lastEnergy: knownEnergies.length > 0 ? knownEnergies[knownEnergies.length - 1] : null,
    warnings: computeWarnings(tracks),
  }
}

/// Map of `${fromId}|${toId}` → warnings on that transition. Useful when the chain
/// renders cards as a flex list and needs to look up the gap between i and i+1.
export function indexWarningsByTransition(warnings: ChainWarning[]): Map<string, ChainWarning[]> {
  const map = new Map<string, ChainWarning[]>()
  for (const w of warnings) {
    const key = `${w.fromId}|${w.toId}`
    const existing = map.get(key)
    if (existing) existing.push(w)
    else map.set(key, [w])
  }
  return map
}

export function formatPlanDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

export function warningEmoji(kind: WarningKind): string {
  switch (kind) {
    case 'bpm-jump': return '⚠'
    case 'key-clash': return '⚠'
    case 'same-artist': return '⟳'
  }
}

export function warningShortLabel(kind: WarningKind): string {
  switch (kind) {
    case 'bpm-jump': return 'BPM'
    case 'key-clash': return 'KEY'
    case 'same-artist': return 'ARTIST'
  }
}
