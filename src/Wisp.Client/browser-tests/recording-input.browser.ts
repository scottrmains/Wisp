import { expect, test, type Page } from '@playwright/test'

function floatWav() {
  const frames = 8000, bytes = frames * 8
  const wav = Buffer.alloc(44 + bytes)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(64000, 28); wav.writeUInt16LE(8, 32)
  wav.writeUInt16LE(32, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40)
  for (let i = 0; i < frames; i++) {
    wav.writeFloatLE(Math.sin(i / 8) * 0.1, 44 + i * 8)
    wav.writeFloatLE(Math.sin(i / 12) * 0.1, 48 + i * 8)
  }
  return wav
}

async function setup(page: Page, saved: string | null = null) {
  let state = { id: null as string | null, state: 'Idle', seconds: 0,
    deviceName: 'Input 1 (Xone:24C)', endpointId: 'input-1', mixFormat: 'Float 44100Hz stereo',
    sampleRate: 44100, leftPeak: 0, rightPeak: 0, leftClipped: false, rightClipped: false,
    hasAudio: false, message: null as string | null, audioPath: 'isolated/recording-input-tests/test.wav',
    windowsVersion: 'Windows test fixture', assessment: null as string | null }
  const starts: { endpointId: string; requestId: string }[] = []
  let rejectStart = false
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/recording-input/devices') return route.fulfill({ json: {
      selectedEndpointId: saved, devices: [{ id: 'input-1', name: 'Input 1 (Xone:24C)',
        mixFormat: 'Float 44100Hz stereo', sampleRate: 44100, channels: 2, canTest: true, unavailableReason: null }],
    } })
    if (path.endsWith('/stop')) { state = { ...state, state: 'Ready', hasAudio: true, seconds: 12, leftPeak: 0, rightPeak: 0 }; return route.fulfill({ json: state }) }
    if (path.endsWith('/assessment')) { state.assessment = route.request().postDataJSON().notes as string; return route.fulfill({ json: state }) }
    if (path.endsWith('/audio')) return route.fulfill({ contentType: 'audio/wav', body: floatWav() })
    if (path === '/api/recording-input/test') {
      if (route.request().method() === 'POST') {
        if (rejectStart) return route.fulfill({ status: 409, json: { message: 'Selected input disconnected. Reconnect it and refresh inputs.' } })
        const body = route.request().postDataJSON() as { endpointId: string; requestId: string }
        starts.push(body)
        state = { ...state, id: body.requestId, state: 'Recording', seconds: 3, leftPeak: 0.5, rightPeak: 0.25 }
      }
      return route.fulfill({ json: state })
    }
    if (path === '/api/tracks') return route.fulfill({ json: { items: [], total: 0, page: 1, size: 500 } })
    await route.fulfill({ json: [] })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Recordings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Test your recording input' })).toBeVisible()
  return { starts, reject: () => { rejectStart = true }, clip: () => { state.leftClipped = true },
    disconnect: () => { state = { ...state, state: 'Failed', message: 'The input stopped unexpectedly.', hasAudio: true } } }
}

test('explicit input, stereo meters, stop, float WAV playback and saved observations', async ({ page }, info) => {
  const fixture = await setup(page)
  const record = page.getByRole('button', { name: 'Record 30-second test', exact: true })
  await expect(record).toBeDisabled(); expect(fixture.starts).toEqual([])
  await page.getByLabel('Stereo recording input').selectOption('input-1')
  await record.click()
  await expect(page.getByRole('meter', { name: 'Left input level' })).toHaveAttribute('aria-valuenow', /-6/)
  await expect(page.getByRole('meter', { name: 'Right input level' })).toHaveAttribute('aria-valuenow', /-12/)
  await expect(record).toBeDisabled()
  await page.getByRole('button', { name: 'Stop test', exact: true }).click()
  await expect(page.getByLabel('Input test playback')).toBeVisible()
  await expect.poll(() => page.getByLabel('Input test playback').evaluate(el => (el as HTMLAudioElement).duration)).toBe(1)
  await page.getByLabel('Routing observations', { exact: true }).fill('STREAM, both decks and faders heard. Stereo verified using test source.')
  await page.getByRole('button', { name: 'Save observations' }).click()
  await expect(page.getByText(/Observations saved with this test/)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Routing observations', { exact: true })).toHaveValue(/both decks/)
  await page.setViewportSize({ width: 800, height: 600 })
  await page.getByRole('heading', { name: 'Test your recording input' }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('input-test-800.png') })
})

test('route changes and reload reconnect without starting another capture', async ({ page }) => {
  const fixture = await setup(page, 'input-1')
  await page.getByRole('button', { name: 'Record 30-second test', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.getByRole('button', { name: /Input test — Recording/ })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Input test — Recording/ }).click()
  await expect(page.getByRole('button', { name: 'Stop test', exact: true })).toBeEnabled()
  expect(fixture.starts).toHaveLength(1)
})

test('saved missing input never silently selects another device', async ({ page }) => {
  const fixture = await setup(page, 'disconnected-id')
  await expect(page.getByLabel('Stereo recording input')).toHaveValue('disconnected-id')
  await expect(page.getByRole('button', { name: 'Record 30-second test', exact: true })).toBeDisabled()
  expect(fixture.starts).toEqual([])
  await page.getByLabel('Stereo recording input').selectOption('input-1')
  fixture.reject()
  await page.getByRole('button', { name: 'Record 30-second test', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('disconnected')
})

test('clipping and interrupted capture are distinct from successful routing evidence', async ({ page }) => {
  const fixture = await setup(page, 'input-1')
  await page.getByRole('button', { name: 'Record 30-second test', exact: true }).click()
  fixture.clip()
  await expect(page.getByText('CLIPPED', { exact: true })).toBeVisible()
  fixture.disconnect()
  await expect(page.getByRole('alert')).toContainText('stopped unexpectedly')
  await expect(page.getByLabel('Input test playback')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save observations' })).toHaveCount(0)
})
