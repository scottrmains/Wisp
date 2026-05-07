import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureAudio } from './context'

export interface AudioDeck {
  isPlaying: boolean
  duration: number
  currentTime: number
  volume: number
  error: string | null
  loading: boolean
  gainNode: GainNode | null
  play: () => Promise<void>
  pause: () => void
  toggle: () => Promise<void>
  seek: (time: number) => void
  setVolume: (v: number) => void
}

/// Streams an audio file via an HTMLAudioElement → MediaElementSource → GainNode → destination.
/// Using HTMLAudioElement (not AudioBufferSource) means we stream over Range requests
/// instead of buffering the whole file before playback.
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
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [volume, setVolumeState] = useState(1)

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
      source.connect(gain)
      gain.connect(ctx.destination)
      setGainNode(gain)
      wiredRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [audio])

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

  return {
    isPlaying,
    duration,
    currentTime,
    volume,
    error,
    loading,
    gainNode,
    play,
    pause,
    toggle,
    seek,
    setVolume,
  }
}
