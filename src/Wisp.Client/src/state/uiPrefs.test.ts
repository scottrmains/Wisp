import { beforeEach, afterEach, expect, test, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('window', { localStorage })
})
afterEach(() => vi.unstubAllGlobals())

test('existing preparation and filter preferences survive additive sidebar hydration', async () => {
  localStorage.setItem(
    'wisp.uiPrefs',
    JSON.stringify({
      version: 0,
      state: {
        libraryPrepHeight: 417,
        prepWaveformVisible: false,
        librarySort: 'bpm',
        sidebarCollapsed: true,
        inspectorWidth: 510,
        slskdFormat: 'aiff',
        discoverYouTubeEnabled: false,
      },
    }),
  )
  const { useUiPrefs } = await import('./uiPrefs')
  expect(useUiPrefs.getState()).toMatchObject({
    libraryPrepHeight: 417,
    prepWaveformVisible: false,
    librarySort: 'bpm',
    sidebarCollapsed: true,
    inspectorWidth: 510,
    slskdFormat: 'aiff',
    discoverYouTubeEnabled: false,
    sidebarCompactExpanded: false,
  })
  useUiPrefs.getState().setSidebarCompactExpanded(true)
  expect(JSON.parse(localStorage.getItem('wisp.uiPrefs')!).state).toMatchObject({
    sidebarCompactExpanded: true,
    libraryPrepHeight: 417,
  })
})

test('malformed sidebar flags use safe defaults without clearing unrelated preferences', async () => {
  localStorage.setItem(
    'wisp.uiPrefs',
    JSON.stringify({
      version: 0,
      state: {
        sidebarCollapsed: 'false',
        sidebarCompactExpanded: 42,
        libraryPrepHeight: 290,
      },
    }),
  )
  const { useUiPrefs } = await import('./uiPrefs')
  expect(useUiPrefs.getState()).toMatchObject({
    sidebarCollapsed: false,
    sidebarCompactExpanded: false,
    libraryPrepHeight: 290,
  })
})
