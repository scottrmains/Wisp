import { expect, test, type Page } from '@playwright/test'
import type { Tracklist } from '../src/features/recordings/useRecordingTracklist'

function wav() {
  const bytes = 8000 * 2 * 60; const data = Buffer.alloc(44 + bytes)
  data.write('RIFF', 0); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40)
  return data
}
async function setup(page: Page, missing = false, linked = false) {
  const sessions = ['Alpha practice', 'Beta session'].map((title, n) => ({ id: `mix-${n}`, title, directoryPath: 'D:/Mixes/WISP Recordings/test',
    endpointId: 'input', deviceName: 'Xone', sampleRate: 44100, startedAt: `2026-09-${13 - n}T12:00:00Z`, state: 'Ready', audioBytes: 44100 * 8 * 60, issue: null, previousTakeId: null, relinkedPath: null }))
  const reviews: Record<string, { revision: number; rating: number | null; markers: { id: string; seconds: number; label: string }[] }> = {
    'mix-0': { revision: 0, rating: null, markers: [] }, 'mix-1': { revision: 0, rating: 4, markers: [] },
  }
  let job: { id: string; recordingId: string; kind: string; state: string; progress: number; error: string | null } | null = null
  let live = false, failReview = false, failTracklist = false
  const plans = [{ id: 'plan', name: 'Original plan', notes: 'Warm-up', tracks: [], trackCount: 3 }]
  const tracklists: Record<string, Tracklist> = Object.fromEntries(sessions.map(s => [s.id, {
    revision: 0, activeSnapshotId: linked ? 'snapshot' : null, entries: [], timesDisagree: false, missingTrackIds: [],
    snapshots: linked ? [{ id: 'snapshot', sourcePlanId: 'plan', planName: 'Original plan', sourceUpdatedAt: s.startedAt, takenAt: s.startedAt, timing: 'At recording start', sourceExists: true,
      blueprint: { notes: 'Warm-up', entries: ['A', 'B', 'C'].map(title => ({ id: `blueprint-${title}`, trackId: title, artist: 'Artist', title, bpm: 128, musicalKey: '8A', cueInSeconds: 30, cueOutSeconds: null, transitionNotes: null, isAnchor: false })) } }] : [],
  }]))
  const data = wav()
  await page.addInitScript(() => {
    let handler: ((raw: string) => void) | null = null
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (fn: (raw: string) => void) => { handler = fn }, sendMessage: (raw: string) => {
        const request = JSON.parse(raw)
        handler?.(JSON.stringify({ id: request.id, result: { path: request.method === 'pickFolder' ? 'D:/Mixes' : 'D:/Existing/mix.wav' } }))
      },
    } })
  })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/mix-plans') return route.fulfill({ json: linked ? plans : [] })
    if (path === '/api/mix-plans/plan') return route.fulfill({ json: plans[0] })
    if (path === '/api/recording-tracklists/library') return route.fulfill({ json: [{ id: 'X', artist: 'Guest', title: 'X' }] })
    if (path === '/api/recording-tracklists/plans/plan/recordings') return route.fulfill({ json: [sessions[0]] })
    if (path.startsWith('/api/recording-tracklists/mix-')) {
      const [, , , id, operation] = path.split('/'); const list = tracklists[id]
      if (route.request().method() === 'POST') {
        if (failTracklist) return route.fulfill({ status: 409, json: { message: 'Tracklist changed; refresh before retrying.' } })
        const body = route.request().postDataJSON()
        if (operation === 'copy') list.entries = list.snapshots[0].blueprint.entries.map(e => ({ id: `actual-${e.id}`, trackId: e.trackId, artist: e.artist, title: e.title, played: false, startSeconds: null, blueprintEntryId: e.id }))
        if (operation === 'entries') {
          list.entries = body.entries
          if (body.liveEntryId) list.entries = list.entries.map(e => e.id === body.liveEntryId ? { ...e, played: true, startSeconds: 15 } : e)
          const times = list.entries.flatMap(e => e.startSeconds == null ? [] : [e.startSeconds]); list.timesDisagree = times.some((t, i) => i > 0 && t < times[i - 1])
        }
        if (operation === 'unlink') list.activeSnapshotId = null
        if (operation === 'link') { list.snapshots.push({ ...structuredClone(tracklists['mix-1'].snapshots[0]), id: body.snapshotId, timing: 'Linked after recording started' }); list.activeSnapshotId = body.snapshotId }
        list.revision++; return route.fulfill({ status: 204 })
      }
      return route.fulfill({ json: list })
    }
    if (path === '/api/recording-workspace/mixes') return route.fulfill({ json: sessions.map(s => ({ session: s, rating: reviews[s.id].rating, duration: 60, missing: missing && s.id === 'mix-0' })) })
    if (path === '/api/recording-workspace/job') return route.fulfill({ json: job })
    if (path === '/api/recording-workspace/import') { job = { id: 'job', recordingId: 'imported', kind: 'import', state: 'Running', progress: .2, error: null }; return route.fulfill({ json: job }) }
    if (path.endsWith('/cancel')) { if (job) job.state = 'Cancelled'; return route.fulfill({ status: 204 }) }
    if (path.endsWith('/peaks')) return route.fulfill({ json: { duration: 60, levels: [{ secondsPerBucket: .1, min: Array.from({ length: 600 }, (_, i) => -.2 - Math.abs(Math.sin(i * .1)) * .45), max: Array.from({ length: 600 }, (_, i) => .2 + Math.abs(Math.cos(i * .1)) * .4) }] } })
    if (path.endsWith('/review')) {
      const id = path.split('/')[3]
      if (route.request().method() === 'POST') {
        if (failReview) return route.fulfill({ status: 409, json: { message: 'Review changed; refresh before retrying.' } })
        reviews[id] = { ...route.request().postDataJSON(), revision: reviews[id].revision + 1 }
      }
      return route.fulfill({ json: reviews[id] })
    }
    if (path.endsWith('/audio')) {
      const range = route.request().headers()['range']?.match(/bytes=(\d+)-(\d*)/)
      const start = range ? +range[1] : 0; const end = range?.[2] ? Math.min(+range[2], data.length - 1) : data.length - 1
      return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: data.subarray(start, end + 1),
        headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) } })
    }
    if (path === '/api/recordings/') return route.fulfill({ json: sessions })
    if (path === '/api/recordings/status') return route.fulfill({ json: { session: live ? sessions[0] : null, busy: live, seconds: 15, savedSeconds: 14, leftPeak: .4, rightPeak: .4, closeRequested: false } })
    if (path === '/api/recording-input/devices') return route.fulfill({ json: { devices: [], selectedEndpointId: null } })
    if (path === '/api/recording-input/test') return route.fulfill({ json: { state: 'Idle', id: null, seconds: 0 } })
    if (path === '/api/recordings/settings') return route.fulfill({ json: { folder: 'D:/Mixes' } })
    if (path === '/api/tracks') return route.fulfill({ json: { items: [], total: 0, page: 1, size: 500 } })
    return route.fulfill({ json: [] })
  })
  await page.goto('/'); await page.getByRole('button', { name: 'Recordings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your mixes', exact: true })).toBeVisible()
  return { reviews, tracklists, startLive: () => { live = true; sessions[0].state = 'Recording' }, failReview: () => { failReview = true }, failTracklist: (value: boolean) => { failTracklist = value } }
}

test('blueprint A B C becomes actual A X C with waveform times, without rewriting the plan', async ({ page }, info) => {
  const fixture = await setup(page, false, true)
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  await panel.getByRole('button', { name: 'Copy blueprint as draft' }).click()
  await expect(panel.getByText('Unconfirmed · Untimed', { exact: false })).toHaveCount(3)
  await expect(panel.getByRole('button', { name: 'Copy blueprint as draft' })).toBeDisabled()
  await panel.getByLabel('Tracklist entry 2', { exact: true }).getByRole('button', { name: 'Remove tracklist entry' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove entry', exact: true }).click()
  await panel.getByLabel('Find library track').fill('Guest')
  await panel.getByRole('button', { name: 'Add Guest — X' }).click()
  await panel.getByRole('button', { name: 'Move entry 3 up' }).click()
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  await page.getByRole('button', { name: 'Pause mix', exact: true }).click()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('1')
  for (const [index, time] of [0, 20, 40].entries()) {
    await page.getByRole('slider', { name: 'Mix position', exact: true }).fill(String(time))
    await panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByRole('button', { name: 'Set start here' }).click()
    await expect(panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByLabel('Confirmed played')).toBeChecked()
  }
  expect(fixture.tracklists['mix-0'].entries.map(e => [e.title, e.startSeconds])).toEqual([['A', 0], ['X', 20], ['C', 40]])
  expect(fixture.tracklists['mix-0'].snapshots[0].blueprint.entries.map(e => e.title)).toEqual(['A', 'B', 'C'])
  expect(fixture.reviews['mix-0'].markers).toEqual([])
  await page.setViewportSize({ width: 800, height: 600 }); await panel.getByRole('heading', { name: /Actual tracklist/ }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('tracklist-800.png') })
  await page.reload()
  await expect(panel.getByLabel('Tracklist entry 2', { exact: true })).toContainText('Guest — X')
})

test('standalone manual repeated tracks, clear versus unconfirm, sort and failed save recovery', async ({ page }) => {
  const fixture = await setup(page)
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  for (let n = 0; n < 2; n++) {
    await panel.getByLabel('Manual title', { exact: true }).fill('Repeat')
    await panel.getByRole('button', { name: 'Add manual track' }).click()
    await expect(panel.getByLabel('Manual title', { exact: true })).toHaveValue('')
  }
  await panel.getByLabel('Tracklist entry 1', { exact: true }).getByLabel('Confirmed played').click()
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true })).toContainText('Played · Untimed')
  await panel.getByLabel('Tracklist entry 1', { exact: true }).getByRole('button', { name: 'Edit start time' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('not a time')
  await page.getByRole('dialog').getByRole('button', { name: 'Save start' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Enter a valid time')
  await page.getByRole('dialog').press('Escape')
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true }).getByRole('button', { name: 'Edit start time' })).toBeFocused()
  for (const [index, time] of ['30', '10'].entries()) {
    await panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByRole('button', { name: 'Edit start time' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill(time)
    await page.getByRole('dialog').getByRole('button', { name: 'Save start' }).click()
    await expect(panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByRole('button', { name: 'Clear time' })).toBeVisible()
  }
  await panel.getByRole('button', { name: 'Order by start time' }).click()
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true })).toContainText('0:00:10.00')
  await panel.getByLabel('Tracklist entry 1', { exact: true }).getByRole('button', { name: 'Clear time' }).click()
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true })).toContainText('Played · Untimed')
  await panel.getByLabel('Tracklist entry 2', { exact: true }).getByLabel('Confirmed played').click()
  await expect(panel.getByLabel('Tracklist entry 2', { exact: true })).toContainText('Unconfirmed · Untimed')
  fixture.failTracklist(true)
  await panel.getByLabel('Manual title', { exact: true }).fill('Keep this draft')
  await panel.getByRole('button', { name: 'Add manual track' }).click()
  await expect(panel.getByRole('alert')).toContainText('Tracklist changed')
  await expect(panel.getByLabel('Manual title', { exact: true })).toHaveValue('Keep this draft')
  expect(fixture.tracklists['mix-0'].entries).toHaveLength(2)
  fixture.failTracklist(false)
  await panel.getByRole('button', { name: 'Refresh tracklist' }).click()
  await panel.getByRole('button', { name: 'Add manual track' }).click()
  await expect(panel.getByLabel('Tracklist entry 3', { exact: true })).toContainText('Keep this draft')
})

test('recording and Mix Plan navigation preserves snapshots; recording setup is explicit', async ({ page }) => {
  const fixture = await setup(page, false, true)
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  await panel.getByText('Saved blueprint · Original plan', { exact: true }).click()
  await panel.getByRole('button', { name: 'Open current Mix Plan' }).click()
  await expect(page.getByRole('button', { name: 'Record this plan' })).toBeVisible()
  await page.getByText('Recordings with snapshots of this plan (1)', { exact: true }).click()
  await page.getByRole('button', { name: 'Alpha practice · Ready', exact: true }).click()
  await expect(panel).toBeVisible()
  await panel.getByText('Saved blueprint · Original plan', { exact: true }).click()
  await panel.getByRole('button', { name: 'Unlink blueprint' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink', exact: true }).click()
  await expect(panel.getByText('Saved blueprint · No active plan', { exact: true })).toBeVisible()
  expect(fixture.tracklists['mix-0'].snapshots).toHaveLength(1)
  await panel.getByText(/Earlier snapshot · Original plan/).click()
  await panel.getByRole('button', { name: 'Open current Mix Plan' }).click()
  await page.getByRole('button', { name: 'Record this plan' }).click()
  await expect(page.getByLabel('Blueprint (optional)')).toHaveValue('plan')
  await expect(page.getByRole('heading', { name: 'Record a mix', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop and save mix' })).toBeDisabled()
})

test('live entry marking is explicit and does not turn review markers into tracks', async ({ page }) => {
  const fixture = await setup(page, false, true)
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  await panel.getByRole('button', { name: 'Copy blueprint as draft' }).click()
  fixture.startLive()
  await panel.getByLabel('Tracklist entry 2', { exact: true }).getByRole('button', { name: 'Track started (live)' }).click()
  await expect(panel.getByLabel('Tracklist entry 2', { exact: true })).toContainText('Played · 0:00:15.00')
  expect(fixture.tracklists['mix-0'].entries.filter(e => e.played)).toHaveLength(1)
  expect(fixture.reviews['mix-0'].markers).toHaveLength(0)
})

test('history searches and sorts; ratings survive selection and reload', async ({ page }) => {
  const fixture = await setup(page)
  await page.getByLabel('Satisfaction').selectOption('5')
  await expect(page.getByText('Review saved', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('rating')
  await expect(page.getByRole('region', { name: 'Mix history' }).getByRole('button').first()).toContainText('Alpha practice')
  await page.getByLabel('Find a mix').fill('Beta')
  await expect(page.getByRole('region', { name: 'Mix history' }).getByRole('button')).toHaveCount(1)
  await page.reload(); await page.getByRole('button', { name: 'Recordings', exact: true }).click()
  await expect(page.getByLabel('Satisfaction')).toHaveValue('5')
  expect(fixture.reviews['mix-0'].rating).toBe(5)
})

test('real audio playback, seek, zoom, markers, pre-roll and section looping', async ({ page }, info) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  await page.getByRole('button', { name: 'Pause mix', exact: true }).click()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('20')
  await page.getByLabel('Marker label', { exact: true }).fill('Tighten this transition')
  await page.getByRole('button', { name: 'Mark this moment', exact: true }).click()
  await expect(page.getByRole('button', { name: /0:00:20 · Tighten/ })).toBeVisible()
  await page.getByRole('button', { name: /0:00:20 · Tighten/ }).click()
  await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('17')
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('4')
  await page.getByRole('slider', { name: 'Recording waveform position', exact: true }).press('ArrowRight')
  await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('22')
  await page.getByText('Section loop', { exact: true }).click()
  await page.getByRole('button', { name: /Set loop start/ }).click()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('30')
  await page.getByRole('button', { name: /Set loop end/ }).click()
  await page.getByLabel('Loop section').check()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('31')
  await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('22')
  expect(fixture.reviews['mix-0'].markers).toHaveLength(1)
  await page.setViewportSize({ width: 800, height: 600 })
  await page.getByRole('slider', { name: 'Recording waveform position', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('workspace-800.png') })
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: info.outputPath('workspace-1440.png') })
})

test('resize is keyboard accessible and typing a marker does not start playback', async ({ page }) => {
  await setup(page)
  const separator = page.getByRole('separator', { name: 'Resize mix history' })
  await separator.press('ArrowDown'); await expect(separator).toHaveAttribute('aria-valuenow', '210')
  await page.getByLabel('Marker label', { exact: true }).fill('Review the next mix')
  await page.getByLabel('Marker label', { exact: true }).press('Space')
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeVisible()
})

test('missing media and failed review saves remain actionable without dropping draft text', async ({ page }) => {
  const fixture = await setup(page, true)
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeDisabled()
  await expect(page.getByText(/Master file is missing/)).toBeVisible()
  fixture.failReview()
  await page.getByLabel('Marker label', { exact: true }).fill('Keep my draft')
  await page.getByRole('button', { name: 'Mark this moment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Review changed')
  await expect(page.getByLabel('Marker label', { exact: true })).toHaveValue('Keep my draft')
})

test('capture stops playback, blocks imports and records a live marker; import cancellation is explicit', async ({ page }) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Import a mix', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel processing', exact: true }).click()
  await expect(page.getByText('Mix import · Cancelled', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  fixture.startLive()
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Import a mix', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Mark this moment (live)', exact: true }).click()
  await expect.poll(() => fixture.reviews['mix-0'].markers.length).toBe(1)
  expect(fixture.reviews['mix-0'].markers[0].seconds).toBe(15)
})
