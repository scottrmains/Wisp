import { afterEach, describe, expect, it, vi } from 'vitest'
import { audioKey, audioResponseError, audioUrl, useAudioFiles } from './audioFiles'
import { getCachedPeaks, loadPeaks } from './peaks'

afterEach(() => { vi.unstubAllGlobals(); useAudioFiles.setState({ revisions: {} }) })

describe('file recovery audio identity', () => {
  it('refreshes just the replaced track even though its stable ID stays the same', () => {
    const other = audioKey('other')
    const old = audioUrl('track')
    useAudioFiles.getState().refresh('track')
    expect(audioKey('track')).toBe('track:1')
    expect(audioUrl('track')).not.toBe(old)
    expect(audioKey('other')).toBe(other)
  })

  it('surfaces actionable server errors and handles non-JSON errors', async () => {
    expect(await audioResponseError(new Response(JSON.stringify({ message: 'Choose a replacement.' }), { status: 410 }))).toBe('Choose a replacement.')
    expect(await audioResponseError(new Response('', { status: 404 }))).toContain('no longer')
    expect(await audioResponseError(new Response('Proxy unavailable', { status: 502 }))).toContain('502')
  })

  it('does not cache failures so a retry can request audio again', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'File missing' }), { status: 410 })))
    vi.stubGlobal('fetch', fetch)
    await expect(loadPeaks('missing-test')).rejects.toThrow('File missing')
    await expect(loadPeaks('missing-test')).rejects.toThrow('File missing')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never lets pre-relink in-flight waveform results become the new waveform', async () => {
    let finishOld!: (response: Response) => void
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve }))
      .mockResolvedValue(new Response(JSON.stringify({ message: 'New source unavailable' }), { status: 410 }))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('OfflineAudioContext', class {
      async decodeAudioData() { return { numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array([0, 1, 0, -1]) } }
    })
    const old = loadPeaks('inflight-test')
    useAudioFiles.getState().refresh('inflight-test')
    await expect(loadPeaks('inflight-test')).rejects.toThrow('New source unavailable')
    finishOld(new Response(new Uint8Array([1, 2])))
    await old
    expect(getCachedPeaks('inflight-test')).toBeUndefined()
    expect(fetch.mock.calls.map((args) => args[0])).toEqual(['/api/tracks/inflight-test/audio?v=0', '/api/tracks/inflight-test/audio?v=1'])
  })
})
