/// Compute downsampled waveform peaks for a track.
/// Caches per trackId; the full PCM is GC'd after extraction.
const singleCache = new Map<string, Float32Array>()
const singleInflight = new Map<string, Promise<Float32Array>>()
const bandedCache = new Map<string, BandedPeaks>()
const bandedInflight = new Map<string, Promise<BandedPeaks>>()

const TARGET_BUCKETS = 1024

export interface BandedPeaks {
  /// Sub-bass + bass (~< 250 Hz) — drives the warm/red end of the waveform.
  low: Float32Array
  /// Midrange (~250 Hz – 2 kHz) — vocals + lead synths + body of the kit.
  mid: Float32Array
  /// Highs (~2 kHz +) — hats, cymbals, presence.
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

  // Three filtered renders against the same decoded buffer. Run sequentially —
  // running them in parallel triples the memory footprint with no real gain on
  // the user's typical machine.
  const low = downsample(await renderBand(audioBuffer, 'lowpass', 250))
  const mid = downsample(await renderBand(audioBuffer, 'bandpass', 800))
  const high = downsample(await renderBand(audioBuffer, 'highpass', 2000))

  return { low, mid, high }
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
