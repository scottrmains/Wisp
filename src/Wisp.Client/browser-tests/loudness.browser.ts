import { expect, test, type Page } from '@playwright/test'
import { loudnessPlan, type LoudnessState } from '../src/api/loudness'
import type { Track } from '../src/api/types'

async function setup(page: Page, count = 2, available = true, referenceMode = false) {
  const rows: LoudnessState[] = Array.from({ length: count }, (_, i) => ({
    track: { id: `track-${i}`, title: `Vinyl ${i}`, artist: 'Test artist', fileName: `Vinyl ${i}.wav`,
      filePath: `D:/Music/Vinyl ${i}.wav`, durationSeconds: 20, audioVersion: 'original', hasNormalizedVersion: false,
      bpm: 128, musicalKey: '8A', energy: null, version: null, album: null, genre: null, releaseYear: null,
      isMissingMetadata: false, isDirtyName: false, isUnavailable: false, unavailableSince: null, addedAt: '2026-09-01T00:00:00Z',
      fileModifiedAt: null, lastScannedAt: null, notes: null, isArchived: false, archivedAt: null, archiveReason: null } satisfies Track,
    originalPath: `D:/Music/Vinyl ${i}.wav`, originalExists: true, normalizedExists: false, analysisStale: false, analysis: null, normalization: null,
  }))
  const reference: LoudnessState = { ...rows[0], track: { ...rows[0].track, id: 'reference-1', title: 'Reference master', filePath: 'D:/Music/Reference.wav' }, originalPath: 'D:/Music/Reference.wav' }
  const measurements: Record<string, { integratedLufs: number; truePeakDb: number }> = { 'reference-1': { integratedLufs: -8, truePeakDb: 0 } }
  const calls: { action: string; id: string; body: Record<string, unknown> }[] = []
  let failCreate = false, delay = 0, referenceStale = false, scanSequence = 0
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postDataJSON() as Record<string, unknown> | null
    if (url.pathname === '/api/loudness/settings') return route.fulfill({ json: { available, musicFolder: 'D:/Music', outputFolderName: 'WISP Normalized' } })
    if (url.pathname === '/api/loudness/status') return route.fulfill({ json: rows.filter(row => (body!.trackIds as string[]).includes(row.track.id)) })
    if (url.pathname.includes('/loudness/')) {
      const id = url.pathname.split('/')[3], action = url.pathname.split('/')[5], row = [...rows, reference].find(r => r.track.id === id)!
      calls.push({ id, action, body: body ?? {} })
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      if (action === 'scan') {
        row.analysis = { id: `scan-${id}-${++scanSequence}`, sourcePath: row.originalPath, targetLufs: Number(body!.targetLufs), scannedAt: new Date().toISOString(),
          measurement: { loudnessRange: 5, durationSeconds: 20, ...(measurements[id] ?? { integratedLufs: -22, truePeakDb: -2 }) } }
        row.analysisStale = false
      }
      if (action === 'create') {
        if (failCreate) return route.fulfill({ status: 422, json: { message: 'Disk full: original unchanged.' } })
        if (referenceStale) return route.fulfill({ status: 409, json: { code: 'reference_stale', message: 'The reference changed. Measure it again and rescan.' } })
        const plan = loudnessPlan(row, body!.boostOnly === true, body!.allowLimiting === true)!
        row.normalization = { outputPath: `D:/Music/WISP Normalized/${id}.wav`, targetLufs: row.analysis!.targetLufs, gainDb: plan.gainDb,
          limited: plan.limited, boostOnly: body!.boostOnly === true, referenceTitle: body!.referenceTrackId ? 'Reference master' : null,
          measurement: { integratedLufs: row.analysis!.measurement.integratedLufs + plan.gainDb, truePeakDb: -1.2, loudnessRange: 5, durationSeconds: 20 }, createdAt: new Date().toISOString() }
        row.normalizedExists = true; row.track.hasNormalizedVersion = true
      }
      if (action === 'version') {
        row.track.audioVersion = body!.version as 'original' | 'normalized'
        row.track.filePath = row.track.audioVersion === 'original' ? row.originalPath : row.normalization!.outputPath
      }
      return route.fulfill({ json: row })
    }
    if (url.pathname === '/api/tracks') {
      if (url.searchParams.has('search')) return route.fulfill({ json: { items: [reference.track], total: 1, page: 1, size: 25 } })
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
  if (!referenceMode) await dialog.getByLabel('Match loudness to', { exact: true }).selectOption('custom')
  return { rows, calls, dialog, reference, measurements, failCreate: (value: boolean) => { failCreate = value }, delay: (ms: number) => { delay = ms }, staleReference: () => { referenceStale = true } }
}

test('scan, review, create copies and switch active versions explicitly without duplicating tracks', async ({ page }, testInfo) => {
  const { rows, calls, dialog } = await setup(page)
  expect(calls).toEqual([])
  await expect(dialog.getByRole('button', { name: 'Create 0 normalised copies', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Create 2 normalised copies', exact: true })).toBeEnabled()
  expect(calls.map(c => c.action)).toEqual(['scan', 'scan'])
  await expect(dialog.getByText(/Boost safely by \+0.8 dB/)).toHaveCount(2)
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

async function chooseReference(state: Awaited<ReturnType<typeof setup>>) {
  await state.dialog.getByLabel('Search library for reference', { exact: true }).fill('Reference')
  await expect(state.dialog.getByRole('option', { name: 'Test artist — Reference master', exact: true })).toHaveCount(1)
  await state.dialog.getByLabel('Reference track', { exact: true }).selectOption('reference-1')
  await state.dialog.getByRole('button', { name: 'Measure reference', exact: true }).click()
  await expect(state.dialog).toContainText('original -8.00 LUFS')
}

test('quiet high-peak track requires opt-in limiting; louder tracks remain untouched when matching a library reference', async ({ page }, testInfo) => {
  const state = await setup(page, 2, true, true), { dialog } = state
  state.measurements['track-0'] = { integratedLufs: -13.59, truePeakDb: 0.28 }
  state.measurements['track-1'] = { integratedLufs: -7, truePeakDb: 1 }
  await expect(dialog.getByLabel('Match loudness to', { exact: true })).toHaveValue('reference')
  await expect(dialog.getByRole('checkbox', { name: /Only boost/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /Allow limiting/ })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Scan selected', exact: true })).toBeDisabled()
  await chooseReference(state)
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog).toContainText('Cannot boost safely without limiting')
  await expect(dialog).toContainText('Leave unchanged — already loud enough')
  await expect(dialog.getByRole('button', { name: 'Create 0 normalised copies', exact: true })).toBeDisabled()
  await expect(dialog).not.toContainText('Reduce by')
  await dialog.getByRole('checkbox', { name: /Allow limiting/ }).check()
  await expect(dialog).toContainText('Needs limiting — aiming for -8.0 LUFS (+5.6 dB')
  await expect(dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true })).toBeEnabled()
  await page.setViewportSize({ width: 800, height: 600 })
  await dialog.getByRole('heading').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('reference-controls.png') })
  await dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true }).click()
  await expect(dialog).toContainText('copy -8.0 LUFS · limited')
  const created = state.calls.filter(c => c.action === 'create')
  expect(created).toHaveLength(1)
  expect(created[0].id).toBe('track-0')
  expect(created[0].body).toMatchObject({ boostOnly: true, allowLimiting: true, referenceTrackId: 'reference-1', referenceAnalysisId: state.reference.analysis!.id })
  expect(state.rows.every(r => r.track.audioVersion === 'original')).toBe(true)
  await dialog.getByRole('button', { name: 'Preview normalised', exact: true }).click()
  await expect(dialog.locator('audio')).toHaveAttribute('src', '/api/tracks/track-0/loudness/preview?version=normalized')
  expect(state.rows[0].track.audioVersion).toBe('original')
  await dialog.getByRole('button', { name: 'Use normalised', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Use original', exact: true })).toBeEnabled()
  expect(state.rows[1].normalization).toBeNull()
  await dialog.getByRole('button', { name: 'Use original', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Use normalised', exact: true })).toBeEnabled()
  await dialog.getByLabel('Select Vinyl 0', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('reference-results.png') })
})

test('custom target never reduces by default and requires explicit full matching to do so', async ({ page }) => {
  const state = await setup(page, 1), { dialog } = state
  state.measurements['track-0'] = { integratedLufs: -8, truePeakDb: 0 }
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog).toContainText('Leave unchanged')
  await expect(dialog.getByRole('button', { name: 'Create 0 normalised copies', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /Only boost/ }).uncheck()
  await expect(dialog).toContainText('Reduce by 6.0 dB')
  await expect(dialog).toContainText('Matching all tracks may reduce their volume')
  await dialog.getByRole('button', { name: 'Create 1 normalised copy', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Use normalised', exact: true })).toBeEnabled()
  expect(state.calls.find(c => c.action === 'create')!.body.boostOnly).toBe(false)
})

test('reference in the selection is neither rescanned during batch nor rendered; changed reference blocks the rest', async ({ page }) => {
  const state = await setup(page, 3, true, true), { dialog } = state
  state.measurements['track-1'] = { integratedLufs: -8, truePeakDb: 0 }
  await dialog.getByLabel('Reference track', { exact: true }).selectOption('track-1')
  await dialog.getByRole('button', { name: 'Measure reference', exact: true }).click()
  await expect(dialog).toContainText('original -8.00 LUFS')
  await dialog.getByRole('button', { name: 'Scan selected', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Create 2 normalised copies', exact: true })).toBeEnabled()
  expect(state.calls.filter(c => c.action === 'scan').map(c => c.id)).toEqual(['track-1', 'track-0', 'track-2'])
  state.staleReference()
  await dialog.getByRole('button', { name: 'Create 2 normalised copies', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('The reference changed')
  await expect(dialog.getByRole('button', { name: 'Create 0 normalised copies', exact: true })).toBeDisabled()
  expect(state.calls.filter(c => c.action === 'create')).toHaveLength(1)
  expect(state.rows.every(r => r.normalization === null)).toBe(true)
})

test('unsupported reference loudness is explained without clamping or creating audio', async ({ page }) => {
  const state = await setup(page, 1, true, true), { dialog } = state
  state.measurements['track-0'] = { integratedLufs: -4, truePeakDb: 0 }
  await dialog.getByLabel('Reference track', { exact: true }).selectOption('track-0')
  await dialog.getByRole('button', { name: 'Measure reference', exact: true }).click()
  await expect(dialog).toContainText('original -4.00 LUFS')
  await expect(dialog).toContainText('Supported targets are −30 to −5 LUFS')
  await expect(dialog.getByRole('button', { name: 'Scan selected', exact: true })).toBeDisabled()
  expect(state.calls.filter(c => c.action === 'create')).toEqual([])
})
