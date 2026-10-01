import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const searchId = '11111111-1111-4111-8111-111111111111'
const hits = ['Big Buds.mp3', 'Olive remix.aif', 'Restricted.mp3'].map((filename, i) => ({
  username: `user-${i}`, filename: `Music\\${filename}`, size: 12_000_000, bitRate: i === 1 ? null : 320,
  sampleRate: 44100, bitDepth: i === 1 ? 24 : null, length: 360, locked: i === 2,
  uploadSpeed: 204800, queueLength: 0, hasFreeUploadSlot: true,
}))

async function setup(page: Page, configured = true, external = false) {
  let downloads = [
    { id: 'active', username: 'peer', filename: 'Music\\Queued.mp3', size: 100, percentage: 30, state: 'InProgress', importStatus: null },
    { id: 'done', username: 'peer', filename: 'Music\\Finished.mp3', size: 100, percentage: 100, state: 'Completed, Succeeded', importStatus: 'Completed' },
    { id: 'failed', username: 'peer', filename: 'Music\\Failed.mp3', size: 100, percentage: 0, state: 'Completed, Errored', importStatus: null },
    { id: 'import', username: 'peer', filename: 'Music\\Needs import.mp3', size: 100, percentage: 100, state: 'Completed, Succeeded', importStatus: 'Failed' },
  ]
  const requests: { path: string; method: string; body: unknown }[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let failDownload = false, online = true
  let downloadDelay = 0
  let sharing = { enabled: false, folders: [] as string[], uploadSlots: 2, uploadSpeedLimit: 1024 }
  let saved = false
  await page.addInitScript(() => {
    localStorage.setItem('wisp.currentPage', JSON.stringify({ state: { page: 'soulseek' }, version: 1 }))
    localStorage.setItem('wisp.uiPrefs', JSON.stringify({ state: { slskdFormat: 'any', slskdHideLocked: false, slskdFreeSlotsOnly: false }, version: 0 }))
    let receive: ((raw: string) => void) | null = null
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (fn: typeof receive) => { receive = fn },
      sendMessage: (raw: string) => {
        const req = JSON.parse(raw)
        receive?.(JSON.stringify({ id: req.id, result: { path: 'D:\\Music\\Shared', ok: true } }))
      },
    } })
  })
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method()
    if (method !== 'GET') requests.push({ path, method, body: req.postDataJSON() })
    if (path === '/api/settings/soulseek') return route.fulfill({ json: { isConfigured: configured, hasUsername: configured, hasPassword: configured, manageSlskd: !external } })
    if (path === '/api/soulseek/connection') return route.fulfill({ json: { isConfigured: configured, daemonAvailable: configured, isConnected: online && configured, isLoggedIn: online && configured, isTransitioning: false, username: configured ? 'wisp-dj' : null, message: configured ? 'Check your Soulseek login.' : 'Set up Soulseek in Settings.' } })
    if (path === '/api/soulseek/reconnect') { online = true; return route.fulfill({ status: 204 }) }
    if (path === '/api/settings/soulseek/download-folder') return route.fulfill({ json: { effectiveDownloadFolder: 'D:\\Music', restartRequired: false, nextDownloadFolder: 'D:\\Music' } })
    if (path === '/api/soulseek/searches') return route.fulfill({ json: { id: searchId } })
    if (path === `/api/soulseek/searches/${searchId}` && method === 'GET') return route.fulfill({ json: { id: searchId, isComplete: false, responseCount: 3, hits } })
    if (path.startsWith('/api/soulseek/searches/')) return route.fulfill({ status: 204 })
    if (path === '/api/soulseek/downloads' && method === 'GET') return route.fulfill({ json: downloads })
    if (path === '/api/soulseek/downloads' && method === 'POST') {
      if (downloadDelay) await new Promise(resolve => setTimeout(resolve, downloadDelay))
      if (failDownload && req.postDataJSON().username === 'user-0') return route.fulfill({ status: 400, json: { message: 'Peer is offline. Try another result.' } })
      return route.fulfill({ json: { ok: true } })
    }
    if (path === '/api/soulseek/downloads/clear') {
      const selected = req.postDataJSON(), before = downloads
      downloads = downloads.filter(t => (!selected.id || t.id === selected.id) ? !t.state.includes('Completed') || t.importStatus === 'Failed' : true)
      return route.fulfill({ json: { clearedIds: before.filter(t => !downloads.includes(t)).map(t => t.id), skipped: 1, errors: [] } })
    }
    if (path === '/api/soulseek/downloads/cancel') {
      downloads = downloads.map(t => t.id === req.postDataJSON().id ? { ...t, state: 'Completed, Cancelled' } : t)
      return route.fulfill({ status: 204 })
    }
    if (path === '/api/soulseek/downloads/retry') {
      downloads = downloads.map(t => t.id === req.postDataJSON().id ? { ...t, state: 'Queued, Remotely' } : t)
      return route.fulfill({ status: 204 })
    }
    if (path === '/api/soulseek/downloads/import') {
      downloads = downloads.map(t => t.id === req.postDataJSON().id ? { ...t, importStatus: 'Pending' } : t)
      return route.fulfill({ status: 204 })
    }
    if (path === '/api/soulseek/sharing') {
      if (method === 'PUT') { sharing = req.postDataJSON(); saved = true; return route.fulfill({ json: { message: 'Saved. Restart WISP.' } }) }
      return route.fulfill({ json: { settings: sharing, canConfigure: !external, restartRequired: saved } })
    }
    if (path === '/api/soulseek/shares') return route.fulfill({ json: [{ id: 'share', alias: 'Music 1', localPath: 'D:\\Music\\Shared', isExcluded: false, files: 7 }] })
    if (path === '/api/soulseek/shares/status') return route.fulfill({ json: { scanning: false, scanPending: false, ready: true, faulted: false, files: 7 } })
    if (path === '/api/soulseek/shares/rescan' || path === '/api/soulseek/uploads/cancel') return route.fulfill({ status: 204 })
    if (path === '/api/soulseek/uploads') return route.fulfill({ json: [{ id: 'upload', username: 'listener', filename: 'Shared\\Uploaded.mp3', state: 'InProgress', percentage: 50, averageSpeed: 2048 }] })
    if (path === '/api/tracks') return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } })
    if (path === '/api/recordings/status') return route.fulfill({ json: { busy: false, session: null } })
    if (path === '/api/recording-input/test') return route.fulfill({ json: null })
    return route.fulfill({ json: [] })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Soulseek', exact: true })).toBeVisible()
  return { requests, errors, failDownload: () => { failDownload = true }, offline: () => { online = false }, delayDownloads: () => { downloadDelay = 700 } }
}

async function search(page: Page) {
  await page.getByRole('textbox', { name: 'Soulseek search query' }).fill('Brent Laurence Big Buds')
  await page.getByRole('button', { name: 'Search Soulseek', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Select Big Buds.mp3 from user-0', exact: true })).toBeVisible()
}

test('workspace preserves search across navigation, supports AIFF and really cancels server searches', async ({ page }) => {
  const state = await setup(page)
  await search(page)
  await expect(page.getByRole('checkbox', { name: 'Select Restricted.mp3 from user-2' })).toBeDisabled()
  await page.getByRole('button', { name: 'AIFF', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Select Olive remix.aif from user-1' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Select Big Buds.mp3 from user-0' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Soulseek', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Soulseek search query' })).toHaveValue('Brent Laurence Big Buds')
  await expect(page.getByRole('checkbox', { name: 'Select Olive remix.aif from user-1' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Search Soulseek', exact: true })).toBeEnabled()
  expect(state.requests.some(r => r.path.endsWith('/stop'))).toBe(true)
  expect(state.requests.some(r => r.method === 'DELETE' && r.path.endsWith(searchId))).toBe(true)
  expect(state.errors).toEqual([])
})

test('multi-select queues only unlocked files and reports partial failures', async ({ page }) => {
  const state = await setup(page); state.failDownload()
  await search(page)
  await page.getByRole('checkbox', { name: 'Select all downloadable results' }).check()
  await page.getByRole('button', { name: 'Download selected', exact: true }).click()
  await expect(page.getByText(/1 file queued.*Peer is offline/)).toBeVisible()
  const queued = state.requests.filter(r => r.path === '/api/soulseek/downloads' && r.method === 'POST')
  expect(queued).toHaveLength(2)
  expect(queued.some(r => (r.body as { username: string }).username === 'user-2')).toBe(false)
  expect(state.errors).toEqual([])
})

test('single download errors are visible beside the file', async ({ page }) => {
  const state = await setup(page); state.failDownload()
  await search(page)
  await page.getByRole('button', { name: 'Download Big Buds.mp3 from user-0', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Peer is offline' })).toBeVisible()
})

test('batch queueing can stop after the current request without queuing the rest', async ({ page }) => {
  const state = await setup(page); state.delayDownloads()
  await search(page)
  await page.getByRole('checkbox', { name: 'Select all downloadable results' }).check()
  await page.getByRole('button', { name: 'Download selected', exact: true }).click()
  await page.getByRole('button', { name: 'Stop queueing', exact: true }).click()
  await expect(page.getByText(/Stopped queueing. Already queued downloads continue/)).toBeVisible()
  expect(state.requests.filter(r => r.path === '/api/soulseek/downloads' && r.method === 'POST')).toHaveLength(1)
})

test('a download error remains reachable in the dropdown after leaving the search page', async ({ page }) => {
  const state = await setup(page); state.failDownload(); state.delayDownloads()
  await search(page)
  await page.getByRole('button', { name: 'Download Big Buds.mp3 from user-0', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Soulseek transfers', exact: true }).click()
  await expect(page.getByText('Peer is offline. Try another result.', { exact: true })).toBeVisible()
})

test('dropdown stays available and opens downloads with cancel, retry and safe clear', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Soulseek transfers', exact: true }).click()
  await page.getByRole('button', { name: /Open Soulseek workspace/ }).click()
  await expect(page.getByText('Downloading to', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel Queued.mp3 from peer' }).click()
  await expect(page.getByRole('button', { name: 'Clear Queued.mp3 from peer' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry Failed.mp3', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel Failed.mp3 from peer' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry import Needs import.mp3' }).click()
  await expect(page.getByText('Importing into library…')).toBeVisible()
  await page.getByRole('button', { name: /Clear all finished/ }).click()
  await expect(page.getByText(/Downloaded files kept/)).toBeVisible()
  expect(state.requests.some(r => /delete.*file|file.*delete/.test(r.path))).toBe(false)
  expect(state.errors).toEqual([])
})

test('sharing is opt-in and explicit, with restart feedback and upload controls', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Sharing', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Enable sharing of selected folders' })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Enable sharing of selected folders' }).check()
  await expect(page.getByRole('button', { name: 'Save sharing settings' })).toBeDisabled()
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save sharing settings' })).toBeEnabled()
  await page.getByRole('button', { name: 'Save sharing settings' }).click()
  await expect(page.getByText('Sharing settings saved. Restart WISP to apply them.')).toBeVisible()
  expect(state.requests.filter(r => r.path === '/api/soulseek/sharing' && r.method === 'PUT')).toHaveLength(1)
  await page.getByRole('button', { name: 'Rescan shares' }).click()
  await page.getByRole('button', { name: 'Cancel upload to listener' }).click()
  expect(state.errors).toEqual([])
})

test('external slskd sharing settings are read-only', async ({ page }) => {
  await setup(page, true, true)
  await page.getByRole('button', { name: 'Sharing', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Enable sharing of selected folders' })).toBeDisabled()
  await expect(page.getByText(/Your external slskd manages sharing/)).toBeVisible()
  await expect(page.getByText('Uploaded.mp3', { exact: true })).toBeVisible()
})

test('unconfigured profiles hide the sidebar entry and show setup instructions', async ({ page }) => {
  await setup(page, false)
  await expect(page.getByRole('button', { name: 'Soulseek', exact: true })).toHaveCount(0)
  await expect(page.getByText('Set up Soulseek in Settings.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search Soulseek', exact: true })).toBeDisabled()
})

test('compact layout keeps navigation, search and transfer actions reachable', async ({ page }) => {
  const state = await setup(page)
  await page.setViewportSize({ width: 920, height: 680 })
  await search(page)
  await page.screenshot({ path: '../../artifacts/soulseek-search.png', fullPage: true })
  await page.getByRole('button', { name: /Downloads/, exact: false }).filter({ hasText: 'Downloads' }).last().click()
  await expect(page.getByRole('button', { name: 'Cancel Queued.mp3 from peer' })).toBeVisible()
  await page.screenshot({ path: '../../artifacts/soulseek-downloads.png', fullPage: true })
  expect(state.errors).toEqual([])
})

test('UI4 search results show sortable columns, full Download actions and an accessible scroll region', async ({
  page,
}) => {
  const state = await setup(page)
  await search(page)
  await mkdir('../../artifacts/ui-phase-four', { recursive: true })
  const results = page.getByRole('region', { name: 'Soulseek search results' })
  await results.getByRole('button', { name: 'File', exact: true }).click()
  await expect(results.getByRole('columnheader', { name: /File/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  )
  await expect(
    results.getByRole('button', { name: 'Download Big Buds.mp3 from user-0' }),
  ).toHaveText('Download')
  for (const size of [
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size)
    await results.focus()
    await expect(results).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      size.width,
    )
    await page.screenshot({ path: `../../artifacts/ui-phase-four/soulseek-${size.width}.png` })
  }
  await page.getByRole('button', { name: 'Stop search', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Soulseek sections' })
    .getByRole('button', { name: /Downloads/ })
    .click()
  await expect(page.getByText('Library import needs attention', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry import Needs import.mp3' })).toBeVisible()
  await page.screenshot({ path: '../../artifacts/ui-phase-four/soulseek-downloads.png' })
  await page.getByRole('button', { name: 'Sharing', exact: true }).click()
  await page.screenshot({ path: '../../artifacts/ui-phase-four/soulseek-sharing.png' })
  expect(state.errors).toEqual([])
  expect(state.requests.filter((r) => r.path === '/api/soulseek/downloads')).toEqual([])
})
