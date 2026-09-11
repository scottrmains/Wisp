import { expect, test, type Page } from '@playwright/test'

const library = ['Alpha', 'Beta'].map((title, i) => ({
  id: `track-${i}`, title, artist: 'Test artist', filePath: `D:\\Music\\${title}.aiff`, fileName: `${title}.aiff`,
  durationSeconds: 60, bpm: 128, musicalKey: '8A', isUnavailable: false, isArchived: false,
}))

async function setup(page: Page, entryCount = 3) {
  const entries: Record<string, { playlistEntryId: string; id: string }[]> = {
    first: Array.from({ length: entryCount }, (_, i) => ({ playlistEntryId: `entry-${i}`, id: i === 2 ? 'track-1' : 'track-0' })),
    other: [{ playlistEntryId: 'other-entry', id: 'track-0' }],
  }
  const requests: { path: string; body: Record<string, unknown> }[] = []
  let removeFails = false, sequence = 0
  await page.addInitScript(() => {
    let receive: (raw: string) => void
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (callback: typeof receive) => { receive = callback },
      sendMessage: (raw: string) => {
        const request = JSON.parse(raw)
        setTimeout(() => receive(JSON.stringify({ id: request.id, result: { externalFileDrag: true, maxDragTracks: 20000 } })), 0)
      },
    } })
  })
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url())
    const body = req.postDataJSON() as Record<string, unknown> | null
    if (req.method() !== 'GET') requests.push({ path: url.pathname, body: body ?? {} })
    const playlist = url.pathname.split('/')[3]
    if (url.pathname.endsWith('/entries/remove')) {
      if (removeFails) return route.fulfill({ status: 500, json: { message: 'Could not save playlist. Try again.' } })
      const before = entries[playlist].length
      entries[playlist] = entries[playlist].filter(t => !(body!.entryIds as string[]).includes(t.playlistEntryId))
      return route.fulfill({ json: { removed: before - entries[playlist].length } })
    }
    if (url.pathname.endsWith('/tracks/bulk')) {
      const ids = body!.trackIds as string[], mode = body!.duplicateHandling ?? 'ask'
      const existing = new Set(entries[playlist].map(t => t.id))
      if (mode === 'ask' && ids.some(id => existing.has(id)))
        return route.fulfill({ status: 409, json: { code: 'playlist_duplicates', message: '1 selected track already exists in this playlist. Nothing has been added yet.' } })
      const add = ids.filter(id => mode === 'add' || !existing.has(id))
      entries[playlist].push(...add.map(id => ({ id, playlistEntryId: `new-${++sequence}` })))
      return route.fulfill({ json: { added: add.length, skipped: ids.length - add.length } })
    }
    let response: unknown = []
    if (url.pathname === '/api/playlists') response = [
      { id: 'first', name: 'First playlist', trackCount: entries.first.length },
      { id: 'other', name: 'Other playlist', trackCount: entries.other.length },
    ]
    if (url.pathname === '/api/tracks') {
      const scope = url.searchParams.get('playlistId'), size = Number(url.searchParams.get('size') ?? 500), number = Number(url.searchParams.get('page') ?? 1)
      const rows = scope ? entries[scope].map(entry => ({ ...library.find(t => t.id === entry.id), ...entry })) : library
      response = { items: rows.slice((number - 1) * size, number * size), total: rows.length, page: number, size }
    }
    if (/\/api\/tracks\/track-\d+$/.test(url.pathname)) response = library.find(t => url.pathname.endsWith(t.id))
    if (url.pathname.endsWith('/audio')) {
      const wav = Buffer.alloc(480044, 128)
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34)
      wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
      return route.fulfill({ contentType: 'audio/wav', body: wav })
    }
    if (url.pathname === '/api/settings/soulseek') response = { isConfigured: false }
    return route.fulfill({ json: response })
  })
  await page.goto('/')
  await page.getByText('First playlist', { exact: true }).first().click()
  await page.locator('[data-playlist-entry-id="entry-0"]').waitFor()
  return { entries, requests, failRemove: (value: boolean) => { removeFails = value } }
}

test('remove one repeated entry via the toolbar without stopping playback or removing the library track', async ({ page }) => {
  const state = await setup(page)
  const row = page.locator('[data-playlist-entry-id="entry-0"]')
  await row.getByText('Alpha', { exact: true }).dblclick()
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Remove from playlist…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove from playlist?' })
  await expect(dialog).toContainText('1 selected entry')
  await expect(dialog).toContainText('Your music files, library tracks, cues and other playlists stay unchanged')
  await dialog.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(state.requests.filter(r => r.path.endsWith('/entries/remove')).map(r => r.body.entryIds)).toEqual([['entry-0']])
  await expect(page.locator('[data-playlist-entry-id="entry-1"]')).toBeVisible()
  await expect(page.locator('[data-playlist-entry-id="entry-0"]')).toHaveCount(0)
  expect(state.entries.other).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.locator('[data-track-id="track-0"]')).toHaveCount(1)
})

test('right-click removal can be cancelled and failed saves can be retried', async ({ page }) => {
  const state = await setup(page)
  await page.locator('[data-playlist-entry-id="entry-1"]').click({ button: 'right' })
  await page.getByRole('button', { name: 'Remove from playlist…', exact: true }).last().click()
  let dialog = page.getByRole('dialog', { name: 'Remove from playlist?' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(state.requests).toHaveLength(0)
  await page.getByRole('button', { name: 'Remove from playlist…', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Remove from playlist?' })
  state.failRemove(true)
  await dialog.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Try again')
  expect(state.entries.first).toHaveLength(3)
  state.failRemove(false)
  await dialog.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(state.entries.first.map(t => t.playlistEntryId)).toEqual(['entry-0', 'entry-2'])
})

test('Ctrl+A removes all playlist occurrences across pages, not just unique audio tracks', async ({ page }) => {
  const state = await setup(page, 1002)
  await page.locator('[data-playlist-entry-id="entry-0"]').click()
  await page.keyboard.press('Control+a')
  await expect(page.getByText('1002 tracks selected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.locator('[data-playlist-entry-id="entry-500"]').waitFor()
  await page.getByRole('button', { name: 'Remove from playlist…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove from playlist?' })
  await expect(dialog).toContainText('1002 selected entries')
  await dialog.getByRole('button', { name: 'Remove from playlist', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(state.entries.first).toHaveLength(0)
  expect(state.requests.filter(r => r.path.endsWith('/entries/remove'))[0].body.entryIds).toHaveLength(1002)
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0)
  await expect(page.getByText('1002 playlist entries removed.', { exact: false })).toBeVisible()
})

for (const choice of ['Add again', 'Skip existing', 'Cancel']) {
  test(`duplicate modal from add dialog: ${choice}`, async ({ page }, testInfo) => {
    const state = await setup(page)
    if (choice === 'Add again') await page.setViewportSize({ width: 800, height: 600 })
    await page.locator('[data-playlist-entry-id="entry-0"]').click()
    await page.keyboard.press('Control+a')
    await page.getByRole('button', { name: 'Add to playlist…', exact: true }).click()
    const addDialog = page.getByRole('dialog', { name: 'Add 2 tracks to a playlist' })
    await addDialog.getByRole('button', { name: 'Other playlist', exact: false }).click()
    const duplicate = page.getByRole('dialog', { name: 'Already in this playlist' })
    await expect(duplicate).toBeVisible()
    if (choice === 'Add again') {
      const box = await duplicate.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(800); expect(box!.y + box!.height).toBeLessThanOrEqual(600)
      await page.screenshot({ path: testInfo.outputPath('duplicate-confirmation.png') })
    }
    expect(state.entries.other).toHaveLength(1)
    await duplicate.getByRole('button', { name: choice, exact: true }).click()
    if (choice === 'Cancel') {
      await expect(addDialog).toBeVisible()
      expect(state.requests.filter(r => r.path.endsWith('/tracks/bulk'))).toHaveLength(1)
    } else {
      await expect(addDialog).not.toBeVisible()
      expect(state.entries.other).toHaveLength(choice === 'Add again' ? 3 : 2)
      expect(state.requests.at(-1)!.body.duplicateHandling).toBe(choice === 'Add again' ? 'add' : 'skip')
    }
  })
}

test('dropping on a sidebar playlist uses the same duplicate confirmation', async ({ page }) => {
  const state = await setup(page)
  await page.getByText('Other playlist', { exact: true }).first().evaluate(el => {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-wisp-track-ids', JSON.stringify(['track-0', 'track-1']))
    el.closest('button')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
  const duplicate = page.getByRole('dialog', { name: 'Already in this playlist' })
  await expect(duplicate).toBeVisible()
  expect(state.entries.other).toHaveLength(1)
  await duplicate.getByRole('button', { name: 'Add again', exact: true }).click()
  await expect.poll(() => state.entries.other.length).toBe(3)
})
