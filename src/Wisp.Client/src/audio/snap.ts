/// Beat-grid snapping helpers used by cue placement + magnifier overlays.
///
/// Mouse hand-eye precision can't reliably place a cue within a few ms of a
/// kick — that's a sub-pixel target on the main waveform and still <1 mm
/// even at the magnifier's full zoom. The fix used by every DJ tool is to
/// stop trying for sub-frame mouse accuracy and instead snap to the beat
/// grid derived from BPM + first-beat anchor. The "perfect spot" by
/// definition lives on a beat in produced music, so the click only needs
/// to land in the right "neighbourhood" — snapping does the rest.

/// Returns the nearest beat time to `timeSeconds`, given a tempo and a
/// known first-beat anchor. `beatDivision` lets you snap to sub-beats
/// (e.g. 2 = half-beat / 8th note). Returns `timeSeconds` unchanged when
/// snapping isn't possible (no BPM, etc).
export function snapToBeat(
  timeSeconds: number,
  bpm: number | null | undefined,
  firstBeatSec: number | null | undefined,
  beatDivision: number = 1,
): number {
  if (!bpm || bpm <= 0 || firstBeatSec === null || firstBeatSec === undefined) {
    return timeSeconds
  }
  if (beatDivision <= 0) return timeSeconds
  const secondsPerSnap = 60 / bpm / beatDivision
  const offset = timeSeconds - firstBeatSec
  const snappedOffset = Math.round(offset / secondsPerSnap) * secondsPerSnap
  const result = firstBeatSec + snappedOffset
  return result < 0 ? 0 : result
}

/// Generate beat times within a [startSec, endSec] window so a UI can
/// render tick marks. Returns each beat with a "weight" the renderer can
/// use to vary opacity / line thickness:
///   - 1 = phrase line (every 64 beats — 16 bars in 4/4)
///   - 0.6 = bar line (every 4 beats)
///   - 0.25 = plain beat
/// The first-beat anchor sets beat 0; everything else is `firstBeatSec +
/// n × secondsPerBeat`.
export interface BeatTick {
  timeSeconds: number
  /// 0 = on the first-beat anchor itself, otherwise the beat index relative
  /// to it (positive after the anchor, negative before).
  beatIndex: number
  weight: number
}

export function beatTicksInRange(
  startSec: number,
  endSec: number,
  bpm: number | null | undefined,
  firstBeatSec: number | null | undefined,
): BeatTick[] {
  if (!bpm || bpm <= 0 || firstBeatSec === null || firstBeatSec === undefined) return []
  if (endSec <= startSec) return []

  const secondsPerBeat = 60 / bpm
  // Cap at a reasonable count — pathological inputs (huge window, low BPM)
  // shouldn't burn frames drawing thousands of ticks. The main waveform's
  // 1024-bucket render is the rough upper bound on visible detail anyway.
  const maxTicks = 512

  // Beat index range covering [startSec, endSec].
  const firstIdx = Math.ceil((startSec - firstBeatSec) / secondsPerBeat)
  const lastIdx = Math.floor((endSec - firstBeatSec) / secondsPerBeat)
  if (lastIdx < firstIdx) return []
  if (lastIdx - firstIdx > maxTicks) return []

  const ticks: BeatTick[] = []
  for (let n = firstIdx; n <= lastIdx; n++) {
    const t = firstBeatSec + n * secondsPerBeat
    let weight: number
    if (n === 0) weight = 1
    else if (n % 64 === 0) weight = 1
    else if (n % 4 === 0) weight = 0.6
    else weight = 0.25
    ticks.push({ timeSeconds: t, beatIndex: n, weight })
  }
  return ticks
}
