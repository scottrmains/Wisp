import { useCallback, useEffect, useRef, useState } from 'react'
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import { ensureAudio } from './context'

export type TempoMode = 'masterTempo' | 'pitch'

export interface AudioDeck {
  isPlaying: boolean
  duration: number
  currentTime: number
  volume: number
  error: string | null
  loading: boolean
  gainNode: GainNode | null

  /// 1.0 = native tempo. Range typically 0.9–1.1 (±10%).
  tempo: number
  setTempo: (t: number) => void
  resetTempo: () => void
  /// In 'masterTempo' mode tempo changes preserve pitch. In 'pitch' mode they
  /// shift together (vinyl-style).
  tempoMode: TempoMode
  setTempoMode: (mode: TempoMode) => void

  play: () => Promise<void>
  pause: () => void
  toggle: () => Promise<void>
  seek: (time: number) => void
  setVolume: (v: number) => void
}

/// Streams an audio file via an HTMLAudioElement → MediaElementSource → SoundTouchNode → GainNode → destination.
/// SoundTouchNode is an AudioWorklet that does pitch-preserving time stretch.
/// Using HTMLAudioElement (not AudioBufferSource) means we stream over Range
/// requests instead of buffering the whole file before playback.
export function useAudioDeck(trackId: string | null): AudioDeck {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  if (audioRef.current === null) {
    const el = new Audio()
    el.preload = 'metadata'
    el.crossOrigin = 'anonymous'
    audioRef.current = el
  }
  const audio = audioRef.current

  const [gainNode, setGainNode] = useState<GainNode | null>(null)
  const stretchRef = useRef<SoundTouchNode | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [volume, setVolumeState] = useState(1)
  const [tempo, setTempoState] = useState(1)
  const [tempoMode, setTempoModeState] = useState<TempoMode>('masterTempo')

  // Wire the audio element into the AudioContext graph once.
  // MediaElementSource can only be created once per audio element.
  const wiredRef = useRef(false)
  useEffect(() => {
    if (wiredRef.current) return
    let cancelled = false
    void ensureAudio().then((ctx) => {
      if (cancelled || wiredRef.current) return
      const source = ctx.createMediaElementSource(audio)
      const gain = ctx.createGain()

      // Insert SoundTouchNode between source and gain. If the worklet failed to
      // register (rare), fall back to a direct connection so audio still plays.
      let stretch: SoundTouchNode | null = null
      try {
        stretch = new SoundTouchNode(ctx)
        source.connect(stretch).connect(gain)
        stretchRef.current = stretch
      } catch (err) {
        console.warn('SoundTouchNode unavailable, using passthrough', err)
        source.connect(gain)
      }

      gain.connect(ctx.destination)
      setGainNode(gain)
      wiredRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [audio])

  // Apply tempo/pitch params whenever they change.
  useEffect(() => {
    const node = stretchRef.current
    if (!node) return
    if (tempoMode === 'masterTempo') {
      node.tempo.value = tempo
      node.pitch.value = 1
      node.rate.value = 1
    } else {
      // Vinyl mode — couple tempo + pitch via the `rate` param.
      node.rate.value = tempo
      node.tempo.value = 1
      node.pitch.value = 1
    }
  }, [tempo, tempoMode])

  // Swap source whenever trackId changes.
  useEffect(() => {
    setError(null)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)

    if (!trackId) {
      audio.removeAttribute('src')
      audio.load()
      return
    }

    setLoading(true)
    audio.src = `/api/tracks/${trackId}/audio`
    audio.load()
  }, [audio, trackId])

  // Audio element events.
  useEffect(() => {
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTime = () => setCurrentTime(audio.currentTime)
    const onMeta = () => {
      setDuration(audio.duration)
      setLoading(false)
    }
    const onCanPlay = () => setLoading(false)
    const onWaiting = () => setLoading(true)
    const onError = () => {
      setError(audio.error?.message ?? 'Audio failed to load')
      setLoading(false)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('error', onError)
    }
  }, [audio])

  // Stop & detach on unmount.
  useEffect(() => {
    return () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [audio])

  const play = useCallback(async () => {
    try {
      await ensureAudio()
      await audio.play()
    } catch (e) {
      setError((e as Error).message)
    }
  }, [audio])

  const pause = useCallback(() => audio.pause(), [audio])
  const toggle = useCallback(async () => (audio.paused ? play() : pause()), [audio, play, pause])
  const seek = useCallback(
    (t: number) => {
      audio.currentTime = Math.max(0, Math.min(t, audio.duration || t))
    },
    [audio],
  )
  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v))
      audio.volume = clamped
      setVolumeState(clamped)
    },
    [audio],
  )

  const setTempo = useCallback((t: number) => {
    // Clamp to ±10%; beyond that the artifacts are too obvious.
    setTempoState(Math.max(0.9, Math.min(1.1, t)))
  }, [])

  const resetTempo = useCallback(() => setTempoState(1), [])

  return {
    isPlaying,
    duration,
    currentTime,
    volume,
    error,
    loading,
    gainNode,
    tempo,
    setTempo,
    resetTempo,
    tempoMode,
    setTempoMode: setTempoModeState,
    play,
    pause,
    toggle,
    seek,
    setVolume,
  }
}
