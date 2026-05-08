/// Energy-based structural cue detection over already-loaded banded peaks.
///
/// The dumb every-N-beats grid produced too many cues for typical dance music —
/// the user wants markers at the *structurally meaningful* points (Drop /
/// Breakdown / Outro), the same places Mixed in Key lights up.
///
/// Heuristic:
///   1. Smooth the low band with a 4-bar moving window so single-beat dips
///      don't read as breakdowns.
///   2. Identify "quiet zones" where the smoothed low-band stays below 35% of
///      track-max for at least 8 bars (a real breakdown, not a half-bar drop).
///   3. Each quiet zone's START = Breakdown, its END = Drop (low-band returning
///      after the breakdown is the cinematic drop moment).
///   4. The final quiet zone — if it spans the last bar of the track and starts
///      after the 75% mark — gets re-tagged as Outro instead.
///   5. Snap every cue to the nearest 16-bar boundary from the first beat, so
///      cues land on phrase lines instead of mid-bar where the energy crossed.
///   6. Filter pairs closer than 8 bars to avoid double-flagging.
///
/// No DSP, no FFT — just envelope analysis on peaks we already had to compute
/// for the waveform render. Runs in <5ms client-side for typical tracks.

import type { BandedPeaks } from './peaks'

export type StructuralCueType = 'Drop' | 'Breakdown' | 'Outro'

export interface StructuralCue {
  timeSeconds: number
  type: StructuralCueType
  label: string
}

const QUIET_RATIO = 0.35
const RECOVERY_RATIO = 0.55
const MIN_QUIET_BARS = 8
const MIN_SPACING_BARS = 8
const PHRASE_BARS = 16
const SMOOTH_BARS = 4
const BEATS_PER_BAR = 4

export function detectStructuralCues(
  peaks: BandedPeaks,
  durationSec: number,
  bpm: number,
  firstBeatSec: number,
): StructuralCue[] {
  if (durationSec <= 0 || bpm <= 0) return []
  const low = peaks.low
  const buckets = low.length
  if (buckets === 0) return []

  const secondsPerBeat = 60 / bpm
  const secondsPerBar = secondsPerBeat * BEATS_PER_BAR
  const phraseSec = secondsPerBar * PHRASE_BARS

  const tAt = (i: number) => (i / buckets) * durationSec
  const bucketsForSec = (s: number) => Math.max(1, Math.floor((s / durationSec) * buckets))

  // Smooth via simple boxcar over `smoothBuckets`. Boxcar is enough — we only
  // need to wash out per-beat spikes so the threshold check sees the envelope.
  const smoothBuckets = bucketsForSec(secondsPerBar * SMOOTH_BARS)
  const smooth = new Float32Array(buckets)
  let runningSum = 0
  for (let i = 0; i < buckets; i++) {
    runningSum += low[i]
    if (i >= smoothBuckets) runningSum -= low[i - smoothBuckets]
    smooth[i] = runningSum / Math.min(i + 1, smoothBuckets)
  }

  let maxSmooth = 0
  for (let i = 0; i < buckets; i++) if (smooth[i] > maxSmooth) maxSmooth = smooth[i]
  if (maxSmooth <= 0) return []

  const quietThreshold = maxSmooth * QUIET_RATIO
  const recoveryThreshold = maxSmooth * RECOVERY_RATIO
  const minQuietBuckets = bucketsForSec(secondsPerBar * MIN_QUIET_BARS)

  // Walk the envelope and capture quiet zones. State machine: out → in (when we
  // dip below quietThreshold) → out (when we exceed recoveryThreshold). The two
  // thresholds give hysteresis so we don't oscillate on the boundary.
  interface Zone { startIdx: number; endIdx: number }
  const zones: Zone[] = []
  let inZone = false
  let zoneStart = 0
  for (let i = 0; i < buckets; i++) {
    if (!inZone) {
      if (smooth[i] < quietThreshold) {
        inZone = true
        zoneStart = i
      }
    } else {
      if (smooth[i] >= recoveryThreshold) {
        inZone = false
        if (i - zoneStart >= minQuietBuckets) {
          zones.push({ startIdx: zoneStart, endIdx: i })
        }
      }
    }
  }
  // Track may end inside a quiet zone (fadeout/outro) — close it as a final zone
  // touching the end so the outro-detection branch below sees it.
  if (inZone && buckets - zoneStart >= minQuietBuckets) {
    zones.push({ startIdx: zoneStart, endIdx: buckets })
  }

  // Build cue candidates from zones.
  const candidates: StructuralCue[] = []
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi]
    const startT = tAt(z.startIdx)
    const endT = tAt(z.endIdx)

    // Pre-roll silence at the very top of the track is just the intro — skip
    // before the first 4 bars where the kick generally hasn't started yet.
    if (startT < secondsPerBar * 4) continue

    // Final zone that runs to the end and starts late = outro fadeout.
    const isFinal = zi === zones.length - 1
    const endsAtTrackEnd = z.endIdx >= buckets - bucketsForSec(secondsPerBar)
    const isLatePosition = startT > durationSec * 0.7
    if (isFinal && endsAtTrackEnd && isLatePosition) {
      candidates.push({ timeSeconds: startT, type: 'Outro', label: 'Outro' })
      continue
    }

    candidates.push({ timeSeconds: startT, type: 'Breakdown', label: 'Breakdown' })
    // Only flag a Drop if there's runway after the recovery — a "drop" 5
    // seconds before the track ends isn't useful as a cue.
    if (durationSec - endT >= secondsPerBar * 4) {
      candidates.push({ timeSeconds: endT, type: 'Drop', label: 'Drop' })
    }
  }

  // Snap each candidate to the nearest 16-bar phrase boundary measured from
  // the first beat. Snapping makes the cues line up with the user's perception
  // of bar lines — which is what makes them "sit right" the way MiK's do.
  for (const c of candidates) {
    const offset = c.timeSeconds - firstBeatSec
    const snappedOffset = Math.round(offset / phraseSec) * phraseSec
    const snapped = firstBeatSec + snappedOffset
    c.timeSeconds = Math.max(0, Math.min(durationSec, snapped))
  }

  candidates.sort((a, b) => a.timeSeconds - b.timeSeconds)

  // Drop cues that ended up too close together post-snap.
  const minSpacingSec = secondsPerBar * MIN_SPACING_BARS
  const filtered: StructuralCue[] = []
  for (const c of candidates) {
    const last = filtered[filtered.length - 1]
    if (!last || c.timeSeconds - last.timeSeconds >= minSpacingSec) {
      filtered.push(c)
    }
  }

  return filtered
}
