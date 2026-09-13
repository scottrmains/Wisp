import { expect, test, type Page } from '@playwright/test'

function wav() {
  const bytes = 8000 * 2 * 60; const data = Buffer.alloc(44 + bytes)
  data.write('RIFF', 0); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40)
  return data
}
async function setup(page: Page, missing = false) {
  const sessions = ['Alpha practice', 'Beta session'].map((title, n) => ({ id: `mix-${n}`, title, directoryPath: 'D:/Mixes/WISP Recordings/test',
    endpointId: 'input', deviceName: 'Xone', sampleRate: 44100, startedAt: `2026-09-${13 - n}T12:00:00Z`, state: 'Ready', audioBytes: 44100 * 8 * 60, issue: null, previousTakeId: null, relinkedPath: null }))
  const reviews: Record<string, { revision: number; rating: number | null; markers: { id: string; seconds: number; label: string }[] }> = {
    'mix-0': { revision: 0, rating: null, markers: [] }, 'mix-1': { revision: 0, rating: 4, markers: [] },
  }
  let job: { id: string; recordingId: string; kind: string; state: string; progress: number; error: string | null } | null = null
  let live = false, failReview = false
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
  return { reviews, startLive: () => { live = true }, failReview: () => { failReview = true } }
}

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
