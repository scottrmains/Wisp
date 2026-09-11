import { expect, test, type Page } from '@playwright/test'
import type { LoudnessState } from '../src/api/loudness'
import type { Track } from '../src/api/types'

async function setup(page: Page, count = 2, available = true) {
  const rows: LoudnessState[] = Array.from({ length: count }, (_, i) => ({
    track: { id: `track-${i}`, title: `Vinyl ${i}`, artist: 'Test artist', fileName: `Vinyl ${i}.wav`,
      filePath: `D:/Music/Vinyl ${i}.wav`, durationSeconds: 20, audioVersion: 'original', hasNormalizedVersion: false,
      bpm: 128, musicalKey: '8A', energy: null, version: null, album: null, genre: null, releaseYear: null,
      isMissingMetadata: false, isDirtyName: false, isUnavailable: false, unavailableSince: null, addedAt: '2026-09-01T00:00:00Z',
      fileModifiedAt: null, lastScannedAt: null, notes: null, isArchived: false, archivedAt: null, archiveReason: null } satisfies Track,
    originalPath: `D:/Music/Vinyl ${i}.wav`, originalExists: true, normalizedExists: false, analysisStale: false, analysis: null, normalization: null,
  }))
  const calls: { action: string; id: string; body: Record<string, unknown> }[] = []
  let failCreate = false, delay = 0
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postDataJSON() as Record<string, unknown> | null
    if (url.pathname === '/api/loudness/settings') return route.fulfill({ json: { available, musicFolder: 'D:/Music', outputFolderName: 'WISP Normalized' } })
    if (url.pathname === '/api/loudness/status') return route.fulfill({ json: rows.filter(row => (body!.trackIds as string[]).includes(row.track.id)) })
    if (url.pathname.includes('/loudness/')) {
      const id = url.pathname.split('/')[3], action = url.pathname.split('/')[5], row = rows.find(r => r.track.id === id)!
      calls.push({ id, action, body: body ?? {} })
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      if (action === 'scan') {
        row.analysis = { id: `scan-${id}`, sourcePath: row.originalPath, targetLufs: Number(body!.targetLufs), scannedAt: new Date().toISOString(),
          measurement: { integratedLufs: -22, truePeakDb: -2, loudnessRange: 5, durationSeconds: 20 } }
        row.analysisStale = false
      }
      if (action === 'create') {
        if (failCreate) return route.fulfill({ status: 422, json: { message: 'Disk full: original unchanged.' } })
        row.normalization = { outputPath: `D:/Music/WISP Normalized/${id}.wav`, targetLufs: row.analysis!.targetLufs, gainDb: 0.8,
          limited: body!.allowLimiting === true, measurement: { integratedLufs: -21.2, truePeakDb: -1.2, loudnessRange: 5, durationSeconds: 20 }, createdAt: new Date().toISOString() }
        row.normalizedExists = true; row.track.hasNormalizedVersion = true
      }
      if (action === 'version') {
        row.track.audioVersion = body!.version as 'original' | 'normalized'
        row.track.filePath = row.track.audioVersion === 'original' ? row.originalPath : row.normalization!.outputPath
      }
      return route.fulfill({ json: row })
    }
    if (url.pathname === '/api/tracks') {
      const size = Number(url.searchParams.get('size') ?? 500), number = Number(url.searchParams.get('page') ?? 1)
      return route.fulfill({ json: { items: rows.slice((number - 1) * size, number * size).map(r => r.track), total: count, page: number, size } })
    }
    await route.fulfill({ json: [] })
  })
  await page.goto('/')
  await page.getByText('Vinyl 0', { exact: true }).click()
  await page.keyboard.press('Control+a')
  if (count > 1) await expect(page.getByText(`${count} tracks selected`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Loudness & versions…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Loudness & audio versions', exact: true })
  await expect(dialog.getByLabel('Select Vinyl 0', { exact: true })).toBeVisible()
  return { rows, calls, dialog, failCreate: (value: boolean) => { failCreate = value }, delay: (ms: number) => { delay = ms } }
}

test('scan, review, create copies and switch active versions explicitly without duplicating tracks', async ({ page }, testInfo) => {
  const { rows, calls, dialog } = await setup(page)
  expect(calls).toEqual([])
  await expect(dialog.getByRole('button', { name: 'Create 0 normalised copies', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Create 2 normalised copies', exact: true })).toBeEnabled()
  expect(calls.map(c => c.action)).toEqual(['scan', 'scan'])
  await expect(dialog.getByText('Peak-limited: safe mode will stay below target. Limiting is optional.')).toHaveCount(2)
  await page.setViewportSize({ width: 800, height: 600 })
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(800)
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(600)
  await page.screenshot({ path: testInfo.outputPath('loudness-review.png') })
  await dialog.getByRole('button', { name: 'Create 2 normalised copies', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Use normalised copies', exact: true })).toBeEnabled()
  expect(calls.filter(c => c.action === 'create').every(c => c.body.allowLimiting === false)).toBe(true)
  expect(rows.every(r => r.track.audioVersion === 'original')).toBe(true)
  await dialog.getByRole('button', { name: 'Use normalised copies', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Use originals', exact: true })).toBeEnabled()
  expect(rows.every(r => r.track.audioVersion === 'normalized')).toBe(true)
  await dialog.getByRole('button', { name: 'Use originals', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
  expect(rows.every(r => r.track.filePath === r.originalPath && r.normalizedExists)).toBe(true)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByText('Vinyl 0', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Original · copy saved', { exact: true })).toHaveCount(2)
})

test('target change requires rescan and limiting is explicit; failed copies can be retried', async ({ page }) => {
  const state = await setup(page, 1), { dialog } = state
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true })).toBeEnabled()
  await dialog.getByLabel('Target LUFS', { exact: true }).fill('-16')
  await expect(dialog.getByRole('button', { name: 'Create 0 normalised copies', exact: true })).toBeDisabled()
  await expect(dialog).toContainText('Rescan required')
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true })).toBeEnabled()
  await dialog.getByRole('checkbox', { name: /Allow limiting/ }).check()
  state.failCreate(true)
  await dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('original unchanged')
  await expect(dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true })).toBeEnabled()
  state.failCreate(false)
  await dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Use normalised', exact: true })).toBeEnabled()
  expect(state.calls.filter(c => c.action === 'create').every(c => c.body.allowLimiting === true)).toBe(true)
})

test('selected batch spans result pages and stops without queuing the rest', async ({ page }) => {
  const state = await setup(page, 105), { dialog } = state
  await dialog.getByRole('button', { name: 'Next results', exact: true }).click()
  await expect(dialog.getByLabel('Select Vinyl 104', { exact: true })).toBeVisible()
  state.delay(500)
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Stop processing', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
  await expect(dialog).toContainText('Stopped.')
  expect(state.calls.filter(c => c.action === 'scan')).toHaveLength(1)
})

test('missing FFmpeg gives an actionable error without starting analysis', async ({ page }) => {
  const { dialog, calls } = await setup(page, 1, false)
  await expect(dialog.getByRole('alert')).toContainText('FFmpeg is unavailable')
  await expect(dialog.getByRole('button', { name: 'Scan selected', exact: true })).toBeDisabled()
  expect(calls).toEqual([])
})
