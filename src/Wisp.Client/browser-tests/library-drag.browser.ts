import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

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
  unifiedCalls: boolean[]
  response: { error?: string; result?: { dropAccepted: boolean; fileCount: number; reason?: string } }
  delay: number
}
declare global { interface Window { dragTest: DragTestState } }

async function setup(page: Page, supported = true, capabilityError?: string, unified = false) {
  const additions: string[][] = []
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await page.addInitScript(({ supported, capabilityError, unified }) => {
    let receiver: (raw: string) => void
    window.dragTest = { calls: [], unifiedCalls: [], response: {}, delay: 50 }
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (cb: typeof receiver) => { receiver = cb },
      sendMessage: (raw: string) => {
        const request = JSON.parse(raw)
        const drag = request.method === 'dragFiles'
        if (drag) {
          window.dragTest.calls.push(request.args.trackIds)
          window.dragTest.unifiedCalls.push(request.args.includeTrackIds === true)
        }
        const response = drag ? window.dragTest.response
          : { error: capabilityError, result: { externalFileDrag: supported, unifiedTrackDrag: unified, maxDragTracks: 20000 } }
        setTimeout(() => receiver(JSON.stringify({ id: request.id,
          result: drag ? { dropAccepted: true, fileCount: request.args.trackIds.length } : null,
          ...response,
        })), drag ? window.dragTest.delay : 0)
      },
    } })
  }, { supported, capabilityError, unified })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let body: unknown = []
    if (url.pathname === '/api/playlists') body = [
      { id: 'test-playlist', name: 'Test playlist', trackCount: tracks.length },
      { id: 'drop-playlist', name: 'Drop playlist', trackCount: additions.flat().length },
    ]
    if (url.pathname === '/api/playlists/drop-playlist/tracks/bulk') {
      const { trackIds } = route.request().postDataJSON() as { trackIds: string[] }
      additions.push(trackIds)
      body = { added: trackIds.length, skipped: 0 }
    }
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
  return { additions, downloads }
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

async function dropOnPlaylist(page: Page) {
  const target = page.getByText('Drop playlist', { exact: true })
  await target.hover()
  // Two moves ensure Chromium sends dragover before releasing the mouse.
  await target.hover()
  await page.mouse.up()
}

async function handleDrag(page: Page) {
  const box = await page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' }).boundingBox()
  if (!box) throw new Error('File drag handle is not visible')
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 40, box.y + 10, { steps: 4 })
}

test('Ctrl+A then real row drops add ALL pages to WISP, never native files or downloads', async ({ page }) => {
  const { additions, downloads } = await setup(page); await selectAll(page)
  await expect(page.getByLabel('Track row drag destination')).toHaveCount(0)
  await rowDrag(page)
  await dropOnPlaylist(page)
  await expect.poll(() => additions.length).toBe(1)
  expect(additions[0]).toEqual(tracks.map(t => t.id))
  await expect(page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' })).toBeEnabled()
  await page.getByRole('button', { name: 'Next page' }).click()
  await rowDrag(page, 'Track 0500')
  await dropOnPlaylist(page)
  await expect.poll(() => additions.length).toBe(2)
  expect(additions[1]).toEqual(tracks.map(t => t.id))
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([])
  expect(downloads).toEqual([])
  await expect(page).toHaveURL('http://127.0.0.1:19589/')
})

test('Rows offer only WISP IDs, never file URLs or a DownloadURL', async ({ page }) => {
  await setup(page); await selectAll(page)
  const payload = await page.getByText('Track 0000', { exact: true }).evaluate(el => {
    const dataTransfer = new DataTransfer()
    el.closest('[draggable]')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    return { ids: JSON.parse(dataTransfer.getData('application/x-wisp-track-ids')), types: dataTransfer.types }
  })
  expect(payload.ids).toEqual(tracks.map(t => t.id))
  expect(payload.types).toEqual(['application/x-wisp-track-ids'])
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([])
})

test('Unselected row drags only that track, without a mode switch', async ({ page }) => {
  const { additions, downloads } = await setup(page)
  await page.getByText('Track 0000', { exact: true }).click()
  await rowDrag(page, 'Track 0001')
  await dropOnPlaylist(page)
  await expect.poll(() => additions).toEqual([[tracks[1].id]])
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([])
  expect(downloads).toEqual([])
})

test('Dedicated external handle sends ALL pages and prevents duplicate handoffs while busy', async ({ page }) => {
  const { additions } = await setup(page); await selectAll(page)
  await page.evaluate(() => { window.dragTest.delay = 1000 })
  await handleDrag(page)
  await expect.poll(() => page.evaluate(() => window.dragTest.calls.length)).toBe(1)
  const handle = page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' })
  await expect(handle).toBeDisabled()
  await handle.dispatchEvent('pointerdown', { button: 0, buttons: 1, clientX: 10, clientY: 10 })
  await handle.dispatchEvent('pointermove', { buttons: 1, clientX: 40, clientY: 10 })
  await page.mouse.up()
  await expect(page.getByRole('status')).toContainText('1205 files handed')
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([tracks.map(t => t.id)])
  expect(additions).toEqual([])
  await expect(handle).toBeEnabled()
})

test('Missing-file error is visible and the full selection can be retried', async ({ page }) => {
  await setup(page); await selectAll(page)
  await page.evaluate(() => { window.dragTest.response = { error: '1 selected file is missing. No files were sent.' } })
  await handleDrag(page)
  await expect(page.getByRole('alert')).toContainText('No files were sent')
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Drag 1205 audio files to rekordbox' })).toBeEnabled()
  await page.evaluate(() => { window.dragTest.response = {} })
  await handleDrag(page)
  await expect(page.getByRole('status')).toContainText('1205 files handed')
  await page.mouse.up()
})

test('Early mouse release is explained without claiming files were sent', async ({ page }) => {
  await setup(page); await selectAll(page)
  await page.evaluate(() => { window.dragTest.response = { result: { dropAccepted: false, fileCount: 1205, reason: 'released-before-start' } } })
  await handleDrag(page)
  await expect(page.getByRole('status')).toContainText('Released before the files were ready')
  await page.mouse.up()
})

test('Host capabilities, not browser identity, determine Windows support', async ({ page }) => {
  const { additions } = await setup(page, false)
  await page.getByText('Track 0000', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Drag 1 audio files to rekordbox' })).toBeDisabled()
  await expect(page.getByLabel('Track row drag destination')).toHaveCount(0)
  await rowDrag(page)
  await dropOnPlaylist(page)
  await expect.poll(() => additions).toEqual([[tracks[0].id]])
})

test('Stray files and URLs dropped inside WISP are rejected without import or browser navigation', async ({ page }) => {
  const { additions, downloads } = await setup(page)
  for (const kind of ['file', 'url']) {
    const result = await page.getByText('Drop playlist', { exact: true }).evaluate((el, kind) => {
      const dataTransfer = new DataTransfer()
      if (kind === 'file') dataTransfer.items.add(new File(['audio fixture'], 'Track.aiff', { type: 'audio/aiff' }))
      else dataTransfer.setData('text/uri-list', 'https://example.invalid/Track.aiff')
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
      el.dispatchEvent(over)
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
      el.dispatchEvent(drop)
      return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented, effect: dataTransfer.dropEffect }
    }, kind)
    expect(result).toEqual({ overPrevented: true, dropPrevented: true, effect: 'none' })
  }
  expect(additions).toEqual([])
  expect(downloads).toEqual([])
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([])
  await expect(page).toHaveURL('http://127.0.0.1:19589/')
})

test('Capability errors tell the user to restart the updated desktop app', async ({ page }) => {
  await setup(page, false, 'Unknown bridge method desktopCapabilities')
  await expect(page.getByRole('alert')).toContainText('Restart WISP after updating')
})

// Simulate the WebView2 destination half of the *same* Windows drag, with both
// MIME IDs and Files. Native COM payload bytes are tested in LibraryFileDragTests.
// This does not simulate an actual rekordbox import or a native OLE message loop.
async function unifiedDrop(page: Page, withFiles = true) {
  const box = await page.getByText('Drop playlist', { exact: true }).boundingBox()
  const ids = await page.evaluate(() => window.dragTest.calls.at(-1)!)
  const session = await page.context().newCDPSession(page)
  // Use Chromium's real drag destination pipeline (not dispatchEvent). The
  // fixture offers this test file's path; its contents are never imported.
  const data = { items: [{ mimeType: 'application/x-wisp-track-ids', data: JSON.stringify(ids) }],
    files: withFiles ? [fileURLToPath(import.meta.url)] : [], dragOperationsMask: 1 }
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop'])
      await session.send('Input.dispatchDragEvent', { type, x: box!.x + 10, y: box!.y + 8, data })
  } finally { await session.detach() }
}

test('Modern Windows rows start one dual-format drag; the same payload is accepted inside WISP across all pages', async ({ page }) => {
  const { additions, downloads } = await setup(page, true, undefined, true)
  await selectAll(page)
  await expect(page.getByText('Drag rows to WISP playlists, rekordbox or folders', { exact: true })).toBeVisible()
  await page.evaluate(() => { window.dragTest.delay = 1000 })
  await rowDrag(page)
  await expect.poll(() => page.evaluate(() => window.dragTest.calls.length)).toBe(1)
  expect(await page.evaluate(() => window.dragTest.unifiedCalls)).toEqual([true])
  await unifiedDrop(page)
  await page.mouse.up()
  await expect.poll(() => additions).toEqual([tracks.map(t => t.id)])
  await expect(page.getByRole('status')).toContainText('Track selection dropped')
  await selectAll(page)
  await page.getByRole('button', { name: 'Next page' }).click()
  await rowDrag(page, 'Track 0500')
  await expect.poll(() => page.evaluate(() => window.dragTest.calls.length)).toBe(2)
  await unifiedDrop(page)
  await page.mouse.up()
  await expect.poll(() => additions.length).toBe(2)
  expect(additions[1]).toEqual(tracks.map(t => t.id))
  expect(downloads).toEqual([])
  await expect(page).toHaveURL('http://127.0.0.1:19589/')
})

test('Modern Windows row dragging supports external handoff without using the dedicated handle', async ({ page }) => {
  const { additions, downloads } = await setup(page, true, undefined, true)
  await selectAll(page)
  await rowDrag(page)
  await expect(page.getByRole('status')).toContainText('Track selection dropped')
  await page.mouse.up()
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([tracks.map(t => t.id)])
  expect(await page.evaluate(() => window.dragTest.unifiedCalls)).toEqual([true])
  expect(additions).toEqual([]); expect(downloads).toEqual([])
})

test('Modern Windows unselected row uses only that track and failures retain a retry path', async ({ page }) => {
  await setup(page, true, undefined, true)
  await page.getByText('Track 0000', { exact: true }).click()
  await page.evaluate(() => { window.dragTest.response = { error: 'Drive unavailable. No files were sent.' } })
  await rowDrag(page, 'Track 0001')
  await expect(page.getByRole('alert')).toContainText('No files were sent')
  await page.mouse.up()
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([[tracks[1].id]])
  await page.evaluate(() => { window.dragTest.response = {} })
  await rowDrag(page, 'Track 0001')
  await expect(page.getByRole('status')).toContainText('Track selection dropped')
  await page.mouse.up()
  expect(await page.evaluate(() => window.dragTest.calls)).toEqual([[tracks[1].id], [tracks[1].id]])
})

test('Missing files still allow internal organisation without claiming a partial external export', async ({ page }) => {
  const { additions, downloads } = await setup(page, true, undefined, true)
  await selectAll(page)
  await page.evaluate(() => { window.dragTest.response = { result: { dropAccepted: true, fileCount: 0, reason: 'internal-only-missing-files' } } })
  await rowDrag(page)
  await expect.poll(() => page.evaluate(() => window.dragTest.calls.length)).toBe(1)
  await unifiedDrop(page, false)
  await page.mouse.up()
  await expect.poll(() => additions).toEqual([tracks.map(t => t.id)])
  await expect(page.getByRole('status')).toContainText('Some audio files are missing')
  expect(downloads).toEqual([])
})

test('Modern Windows Escape/early-release result does not add tracks or report success', async ({ page }) => {
  const { additions } = await setup(page, true, undefined, true)
  await selectAll(page)
  await page.evaluate(() => { window.dragTest.response = { result: { dropAccepted: false, fileCount: 1205 } } })
  await rowDrag(page)
  await expect(page.getByRole('status')).toContainText('No files were accepted')
  await page.mouse.up()
  expect(additions).toEqual([])
  await page.evaluate(() => { window.dragTest.response = { result: { dropAccepted: false, fileCount: 1205, reason: 'released-before-start' } } })
  await rowDrag(page)
  await expect(page.getByRole('status')).toContainText('Released before the files were ready')
  await page.mouse.up()
  expect(additions).toEqual([])
})
