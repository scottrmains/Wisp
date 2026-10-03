import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, localCommandHeaders } from './client'
import { mixPlans } from './mixPlans'
import { playlists } from './playlists'
import { loudness } from './loudness'
import { accounts } from './accounts'

describe('local requests remain guest-safe', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5125' } })
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it.each([
    ['POST', () => apiPost('/api/test', { title: 'Guest' })],
    ['PATCH', () => apiPatch('/api/test', { title: 'Guest' })],
    ['PUT', () => apiPut('/api/test', { title: 'Guest' })],
    ['DELETE', () => apiDelete('/api/test')],
    ['DELETE', () => mixPlans.delete('plan')],
    ['PATCH', () => mixPlans.update('plan', { name: 'Guest' })],
    ['PATCH', () => playlists.update('playlist', { name: 'Guest' })],
    ['POST', () => loudness.scan('track', -14, new AbortController().signal)],
  ] as const)(
    'includes the local command marker on %s without a login token',
    async (method, command) => {
      await command()
      const options = fetchMock.mock.calls[0][1] as RequestInit
      const headers = new Headers(options.headers)
      expect(options.method).toBe(method)
      expect(headers.get('X-Wisp-Client')).toBe(localCommandHeaders['X-Wisp-Client'])
      expect(headers.has('Authorization')).toBe(false)
    },
  )

  it('reads local status only, preserving cancellation and avoiding credential headers', async () => {
    const signal = new AbortController().signal
    await accounts.status(signal)
    expect(fetchMock).toHaveBeenCalledWith('/api/account/status', { signal })
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await apiGet('/api/tracks')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/tracks', { signal: undefined })
  })
})
