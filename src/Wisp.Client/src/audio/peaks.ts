/// Compute downsampled waveform peaks for a track.
/// Caches the resulting Float32Array per trackId in memory; the full PCM is GC'd
/// after extraction.
const cache = new Map<string, Float32Array>()
const inflight = new Map<string, Promise<Float32Array>>()

const TARGET_BUCKETS = 1024

export function getCachedPeaks(trackId: string): Float32Array | undefined {
  return cache.get(trackId)
}

export async function loadPeaks(trackId: string): Promise<Float32Array> {
  const cached = cache.get(trackId)
  if (cached) return cached

  const existing = inflight.get(trackId)
  if (existing) return existing

  const promise = computePeaks(trackId)
  inflight.set(trackId, promise)
  try {
    const peaks = await promise
    cache.set(trackId, peaks)
    return peaks
  } finally {
    inflight.delete(trackId)
  }
}

async function computePeaks(trackId: string): Promise<Float32Array> {
  const res = await fetch(`/api/tracks/${trackId}/audio`)
  if (!res.ok) throw new Error(`Failed to fetch audio for peaks: ${res.status}`)
  const buffer = await res.arrayBuffer()

  // OfflineAudioContext gives us a worker-friendly decoder.
  // We don't render anything — only decodeAudioData is needed.
  // Sample rate doesn't matter for peak extraction (we work on raw amplitudes).
  const offline = new OfflineAudioContext({
    numberOfChannels: 1,
    length: 1,
    sampleRate: 44100,
  })

  const audioBuffer = await offline.decodeAudioData(buffer)
  return downsample(audioBuffer)
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
