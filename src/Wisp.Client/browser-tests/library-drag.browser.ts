import { expect, test, type Page } from '@playwright/test'

// The frontend is real. Library data and the native bridge are isolated mocks;
// these regressions do not claim that a real Explorer/rekordbox drop took place.
const tracks = Array.from({ length: 1205 }, (_, i) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  filePath: `D:\\Music\\Track ${i}.aiff`, fileName: `Track ${i}.aiff`,
  title: `Track ${String(i).padStart(4, '0')}`, artist: 'Test artist',
  durationSeconds: 30, bpm: 128, musicalKey: '8A', isUnavailable: false, isArchived: false,
}))

interface DragTestState {
  calls: string[][]
  response: { error?: string; result?: { dropAccepted: boolean; fileCount: number; reason?: string } }
  delay: number
}
declare global { interface Window { dragTest: DragTestState } }

async function setup(page: Page, supported = true, capabilityError?: string) {
  await page.addInitScript(({ supported, capabilityError }) => {
    let receiver: (raw: string) => void
    window.dragTest = { calls: [], response: {}, delay: 50 }
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (cb: typeof receiver) => { receiver = cb },
      sendMessage: (raw: string) => {
        const request = JSON.parse(raw)
        const drag = request.method === 'dragFiles'
        if (drag) window.dragTest.calls.push(request.args.trackIds)
        const response = drag ? window.dragTest.response
          : { error: capabilityError, result: { externalFileDrag: supported, maxDragTracks: 20000 } }
        setTimeout(() => receiver(JSON.stringify({ id: request.id,
          result: drag ? { dropAccepted: true, fileCount: request.args.trackIds.length } : null,
          ...response,
        })), drag ? window.dragTest.delay : 0)
      },
    } })
  }, { supported, capabilityError })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = []
    if (url.pathname === '/api/playlists') body = [{ id: 'test-playlist', name: 'Test playlist', trackCount: tracks.length }]
    if (url.pathname === '/api/tracks') {
      const size = Number(url.searchParams.get('size') ?? 500), page = Number(url.searchParams.get('page') ?? 1)
      body = { items: tracks.slice((page - 1) * size, page * size), total: tracks.length, size, page }
    }
    if (url.pathname === '/api/settings/soulseek') body = { isConfigured: false }
    await route.fulfill({ json: body })
  })
  await page.goto('/')
  await page.getByText('Test playlist', { exact: true }).first().click()
  await page.getByText('Track 0000', { exact: true }).waitFor()
}

async function selectAll(page: Page) {
  await page.getByText('Track 0000', { exact: true }).click()
  await page.keyboard.press('Control+a')
  await expect(page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' })).toBeEnabled()
}

async function rowDrag(page: Page, title = 'Track 0000') {
  const box = await page.getByText(title, { exact: true }).boundingBox()
  if (!box) throw new Error('Track row is not visible')
  await page.mouse.move(box.x + 10, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 50, box.y + 12, { steps: 5 })
}

test('Ctrl+A then a real row drag hands off ALL pages with the actual Photino user agent', async ({ page }) => {
  await setup(page); await selectAll(page)
  await expect(page.getByLabel('Track row drag destination')).toHaveValue('external')
  await rowDrag(page)
  await expect.poll(() => page.evaluate(() => window.dragTest.calls.length)).toBe(1)
  await page.mouse.up()
  expect(await page.evaluate(() => window.dragTest.calls[0])).toEqual(tracks.map(t => t.id))
  await expect(page.getByRole('status')).toContainText('1205 files handed')
  await expect(page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' })).toBeEnabled()
  await page.getByRole('button', { name: 'Next page' }).click()
  await rowDrag(page, 'Track 0500')
  await expect.poll(() => page.evaluate(() => window.dragTest.calls.length)).toBe(2)
  await page.mouse.up()
  expect(await page.evaluate(() => window.dragTest.calls[1])).toEqual(tracks.map(t => t.id))
})

test('Within WISP retains the internal multi-row payload without invoking native drag', async ({ page }) => {
  await setup(page); await selectAll(page)
  await page.getByLabel('Track row drag destination').selectOption('wisp')
  const payload = await page.getByText('Track 0000', { exact: true }).evaluate(el => {
    const dataTransfer = new DataTransfer()
    el.closest('[draggable]')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    return { ids: JSON.parse(dataTransfer.getData('application/x-wisp-track-ids')), types: dataTransfer.types }
  })
  expect(payload.ids).toEqual(tracks.map(t => t.id))
  expect(payload.types).toEqual(['application/x-wisp-track-ids'])
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([])
})

test('Dedicated handle and row drags share a single in-flight operation', async ({ page }) => {
  await setup(page); await selectAll(page)
  await page.evaluate(() => { window.dragTest.delay = 1000 })
  const box = await page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' }).boundingBox()
  await page.mouse.move(box!.x + 10, box!.y + 10); await page.mouse.down()
  await page.mouse.move(box!.x + 40, box!.y + 10, { steps: 4 })
  await expect.poll(() => page.evaluate(() => window.dragTest.calls.length)).toBe(1)
  await page.getByText('Track 0000', { exact: true }).dispatchEvent('dragstart')
  expect(await page.evaluate(() => window.dragTest.calls.length)).toBe(1)
  await page.mouse.up()
  await expect(page.getByRole('status')).toContainText('1205 files handed')
})

test('Missing-file error is visible and the full selection can be retried', async ({ page }) => {
  await setup(page); await selectAll(page)
  await page.evaluate(() => { window.dragTest.response = { error: '1 selected file is missing. No files were sent.' } })
  await rowDrag(page)
  await expect(page.getByRole('alert')).toContainText('No files were sent')
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' })).toBeEnabled()
  await page.evaluate(() => { window.dragTest.response = {} })
  await rowDrag(page)
  await expect(page.getByRole('status')).toContainText('1205 files handed')
  await page.mouse.up()
})

test('Early mouse release is explained without claiming files were sent', async ({ page }) => {
  await setup(page); await selectAll(page)
  await page.evaluate(() => { window.dragTest.response = { result: { dropAccepted: false, fileCount: 1205, reason: 'released-before-start' } } })
  await rowDrag(page)
  await expect(page.getByRole('status')).toContainText('Released before the files were ready')
  await page.mouse.up()
})

test('Host capabilities, not browser identity, determine Windows support', async ({ page }) => {
  await setup(page, false)
  await page.getByText('Track 0000', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Drag 1 audio files to rekordbox' })).toBeDisabled()
  await expect(page.getByLabel('Track row drag destination')).toHaveCount(0)
})

test('Capability errors tell the user to restart the updated desktop app', async ({ page }) => {
  await setup(page, false, 'Unknown bridge method desktopCapabilities')
  await expect(page.getByRole('alert')).toContainText('Restart WISP after updating')
})
