import { expect, test, type Page } from '@playwright/test'
import type { AnalysisJob, AnalysisRow } from '../src/api/musicAnalysis'
import type { Track } from '../src/api/types'

async function setup(
  page: Page,
  count = 3,
  available = true,
  recovered = false,
  openSelected = true,
  keyDiagnostics = false,
) {
  const tracks: Track[] = Array.from({ length: count }, (_, i) => ({
    id: `track-${i}`,
    title: `Garage ${i}`,
    artist: 'Test artist',
    version: 'Dub',
    fileName: `Garage ${i}.wav`,
    filePath: `D:/Music/Garage ${i}.wav`,
    durationSeconds: 240,
    bpm: i === 1 ? 125 : null,
    musicalKey: null,
    audioVersion: 'original',
    hasNormalizedVersion: false,
    album: null,
    genre: null,
    energy: null,
    releaseYear: null,
    isMissingMetadata: true,
    isDirtyName: false,
    isUnavailable: false,
    unavailableSince: null,
    addedAt: '2026-10-01T00:00:00Z',
    fileModifiedAt: null,
    lastScannedAt: null,
    notes: null,
    isArchived: false,
    archivedAt: null,
    archiveReason: null,
  }))
  const calls: { path: string; body: Record<string, unknown> }[] = []
  let job: AnalysisJob | null = null,
    running = false,
    failApply = false,
    failJob = false,
    failMissing = false
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url())
    if (url.pathname === '/api/audio-analysis/status')
      return route.fulfill({ json: { available, activeJob: job && running ? job : null } })
    if (url.pathname === '/api/audio-analysis/jobs' && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>
      calls.push({ path: 'start', body })
      job = {
        id: 'job-1',
        status: running ? 'running' : 'completed',
        rows: (body.trackIds as string[]).map((id) => {
          const t = tracks.find((t) => t.id === id)!
          return {
            trackId: id,
            title: `${t.artist} — ${t.title} (${t.version})`,
            status: running ? 'queued' : 'review',
            message: null,
            existingBpm: t.bpm,
            existingKey: t.musicalKey,
            cached: recovered,
            bpmRequested:
              body.bpm === true && (body.compareExisting === true || !(t.bpm && t.bpm > 0)),
            keyRequested: body.key === true,
            result: running
              ? null
              : {
                  bpm: 128.37,
                  key: '8A',
                  tempoStrength: 0.85,
                  keyStrength: 0.7,
                  tempoUncertain: id === 'track-2',
                  keyUncertain: keyDiagnostics || id === 'track-2',
                  seconds: 240,
                  engine: 'wisp-onset-chroma-v1',
                  decodeWarning: recovered
                    ? 'Decoded with recoverable file warnings. Listen to the track before applying these suggestions.'
                    : null,
                  keyAgreement: keyDiagnostics ? 0.42 : null,
                  tuningCents: keyDiagnostics ? -12.5 : null,
                  alternativeKey: keyDiagnostics ? '9B' : null,
                  keyWarning: keyDiagnostics
                    ? 'Tonal sections disagree. Audition before applying.'
                    : null,
                },
          } satisfies AnalysisRow
        }),
      }
      return route.fulfill({ json: job })
    }
    if (url.pathname === '/api/audio-analysis/jobs/job-1') {
      if (failJob)
        return route.fulfill({ status: 503, json: { message: 'Analysis connection unavailable' } })
      return route.fulfill({ json: job })
    }
    if (url.pathname.endsWith('/cancel')) {
      calls.push({ path: 'cancel', body: {} })
      running = false
      job!.status = 'cancelled'
      job!.rows.forEach((r) => {
        r.status = 'cancelled'
      })
      return route.fulfill({ status: 204 })
    }
    if (url.pathname.endsWith('/apply')) {
      const body = req.postDataJSON() as Record<string, unknown>
      calls.push({ path: 'apply', body })
      if (failApply)
        return route.fulfill({
          status: 409,
          json: { message: 'Audio or tags changed. Analyse again.' },
        })
      return route.fulfill({
        json: {
          bpmApplied: body.bpm !== null,
          keyApplied: body.key !== null,
          message: 'Missing values applied to WISP.',
        },
      })
    }
    if (url.pathname === '/api/tracks') {
      const missing = url.searchParams.get('missingBpm') === 'true'
      if (missing) {
        calls.push({ path: 'collect', body: Object.fromEntries(url.searchParams) })
        if (failMissing)
          return route.fulfill({ status: 503, json: { message: 'Tracklist unavailable' } })
      }
      const filtered = missing ? tracks.filter((t) => !t.bpm || t.bpm <= 0) : tracks
      const current = Number(url.searchParams.get('page') ?? 1),
        size = Number(url.searchParams.get('size') ?? 500)
      return route.fulfill({
        json: {
          items: filtered.slice((current - 1) * size, current * size),
          total: filtered.length,
          page: current,
          size,
        },
      })
    }
    await route.fulfill({ json: [] })
  })
  await page.goto('/')
  const dialog = page.getByRole('dialog', { name: 'Find the tempo. Find the key.' })
  if (openSelected) {
    await page.getByText('Garage 0 (Dub)', { exact: true }).click()
    await page.keyboard.press('Control+a')
    await page.getByRole('button', { name: 'Library actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Analyse audio (BPM / key)…', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByLabel('Find key (Camelot · experimental)', { exact: true }),
    ).not.toBeChecked()
    await dialog.getByLabel('Find key (Camelot · experimental)', { exact: true }).check()
  }
  return {
    dialog,
    calls,
    tracks,
    failMissing: (v: boolean) => {
      failMissing = v
    },
    setRunning: (v: boolean) => {
      running = v
    },
    failApply: (v: boolean) => {
      failApply = v
    },
    failJob: (v: boolean) => {
      failJob = v
    },
  }
}

async function openMissing(page: Page) {
  await page.getByRole('button', { name: 'Library actions', exact: true }).click()
  await page
    .getByRole('menuitem', { name: 'Analyse missing BPMs in this list…', exact: true })
    .click()
}

test('missing BPM action collects every filtered page without selecting track rows', async ({
  page,
}) => {
  const { dialog, calls } = await setup(page, 1002, true, false, false)
  await openMissing(page)
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Analyse 1,001 tracks', exact: true }),
  ).toBeEnabled()
  await expect(
    dialog.getByLabel('Find key (Camelot · experimental)', { exact: true }),
  ).not.toBeChecked()
  await expect(dialog.getByLabel('Compare existing values too', { exact: false })).not.toBeChecked()
  expect(calls.filter((c) => c.path === 'collect').map((c) => c.body.page)).toEqual(['1', '2'])
  expect(calls.filter((c) => c.path === 'apply')).toHaveLength(0)
})

test('missing BPM review can explicitly select uncertain suggestions across result pages, preserving existing BPMs and keys', async ({
  page,
}, testInfo) => {
  const { dialog, calls, tracks } = await setup(page, 55, true, false, false)
  tracks[2].bpm = -5 // Invalid/nonpositive values are missing, not preserved positive BPMs.
  await openMissing(page)
  await dialog.getByRole('button', { name: 'Analyse 54 tracks', exact: true }).click()
  const start = calls.find((c) => c.path === 'start')!
  expect(start.body).toMatchObject({ bpm: true, key: false, compareExisting: false })
  expect(start.body.trackIds).not.toContain('track-1')
  await expect(dialog).not.toContainText('Existing: -5 · preserved')
  await expect(
    dialog.getByLabel('Apply BPM for Test artist — Garage 2 (Dub)', { exact: true }),
  ).not.toBeChecked()
  await dialog
    .getByRole('button', { name: 'Select all missing BPM suggestions', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(dialog).toContainText('Garage 54')
  await page.screenshot({ path: testInfo.outputPath('missing-bpm-review.png') })
  await dialog
    .getByRole('button', { name: 'Apply selected missing values (54)', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText('54 tracks updated')
  const applied = calls.filter((c) => c.path === 'apply')
  expect(applied).toHaveLength(54)
  expect(applied.every((c) => c.body.key === null)).toBe(true)
})

test('missing BPM collection errors can be retried and an empty result explains that nothing changed', async ({
  page,
}) => {
  const state = await setup(page, 3, true, false, false)
  state.failMissing(true)
  await openMissing(page)
  await expect(page.getByRole('alert')).toContainText('Tracklist unavailable')
  await expect(state.dialog).not.toBeVisible()
  state.failMissing(false)
  state.tracks.forEach((t) => {
    t.bpm = 125
  })
  await openMissing(page)
  await expect(
    page.getByText(
      'No playable tracks with missing BPMs in this list. Existing values are unchanged.',
    ),
  ).toBeVisible()
  await expect(state.dialog).not.toBeVisible()
  expect(state.calls.some((c) => c.path === 'start')).toBe(false)
})

test('key disagreement, tuning and alternatives remain visible and never auto-select key', async ({
  page,
}, testInfo) => {
  const { dialog } = await setup(page, 1, true, false, true, true)
  await dialog.getByRole('button', { name: 'Analyse 1 track', exact: true }).click()
  await expect(
    dialog.getByLabel('Apply key for Test artist — Garage 0 (Dub)', { exact: true }),
  ).not.toBeChecked()
  await expect(dialog).toContainText('Tonal sections disagree')
  await dialog.getByText('Analysis details', { exact: true }).click()
  await expect(dialog).toContainText(
    'Tonal section agreement: 42% (not probability of correctness)',
  )
  await expect(dialog).toContainText('Alternative interpretation: 9B')
  await expect(dialog).toContainText('Tuning offset: -12.5 cents')
  await page.screenshot({ path: testInfo.outputPath('key-disagreement.png') })
})

test('missing BPM preset resets previous key/comparison choices on the already mounted dialog', async ({
  page,
}) => {
  const { dialog } = await setup(page)
  await dialog.getByLabel('Compare existing values too', { exact: false }).check()
  await dialog.getByRole('button', { name: 'Close audio analysis', exact: true }).click()
  await openMissing(page)
  await expect(dialog.getByLabel('Find BPM', { exact: true })).toBeChecked()
  await expect(
    dialog.getByLabel('Find key (Camelot · experimental)', { exact: true }),
  ).not.toBeChecked()
  await expect(dialog.getByLabel('Compare existing values too', { exact: false })).not.toBeChecked()
})

test('selected analysis reviews missing fields, uncertain results and half/double corrections', async ({
  page,
}, testInfo) => {
  const { dialog, calls } = await setup(page)
  await dialog.getByRole('button', { name: 'Analyse 3 tracks', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: 'Apply selected missing values (2)', exact: true }),
  ).toBeEnabled()
  expect(calls[0].body).toEqual({
    trackIds: ['track-0', 'track-1', 'track-2'],
    bpm: true,
    key: true,
    compareExisting: false,
  })
  await expect(
    dialog.getByLabel('Apply BPM for Test artist — Garage 2 (Dub)', { exact: true }),
  ).not.toBeChecked()
  await dialog
    .getByRole('button', { name: 'Halve BPM for Test artist — Garage 0 (Dub)', exact: true })
    .click()
  await expect(
    dialog.getByLabel('Reviewed BPM for Test artist — Garage 0 (Dub)', { exact: true }),
  ).toHaveValue('64.19')
  await page.screenshot({ path: testInfo.outputPath('music-analysis-review.png') })
  await dialog
    .getByRole('button', { name: 'Apply selected missing values (2)', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText('2 tracks updated')
  expect(calls.filter((c) => c.path === 'apply').map((c) => c.body)).toEqual([
    { bpm: 64.19, key: '8A' },
    { bpm: null, key: '8A' },
  ])
})

test('recovered decoding warning stays visible on cached results and requires explicit selection', async ({
  page,
}, testInfo) => {
  const { dialog, calls } = await setup(page, 1, true, true)
  await dialog.getByRole('button', { name: 'Analyse 1 track', exact: true }).click()
  await expect(dialog).toContainText('Cached suggestion')
  await expect(dialog).toContainText('Decoded with recoverable file warnings')
  const bpm = dialog.getByLabel('Apply BPM for Test artist — Garage 0 (Dub)', { exact: true })
  await expect(bpm).not.toBeChecked()
  await expect(
    dialog.getByLabel('Apply key for Test artist — Garage 0 (Dub)', { exact: true }),
  ).not.toBeChecked()
  await expect(
    dialog.getByRole('button', { name: 'Apply selected missing values (0)', exact: true }),
  ).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('music-analysis-recovered.png') })
  await bpm.check()
  await dialog
    .getByRole('button', { name: 'Apply selected missing values (1)', exact: true })
    .click()
  expect(calls.filter((c) => c.path === 'apply').map((c) => c.body)).toEqual([
    { bpm: 128.37, key: null },
  ])
})

test('comparison shows existing BPM disabled; failed application is retryable', async ({
  page,
}) => {
  const state = await setup(page, 2)
  await state.dialog.getByLabel('Compare existing values too', { exact: false }).check()
  await state.dialog.getByRole('button', { name: 'Analyse 2 tracks', exact: true }).click()
  await expect(
    state.dialog.getByLabel('Apply BPM for Test artist — Garage 1 (Dub)', { exact: true }),
  ).toBeDisabled()
  await expect(state.dialog).toContainText('Existing: 125 · preserved')
  state.failApply(true)
  await state.dialog
    .getByRole('button', { name: 'Apply selected missing values (2)', exact: true })
    .click()
  await expect(state.dialog.getByRole('alert')).toContainText('Analyse again')
  state.failApply(false)
  await state.dialog
    .getByRole('button', { name: 'Apply selected missing values (2)', exact: true })
    .click()
  await expect(state.dialog.getByRole('status')).toContainText('2 tracks updated')
})

test('analysis survives closing its dialog and page navigation, then can be cancelled', async ({
  page,
}) => {
  const state = await setup(page)
  state.setRunning(true)
  await state.dialog.getByRole('button', { name: 'Analyse 3 tracks', exact: true }).click()
  await state.dialog.getByRole('button', { name: 'Close audio analysis', exact: true }).click()
  await expect(state.dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Mix Plans', exact: true }).click()
  await page.getByRole('button', { name: 'Analysing audio · 0/3', exact: true }).click()
  await expect(state.dialog).toBeVisible()
  await state.dialog.getByRole('button', { name: 'Cancel analysis', exact: true }).click()
  await expect(state.dialog).toContainText('cancelled')
  expect(state.calls.filter((c) => c.path === 'cancel')).toHaveLength(1)
})

test('unavailable decoder and lost connection block actions with retry feedback', async ({
  page,
}) => {
  const { dialog } = await setup(page, 1, false)
  await expect(dialog.getByRole('alert')).toContainText('FFmpeg is unavailable')
  await expect(dialog.getByRole('button', { name: 'Analyse 1 track', exact: true })).toBeDisabled()
})

test('BPM and key can be applied independently, and invalid tempo blocks apply', async ({
  page,
}) => {
  const { dialog, calls } = await setup(page, 1)
  await dialog.getByRole('button', { name: 'Analyse 1 track', exact: true }).click()
  await dialog.getByLabel('Apply key for Test artist — Garage 0 (Dub)', { exact: true }).uncheck()
  const tempo = dialog.getByLabel('Reviewed BPM for Test artist — Garage 0 (Dub)', { exact: true })
  await tempo.fill('401')
  await expect(
    dialog.getByRole('button', { name: 'Apply selected missing values (1)', exact: true }),
  ).toBeDisabled()
  await tempo.fill('128.37')
  await dialog
    .getByRole('button', { name: 'Apply selected missing values (1)', exact: true })
    .click()
  await expect(
    dialog.getByLabel('Apply BPM for Test artist — Garage 0 (Dub)', { exact: true }),
  ).toBeDisabled()
  await dialog.getByLabel('Apply key for Test artist — Garage 0 (Dub)', { exact: true }).check()
  await dialog
    .getByRole('button', { name: 'Apply selected missing values (1)', exact: true })
    .click()
  expect(calls.filter((c) => c.path === 'apply').map((c) => c.body)).toEqual([
    { bpm: 128.37, key: null },
    { bpm: null, key: '8A' },
  ])
})

test('lost connection can be retried and completed results cleared for another analysis', async ({
  page,
}) => {
  const state = await setup(page, 1)
  state.setRunning(true)
  await state.dialog.getByRole('button', { name: 'Analyse 1 track', exact: true }).click()
  state.failJob(true)
  await expect(state.dialog.getByRole('alert')).toContainText('Analysis connection unavailable', {
    timeout: 10000,
  })
  await expect(
    state.dialog.getByRole('button', { name: 'Retry connection', exact: true }),
  ).toBeVisible()
  state.failJob(false)
  await state.dialog.getByRole('button', { name: 'Retry connection', exact: true }).click()
  await state.dialog.getByRole('button', { name: 'Cancel analysis', exact: true }).click()
  await state.dialog.getByRole('button', { name: 'Clear results', exact: true }).click()
  await expect(
    state.dialog.getByRole('button', { name: 'Analyse 1 track', exact: true }),
  ).toBeEnabled()
})

test('pagination keeps all selected results and dialog fits small screens', async ({ page }) => {
  const { dialog, calls } = await setup(page, 55)
  await dialog.getByRole('button', { name: 'Analyse 55 tracks', exact: true }).click()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(dialog).toContainText('Garage 54')
  await page.setViewportSize({ width: 600, height: 600 })
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(600)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(600)
  await dialog
    .getByRole('button', { name: 'Apply selected missing values (54)', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText('54 tracks updated')
  expect(calls.filter((c) => c.path === 'apply')).toHaveLength(54)
})
