/// Compute downsampled waveform peaks for a track.
/// Caches per trackId; the full PCM is GC'd after extraction.
const singleCache = new Map<string, Float32Array>()
const singleInflight = new Map<string, Promise<Float32Array>>()
const bandedCache = new Map<string, BandedPeaks>()
const bandedInflight = new Map<string, Promise<BandedPeaks>>()

/// 4096 buckets gives ~11 buckets/sec on a 6-minute track — enough that each
/// kick / snare gets its own visible peak rather than being averaged into a
/// neighbour. (Mixed in Key looks "sharp" because they store much more than
/// this, but 4096 is the sweet spot for our render path before cache size
/// becomes silly: ~64 KB per band, 256 KB total per cached track.)
const TARGET_BUCKETS = 4096

export interface BandedPeaks {
  /// Unfiltered amplitude envelope — drives the clean single-colour
  /// rendering (matches the Mixed-in-Key flat-cyan waveform style).
  full: Float32Array
  /// Sub-bass + bass (~< 250 Hz) — drives the structural-cue detector
  /// (kick onsets in the low band reveal breakdowns / drops).
  low: Float32Array
  /// Midrange (~250 Hz – 2 kHz) — vocals + lead synths + body of the kit.
  /// Kept available for future analysis (vocal-in detection, etc.).
  mid: Float32Array
  /// Highs (~2 kHz +) — hats, cymbals, presence. Same: analysis-only now.
  high: Float32Array
}

export function getCachedPeaks(trackId: string): Float32Array | undefined {
  return singleCache.get(trackId)
}

export function getCachedBandedPeaks(trackId: string): BandedPeaks | undefined {
  return bandedCache.get(trackId)
}

export async function loadPeaks(trackId: string): Promise<Float32Array> {
  const cached = singleCache.get(trackId)
  if (cached) return cached

  const existing = singleInflight.get(trackId)
  if (existing) return existing

  const promise = computePeaks(trackId)
  singleInflight.set(trackId, promise)
  try {
    const peaks = await promise
    singleCache.set(trackId, peaks)
    return peaks
  } finally {
    singleInflight.delete(trackId)
  }
}

/// Decode once, render the same buffer through three BiquadFilterNodes
/// (lowpass → bandpass → highpass) so we get per-band amplitude envelopes.
/// Drives the Mixed-in-Key style mini-player waveform.
export async function loadBandedPeaks(trackId: string): Promise<BandedPeaks> {
  const cached = bandedCache.get(trackId)
  if (cached) return cached

  const existing = bandedInflight.get(trackId)
  if (existing) return existing

  const promise = computeBandedPeaks(trackId)
  bandedInflight.set(trackId, promise)
  try {
    const peaks = await promise
    bandedCache.set(trackId, peaks)
    return peaks
  } finally {
    bandedInflight.delete(trackId)
  }
}

async function computePeaks(trackId: string): Promise<Float32Array> {
  const res = await fetch(`/api/tracks/${trackId}/audio`)
  if (!res.ok) throw new Error(`Failed to fetch audio for peaks: ${res.status}`)
  const buffer = await res.arrayBuffer()

  const probe = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44100 })
  const audioBuffer = await probe.decodeAudioData(buffer)
  return downsample(audioBuffer)
}

async function computeBandedPeaks(trackId: string): Promise<BandedPeaks> {
  const res = await fetch(`/api/tracks/${trackId}/audio`)
  if (!res.ok) throw new Error(`Failed to fetch audio for peaks: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()

  // Decode once. We pass a slice() to insulate against decodeAudioData detaching the buffer
  // on some implementations.
  const probe = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44100 })
  const audioBuffer = await probe.decodeAudioData(arrayBuffer.slice(0))

  // Unfiltered RMS envelope — that's what we render. RMS (not peak) is the
  // key reason MiK's waveform reads with structure: peak-per-bucket pegs to
  // near-max wherever any kick lands, washing out the dynamics. RMS averages
  // the squared samples across the bucket window so quiet stretches (sparse
  // beats, breakdowns) are visibly shorter than loud ones (full mix on the
  // drop). Cheap — no filter pass.
  const full = downsampleRMS(audioBuffer)
  // Three filtered peak renders feed the structural-cue detector. Peak is
  // the right metric there because we want to find transient *onsets*, not
  // smoothed energy. Run sequentially — parallel triples the memory
  // footprint with no real gain on the user's typical machine.
  const low = downsample(await renderBand(audioBuffer, 'lowpass', 250))
  const mid = downsample(await renderBand(audioBuffer, 'bandpass', 800))
  const high = downsample(await renderBand(audioBuffer, 'highpass', 2000))

  return { full, low, mid, high }
}

async function renderBand(
  source: AudioBuffer,
  type: BiquadFilterType,
  frequency: number,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 1,
    length: source.length,
    sampleRate: source.sampleRate,
  })
  const node = ctx.createBufferSource()
  node.buffer = source
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  // Bandpass needs a tighter Q to actually isolate the midrange; default 1 is OK
  // but 0.7 gives a smoother response without ringing.
  if (type === 'bandpass') filter.Q.value = 0.7
  node.connect(filter).connect(ctx.destination)
  node.start()
  return ctx.startRendering()
}

/// Heuristic "first beat" detection from already-loaded banded peaks. Walks the
/// low band (where kicks dominate) and returns the timestamp of the first peak
/// that exceeds 50% of the loudest low-band sample in the track — i.e. the
/// first proper kick. Pre-roll silence + ambient pads sit well below that
/// threshold for typical produced dance music, so this lands close to the kick
/// on bar 1 without needing real DSP. Returns null when there's nothing audible.
export function detectFirstBeatFromPeaks(peaks: BandedPeaks, durationSeconds: number): number | null {
  if (durationSeconds <= 0) return null
  const low = peaks.low
  if (low.length === 0) return null

  let maxLow = 0
  for (let i = 0; i < low.length; i++) {
    if (low[i] > maxLow) maxLow = low[i]
  }
  if (maxLow <= 0) return null
  const threshold = maxLow * 0.5

  for (let i = 0; i < low.length; i++) {
    if (low[i] >= threshold) {
      // i is a bucket index in [0, low.length). Map to time at the START of
      // that bucket so we land just before the kick rather than mid-attack.
      return (i / low.length) * durationSeconds
    }
  }
  return null
}

/// Phase-fitted downbeat detection. Improves on detectFirstBeatFromPeaks for
/// the snap-to-beat case where mis-locating beat 1 by even half a beat
/// throws every snapped cue off-grid.
///
/// Algorithm:
///   1. Naive "first kick" gives a starting candidate (the first low-band
///      sample > 50 % of max).
///   2. The naive answer often lands on off-grid intro percussion — a
///      conga, a synth stab, a hi-hat bleeding into the low band. So we
///      search a ±1-beat window around it: for each candidate phase, count
///      how many of the next 32 predicted beat positions have a real kick
///      within ±60 ms tolerance.
///   3. The phase with the highest hit count = the BPM grid's correct
///      alignment. Pick the first kick that lives on that grid as the
///      returned downbeat (so the marker visually sits on a real kick,
///      not in dead space between hits).
///
/// Falls back to the naive answer when BPM is missing / the grid never
/// locks (acoustic / non-4-on-the-floor music). Pure-JS, no DSP.
export function detectDownbeatFromPeaks(
  peaks: BandedPeaks,
  durationSeconds: number,
  bpm: number | null | undefined,
): number | null {
  if (durationSeconds <= 0) return null
  if (!bpm || bpm <= 0) return detectFirstBeatFromPeaks(peaks, durationSeconds)

  const low = peaks.low
  const buckets = low.length
  if (buckets === 0) return null

  const secondsPerBeat = 60 / bpm
  const samplesPerSecond = buckets / durationSeconds

  // Search the first 60s of the track — long enough to lock the grid on any
  // intro shorter than a 32-bar phrase even at 80 BPM, and bounded so we're
  // not iterating a 10-minute track twice.
  const searchEndIdx = Math.min(buckets, Math.floor(60 * samplesPerSecond))

  let maxLow = 0
  for (let i = 0; i < searchEndIdx; i++) if (low[i] > maxLow) maxLow = low[i]
  if (maxLow <= 0) return null
  const threshold = maxLow * 0.5

  // Naive starting candidate.
  let naiveIdx = -1
  for (let i = 0; i < searchEndIdx; i++) {
    if (low[i] >= threshold) { naiveIdx = i; break }
  }
  if (naiveIdx < 0) return null
  const naiveTime = naiveIdx / samplesPerSecond

  const tolerance = 0.06 // ±60 ms — tight enough to reject mis-aligned hits,
                         // loose enough to catch BPMs that drift a bit.
  const phaseSteps = 21  // search ±0.5 beat in 21 steps (~ms-level resolution)
  const beatsToCheck = 32

  // Start at 0 so candidates that score nothing don't displace `naiveTime`.
  // Without this, the *first* candidate processed (often a negative shift)
  // wins by default at score 0 even when no kicks aligned with it — we'd
  // return a phase that has no kicks at all on its grid.
  let bestAnchor = naiveTime
  let bestScore = 0

  for (let s = 0; s < phaseSteps; s++) {
    const shiftBeats = (s / (phaseSteps - 1)) - 0.5
    const candidate = naiveTime + shiftBeats * secondsPerBeat
    if (candidate < 0) continue

    let score = 0
    for (let n = 0; n < beatsToCheck; n++) {
      const expected = candidate + n * secondsPerBeat
      if (expected >= durationSeconds) break

      const startIdx = Math.max(0, Math.floor((expected - tolerance) * samplesPerSecond))
      const endIdx = Math.min(buckets - 1, Math.ceil((expected + tolerance) * samplesPerSecond))
      let foundPeak = 0
      for (let i = startIdx; i <= endIdx; i++) {
        if (low[i] > foundPeak) foundPeak = low[i]
      }
      // Score weighted by hit strength so a strong kick on-grid scores more
      // than a weak hi-hat on-grid.
      if (foundPeak >= threshold) score += foundPeak / maxLow
    }

    if (score > bestScore) {
      bestScore = score
      bestAnchor = candidate
    }
  }

  // Snap the returned anchor to the actual peak position of the first kick
  // on the locked grid — visually feels right (the FirstBeat marker sits on
  // a real kick, not in silence) and gives downstream snap calls the most
  // accurate possible reference time.
  for (let n = 0; n < beatsToCheck; n++) {
    const expected = bestAnchor + n * secondsPerBeat
    if (expected >= durationSeconds) break
    const startIdx = Math.max(0, Math.floor((expected - tolerance) * samplesPerSecond))
    const endIdx = Math.min(buckets - 1, Math.ceil((expected + tolerance) * samplesPerSecond))
    let bestKickIdx = -1
    let bestKickAmp = 0
    for (let i = startIdx; i <= endIdx; i++) {
      if (low[i] > bestKickAmp) { bestKickAmp = low[i]; bestKickIdx = i }
    }
    if (bestKickIdx >= 0 && bestKickAmp >= threshold) {
      return bestKickIdx / samplesPerSecond
    }
  }

  return bestAnchor
}

/// Downsample to per-bucket RMS amplitude. Used for the visual waveform —
/// produces an "envelope" that follows song dynamics rather than every
/// bucket pegging near max because it caught a single kick.
function downsampleRMS(audioBuffer: AudioBuffer): Float32Array {
  const channels = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  const step = Math.max(1, Math.floor(length / TARGET_BUCKETS))
  const peaks = new Float32Array(TARGET_BUCKETS)

  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c))

  for (let i = 0; i < TARGET_BUCKETS; i++) {
    const start = i * step
    const end = Math.min(start + step, length)
    let sumSquares = 0
    let count = 0
    for (let c = 0; c < channels; c++) {
      const data = channelData[c]
      for (let j = start; j < end; j++) {
        const v = data[j]
        sumSquares += v * v
        count++
      }
    }
    peaks[i] = count > 0 ? Math.sqrt(sumSquares / count) : 0
  }

  return peaks
}

/// Downsample to per-bucket peak amplitude. Used for analysis bands where
/// transient onsets matter (low-band peak = kick onset = where structural
/// boundaries land).
function downsample(audioBuffer: AudioBuffer): Float32Array {
  const channels = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  const step = Math.max(1, Math.floor(length / TARGET_BUCKETS))
  const peaks = new Float32Array(TARGET_BUCKETS)

  // Collect channels first to avoid getChannelData() per inner-loop iter.
  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c))

  for (let i = 0; i < TARGET_BUCKETS; i++) {
    const start = i * step
    const end = Math.min(start + step, length)
    let max = 0
    for (let c = 0; c < channels; c++) {
      const data = channelData[c]
      for (let j = start; j < end; j++) {
        const v = Math.abs(data[j])
        if (v > max) max = v
      }
    }
    peaks[i] = max
  }

  return peaks
}
