import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page, interrupted = false, repeatCloseOnCancel = false) {
  let session = { id: '11111111-1111-1111-1111-111111111111', title: 'Practice mix', directoryPath: 'D:/Music/WISP Recordings/take',
    endpointId: 'input-1', deviceName: 'Input 1 (Xone:24C)', sampleRate: 44100, startedAt: '2026-09-13T12:00:00Z',
    state: interrupted ? 'Recoverable' : 'Ready', audioBytes: 44100 * 8 * 60, issue: interrupted ? 'WISP closed before saving finished.' : null as string | null,
    previousTakeId: null as string | null, relinkedPath: null }
  let busy = false, exists = interrupted, closeRequested = false, startError = false
  const starts: Record<string, unknown>[] = []
  const removals: Record<string, unknown>[] = []
  await page.addInitScript(() => {
    let reply: ((raw: string) => void) | null = null
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (handler: (raw: string) => void) => { reply = handler },
      sendMessage: (raw: string) => {
        const req = JSON.parse(raw) as { id: string; method: string }
        if (req.method === 'closeAfterRecording') document.documentElement.dataset.closed = 'true'
        const result = req.method === 'pickFolder' ? { path: 'D:/Music' } : { ok: true }
        reply?.(JSON.stringify({ id: req.id, result }))
      },
    } })
  })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/recording-input/devices') return route.fulfill({ json: { selectedEndpointId: 'input-1', devices: [
      { id: 'input-1', name: 'Input 1 (Xone:24C)', mixFormat: 'Float 44100 Hz stereo', channels: 2, sampleRate: 44100, canTest: true },
    ] } })
    if (path === '/api/recording-input/test') return route.fulfill({ json: { id: null, state: 'Idle', seconds: 0, leftPeak: 0, rightPeak: 0 } })
    if (path === '/api/recordings/settings') return route.fulfill({ json: { folder: 'D:/Music' } })
    if (path === '/api/recordings/status') return route.fulfill({ json: { session: exists ? session : null, busy, seconds: 60,
      savedSeconds: 59, leftPeak: .3, rightPeak: .5, clipped: false, remainingSeconds: 7200, closeRequested } })
    if (path === '/api/recordings/') return route.fulfill({ json: exists ? [session] : [] })
    if (path === '/api/recordings/start') {
      if (startError) return route.fulfill({ status: 422, json: { message: 'Use an NTFS or exFAT recording destination.' } })
      const body = route.request().postDataJSON() as Record<string, unknown>; starts.push(body)
      session = { ...session, id: body.requestId as string, title: body.title as string, state: 'Recording', previousTakeId: body.previousTakeId as string | null }
      busy = true; exists = true; return route.fulfill({ json: session })
    }
    if (path.endsWith('/stop')) { busy = false; session.state = 'Ready'; return route.fulfill({ json: {} }) }
    if (path.endsWith('/recover')) { session.state = 'Ready'; session.issue = 'Recovered interrupted take.'; return route.fulfill({ status: 204 }) }
    if (path.endsWith('/keep-recording')) { closeRequested = repeatCloseOnCancel; return route.fulfill({ status: 204 }) }
    if (path.endsWith('/remove')) { removals.push(route.request().postDataJSON() as Record<string, unknown>); exists = false; return route.fulfill({ status: 204 }) }
    if (path === '/api/tracks') return route.fulfill({ json: { items: [], total: 0, page: 1, size: 500 } })
    return route.fulfill({ json: [] })
  })
  await page.goto('/'); await page.getByRole('button', { name: 'Recordings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Record a mix', exact: true })).toBeVisible()
  return { starts, removals, requestClose: () => { closeRequested = true }, failStart: () => { startError = true } }
}

test('full recording survives navigation/reload and input tests stay disabled until stopped', async ({ page }, info) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Start mix recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Record 30-second test', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Stop test', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.getByRole('button', { name: /● Mix recording/ })).toBeVisible()
  await page.reload(); await page.getByRole('button', { name: /● Mix recording/ }).click()
  expect(fixture.starts).toHaveLength(1)
  await page.setViewportSize({ width: 800, height: 600 })
  await page.getByRole('button', { name: 'Stop and save mix', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('mix-recording-800.png') })
  await page.getByRole('button', { name: 'Stop and save mix', exact: true }).click()
  await expect(page.getByRole('button', { name: /● Mix recording/ })).toHaveCount(0)
})

test('recover interrupted take, then explicitly start a separate linked take', async ({ page }) => {
  const fixture = await setup(page, true)
  await page.getByRole('button', { name: 'Recover saved audio' }).click()
  await expect(page.getByLabel('Mix recording status').getByText('Recovered interrupted take.', { exact: true })).toBeVisible()
  const takes = page.getByText('Saved takes and recovery', { exact: true }).locator('..')
  if (await takes.getAttribute('open') === null) await takes.locator('summary').click()
  await page.getByRole('button', { name: 'New linked take', exact: true }).click()
  await page.getByRole('button', { name: 'Start mix recording', exact: true }).click()
  expect(fixture.starts[0].previousTakeId).toBe('11111111-1111-1111-1111-111111111111')
  expect(fixture.starts[0].requestId).not.toBe(fixture.starts[0].previousTakeId)
})

test('native close confirmation can keep recording or stop-save before closing', async ({ page }) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Start mix recording', exact: true }).click()
  fixture.requestClose()
  let dialog = page.getByRole('dialog', { name: 'Recording is still active' })
  const closeCancelled = page.waitForResponse(async response => response.url().endsWith('/api/recordings/status') && !(await response.json()).closeRequested)
  await dialog.getByRole('button', { name: 'Keep recording', exact: true }).click()
  await expect(page.getByRole('button', { name: /● Mix recording/ })).toBeVisible()
  // Allow the status poll to observe the cancelled close before another attempt.
  await closeCancelled
  fixture.requestClose()
  dialog = page.getByRole('dialog', { name: 'Recording is still active' })
  await dialog.getByRole('button', { name: 'Stop and save', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-closed', 'true')
})

test('destination failure is actionable and does not show an active recording', async ({ page }) => {
  const fixture = await setup(page); fixture.failStart()
  await page.getByRole('button', { name: 'Start mix recording', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('NTFS or exFAT')
  await expect(page.getByRole('button', { name: /● Mix recording/ })).toHaveCount(0)
})

test('a second native close between status polls still opens a confirmation', async ({ page }) => {
  const fixture = await setup(page, false, true)
  await page.getByRole('button', { name: 'Start mix recording', exact: true }).click()
  fixture.requestClose()
  const dialog = page.getByRole('dialog', { name: 'Recording is still active' })
  await dialog.getByRole('button', { name: 'Keep recording', exact: true }).click()
  // The server receives another close before any poll observes false. The UI
  // must recheck unchanged status, without restarting or stopping the capture.
  await dialog.getByRole('button', { name: 'Stop and save', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-closed', 'true')
  expect(fixture.starts).toHaveLength(1)
})

test('entry removal and audio deletion use distinct explicit confirmations', async ({ page }) => {
  const fixture = await setup(page, true)
  await page.getByRole('button', { name: 'Recover saved audio' }).click()
  await expect(page.getByLabel('Mix recording status').getByText('Recovered interrupted take.', { exact: true })).toBeVisible()
  const takes = page.getByText('Saved takes and recovery', { exact: true }).locator('..')
  if (await takes.getAttribute('open') === null) await takes.locator('summary').click()
  await page.getByRole('button', { name: 'Delete managed audio', exact: true }).click()
  const deletion = page.getByRole('dialog', { name: 'Permanently delete managed audio?' })
  await expect(deletion).toContainText('cannot be undone')
  await deletion.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(fixture.removals).toHaveLength(0)
  await page.getByRole('button', { name: 'Remove entry', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remove this entry?' }).getByRole('button', { name: 'Remove entry', exact: true }).click()
  expect(fixture.removals).toEqual([{ deleteAudio: false, confirmed: true }])
})
