import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const library = Array.from({ length: 1205 }, (_, i) => ({
  id: `ui2-${i}`,
  title: i ? `Track ${String(i).padStart(4, '0')}` : 'Moving Through',
  artist: 'Sunday Club',
  filePath: `D:/Demo Music/Track ${i}.wav`,
  fileName: `Track ${i}.wav`,
  durationSeconds: 60,
  bpm: 120,
  musicalKey: '8A',
  energy: 5,
  addedAt: '2026-10-01T00:00:00Z',
  fileModifiedAt: '2026-09-30T00:00:00Z',
  isUnavailable: false,
  isArchived: false,
  notes: null,
}))
async function setup(page: Page) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
  const queries: URL[] = []
  const errors: string[] = []
  let failMemory = false
  const cues = [
    {
      id: 'first',
      trackId: 'ui2-0',
      type: 'FirstBeat',
      timeSeconds: 0,
      label: 'First beat',
      isAutoSuggested: false,
    },
    {
      id: 'drop',
      trackId: 'ui2-0',
      type: 'Drop',
      timeSeconds: 30,
      label: 'Drop',
      isAutoSuggested: false,
    },
  ]
  let memory: {
    id: string
    kind: string
    startSeconds: number
    comment: string
    sourceCuePointId: string
  }[] = []
  const planTracks = library.slice(0, 4).map((track, i) => ({
    id: `plan-track-${i}`,
    track,
    position: i,
    transitionNotes: null,
    isAnchor: false,
  }))
  const wav = Buffer.alloc(480044, 128)
  wav.write('RIFF')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(8000, 28)
  wav.writeUInt16LE(1, 32)
  wav.writeUInt16LE(8, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(wav.length - 44, 40)
  for (let i = 44; i < wav.length; i++)
    wav[i] = 128 + Math.round(Math.sin(i * 0.12) * (25 + (50 * (1 + Math.sin(i / 8000))) / 2))
  await page.addInitScript(() => {
    localStorage.setItem(
      'wisp.activePlan',
      JSON.stringify({ version: 0, state: { activePlanId: 'plan' } }),
    )
    const state = window as unknown as { ui2Audio: HTMLMediaElement[] }
    state.ui2Audio = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (!state.ui2Audio.includes(this)) state.ui2Audio.push(this)
      return play.call(this)
    }
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method()
    if (method !== 'GET')
      calls.push({ path, method, body: request.postData() ? request.postDataJSON() : {} })
    if (path.endsWith('/audio')) {
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/)
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Math.min(wav.length - 1, Number(range[2])) : wav.length - 1
        return route.fulfill({
          status: 206,
          contentType: 'audio/wav',
          headers: {
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${wav.length}`,
          },
          body: wav.subarray(start, end + 1),
        })
      }
      return route.fulfill({
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes' },
        body: wav,
      })
    }
    let body: unknown = []
    if (path === '/api/tracks') {
      queries.push(url)
      const size = Number(url.searchParams.get('size') ?? 500),
        pageNumber = Number(url.searchParams.get('page') ?? 1)
      const search = url.searchParams.get('search')?.toLowerCase()
      const rows = search ? library.filter((t) => t.title.toLowerCase().includes(search)) : library
      body = {
        total: rows.length,
        items: rows.slice((pageNumber - 1) * size, pageNumber * size),
        page: pageNumber,
        size,
      }
    }
    if (/^\/api\/tracks\/ui2-\d+$/.test(path)) body = library.find((t) => path.endsWith(t.id))
    if (path.endsWith('/cues')) {
      if (method === 'POST') {
        const c = { ...cues[0], ...request.postDataJSON(), id: `added-${calls.length}` }
        cues.push(c)
        body = c
      } else body = cues
    }
    if (path.endsWith('/device-cues')) body = memory
    if (path.endsWith('/promote-to-device-cue')) {
      if (failMemory)
        return route.fulfill({
          status: 500,
          json: { message: 'Memory save unavailable. Try again.' },
        })
      const source = cues.find((c) => path.includes(`/cues/${c.id}/`))!
      const c = {
        id: `memory-${source.id}`,
        kind: 'MemoryCue',
        startSeconds: source.timeSeconds,
        comment: source.label,
        sourceCuePointId: source.id,
      }
      memory.push(c)
      body = c
    }
    if (path.startsWith('/api/device-cues/') && method === 'DELETE') {
      memory = memory.filter((c) => !path.endsWith(c.id))
      return route.fulfill({ status: 204 })
    }
    if (path === '/api/mix-plans')
      body = [{ id: 'plan', name: 'Sunday warm-up', trackCount: planTracks.length }]
    if (path === '/api/mix-plans/plan')
      body = { id: 'plan', name: 'Sunday warm-up', tracks: planTracks, notes: null }
    if (path === '/api/mix-plans/plan/tracks' && method === 'POST') {
      const row = {
        ...planTracks[0],
        id: `new-${calls.length}`,
        track: library.find((t) => t.id === request.postDataJSON().trackId)!,
      }
      planTracks.push(row)
      body = row
    }
    if (path.startsWith('/api/mix-plans/plan/tracks/') && method === 'PATCH')
      body = planTracks.find((t) => path.endsWith(t.id))
    if (path === '/api/playlists')
      body = [{ id: 'playlist', name: 'Vinyl selections', trackCount: 12 }]
    if (path === '/api/settings/soulseek') body = { isConfigured: false }
    if (path === '/api/recording-input/test') body = null
    if (path === '/api/recordings/status') body = { busy: false, session: null, seconds: 0 }
    if (path === '/api/transcoder/status') body = { available: false }
    await route.fulfill({ json: body })
  })
  await page.goto('/')
  await expect(page.getByText('Moving Through', { exact: true }).first()).toBeVisible()
  return {
    calls,
    queries,
    errors,
    cues,
    failMemory: (value: boolean) => {
      failMemory = value
    },
  }
}
async function play(page: Page) {
  await page
    .locator('[data-track-id="ui2-0"]')
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect(page.getByLabel('Playback overview')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { ui2Audio: HTMLMediaElement[] }).ui2Audio[0]?.paused,
      ),
    )
    .toBe(false)
}

for (const width of [1024, 1366, 1920]) {
  test(`actual Library layout, playing selection and compact plan at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 })
    const state = await setup(page)
    await play(page)
    const originalRowY = (await page.locator('[data-track-id="ui2-0"]').boundingBox())!.y
    await page.locator('[data-track-id="ui2-0"]').click()
    expect((await page.locator('[data-track-id="ui2-0"]').boundingBox())!.y).toBe(originalRowY)
    await page.keyboard.press('Control+a')
    await expect(page.getByText('1205 tracks selected', { exact: true })).toBeVisible()
    const geometry = await page.locator('[data-library-scroll]').evaluate((el) => {
      const box = el.getBoundingClientRect()
      return {
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
        height: box.height,
        rows: [...el.querySelectorAll('[data-track-id]')].filter((row) => {
          const r = row.getBoundingClientRect()
          return r.top >= box.top + 32 && r.bottom <= box.bottom
        }).length,
        rendered: el.querySelectorAll('[data-track-id]').length,
      }
    })
    expect(geometry.rows).toBeGreaterThanOrEqual(8)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
    expect(geometry.rendered).toBeLessThan(60)
    const table = page.getByRole('table', { name: 'Library tracks', exact: true })
    await expect(table.getByRole('row')).toHaveCount(geometry.rendered + 1)
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveCount(8)
    console.info(JSON.stringify({ viewport: width, browsing: geometry }))
    await expect(page.getByLabel('Track preparation', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Expand chain', exact: true })).toBeVisible()
    await mkdir('../../artifacts/ui-phase-two', { recursive: true })
    await page.screenshot({ path: `../../artifacts/ui-phase-two/library-selected-${width}.png` })
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
    await page.getByRole('button', { name: 'Prepare', exact: true }).click()
    const prep = page.getByLabel('Track preparation', { exact: true })
    await expect(prep.getByLabel('Track cues and details')).toBeVisible()
    await expect(prep.getByRole('slider', { name: 'Seek', exact: true })).toBeVisible()
    console.info(
      JSON.stringify({
        viewport: width,
        preparation: await prep.boundingBox(),
        remainingList: await page.locator('[data-library-scroll]').boundingBox(),
      }),
    )
    await page.screenshot({ path: `../../artifacts/ui-phase-two/library-preparation-${width}.png` })
    expect(state.errors).toEqual([])
  })
}

test('explicit preparation preserves audio, zoom/seek/beatgrid/nudge, height and cue states', async ({
  page,
}) => {
  const state = await setup(page)
  await play(page)
  await page.getByRole('button', { name: 'Prepare', exact: true }).click()
  const prep = page.getByLabel('Track preparation', { exact: true })
  await prep.getByRole('button', { name: 'Pause', exact: true }).click()
  await prep.getByLabel('Preparation waveform zoom').selectOption('2')
  const slider = prep.getByRole('slider', { name: 'Seek', exact: true })
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '0.01')
  await prep.getByRole('button', { name: '+10 ms', exact: true }).click()
  await expect(slider).toHaveAttribute('aria-valuenow', '0.02')
  const box = (await slider.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height - 16)
  await expect
    .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
    .toBeCloseTo(1.5, 1)
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height - 16)
  await expect(
    page.getByText('Beatgrid anchored to FirstBeat marker', { exact: true }),
  ).toBeVisible()
  const resize = page.getByRole('separator', { name: 'Resize player and track list', exact: true })
  const before = Number(await resize.getAttribute('aria-valuenow'))
  await resize.focus()
  await page.keyboard.press('ArrowDown')
  const after = Number(await resize.getAttribute('aria-valuenow'))
  expect(after).toBeGreaterThan(before)
  state.failMemory(true)
  await prep.getByRole('button', { name: 'Add Memory Cue', exact: true }).first().click()
  await expect(prep.getByRole('alert')).toContainText('Memory save unavailable')
  state.failMemory(false)
  await prep.getByRole('button', { name: 'Add Memory Cue', exact: true }).first().click()
  await expect(prep.getByRole('button', { name: 'Memory saved', exact: true })).toBeVisible()
  await expect(prep.getByLabel('Saved device cues')).toContainText('MEM 1')
  await expect(prep.getByLabel('Saved device cues')).toContainText(
    'HOT CUES · not supported on CDJ-850',
  )
  await prep.getByRole('button', { name: 'Memory saved', exact: true }).click()
  await expect(prep.getByRole('status')).toContainText('Existing USB exports are unchanged')
  await prep.getByRole('button', { name: 'Cue', exact: true }).click()
  await expect.poll(() => state.cues.length).toBe(3)
  await prep.getByRole('button', { name: 'Play', exact: true }).click()
  await prep.getByRole('button', { name: 'Focus list', exact: true }).click()
  await expect(prep).not.toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { ui2Audio: HTMLMediaElement[] }).ui2Audio[0].paused,
      ),
    )
    .toBe(false)
  await page.getByRole('button', { name: 'Prepare', exact: true }).click()
  await expect(resize).toHaveAttribute('aria-valuenow', String(after))
  await expect(prep.getByLabel('Preparation waveform zoom')).toHaveValue('2')
  expect(
    await page.evaluate(
      () => (window as unknown as { ui2Audio: HTMLMediaElement[] }).ui2Audio.length,
    ),
  ).toBe(1)
  expect(state.errors).toEqual([])
})

test('columns/presets/resize persist without replacing scroll owner or playing track', async ({
  page,
}) => {
  const state = await setup(page)
  await play(page)
  const scroll = page.locator('[data-library-scroll]')
  await scroll.evaluate((el) => {
    el.scrollTop = 360
  })
  await page.getByRole('button', { name: 'Columns', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Library columns', exact: true })
  await dialog.getByLabel('Column preset').selectOption('files')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: /Date modified/ })).toBeVisible()
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(360)
  const edge = page.getByRole('separator', { name: 'Resize Artist column', exact: true })
  await edge.focus()
  await page.keyboard.press('ArrowRight')
  await expect(edge).toHaveAttribute('aria-valuenow', '186')
  await page.reload()
  await expect(edge).toHaveAttribute('aria-valuenow', '186')
  await page.getByRole('button', { name: 'Columns', exact: true }).click()
  await dialog.getByLabel('Column preset').selectOption('recent')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(() => state.queries.at(-1)?.searchParams.get('sort')).toBe('-added')
  await page.getByRole('button', { name: 'Columns', exact: true }).click()
  await dialog.getByLabel('Column preset').selectOption('dj')
  await dialog.getByRole('checkbox', { name: 'Genre', exact: true }).check()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: /Genre/ })).toBeVisible()
  expect(state.errors).toEqual([])
})

test('plan drawer does not shrink list, accepts multi-track drops and keeps keyboard reorder', async ({
  page,
}) => {
  const state = await setup(page)
  const list = page.locator('[data-library-scroll]'),
    before = (await list.boundingBox())!.height
  await page.getByRole('button', { name: 'Expand chain', exact: true }).click()
  expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(before)
  const dock = page.getByRole('region', { name: 'Active mix plan', exact: true })
  await dock.evaluate((el) => {
    const data = new DataTransfer()
    data.setData('application/x-wisp-track-ids', JSON.stringify(['ui2-4', 'ui2-5']))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  })
  await expect
    .poll(() => state.calls.filter((c) => c.path === '/api/mix-plans/plan/tracks').length)
    .toBe(2)
  await expect(dock.getByRole('button', { name: 'Drag to reorder', exact: true })).toHaveCount(6)
  const grip = dock.getByRole('button', { name: 'Drag to reorder', exact: true }).first()
  await grip.focus()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await page.keyboard.press('ArrowRight')
  await expect(
    page.getByRole('status').filter({ hasText: 'was moved over droppable area plan-track-1' }),
  ).toBeVisible()
  await page.keyboard.press('Space')
  await expect.poll(() => state.calls.filter((c) => c.method === 'PATCH').length).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Expand chain', exact: true })).toBeVisible()
  expect(state.errors).toEqual([])
})

test('filters, sorting, paging and menus keep the same paused deck and position', async ({
  page,
}) => {
  const state = await setup(page)
  await play(page)
  const player = page.getByLabel('Playback overview')
  await player.getByRole('button', { name: 'Pause', exact: true }).click()
  await player.getByRole('slider', { name: 'Seek', exact: true }).focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(player.getByRole('slider')).toHaveAttribute('aria-valuenow', '1')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.locator('[data-track-id="ui2-500"]')).toBeVisible()
  await page.getByRole('columnheader', { name: /Title/ }).getByRole('button').click()
  await expect.poll(() => state.queries.at(-1)?.searchParams.get('sort')).toBe('title')
  await page.getByRole('textbox', { name: 'Search tracks', exact: true }).fill('Track 0001')
  await expect(page.locator('[data-track-id="ui2-1"]')).toBeVisible()
  await page.getByRole('textbox', { name: 'Search tracks', exact: true }).fill('no such track')
  await expect(page.getByText('No tracks match these filters.', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search tracks', exact: true }).fill('')
  const row = page.locator('[data-track-id="ui2-0"]')
  await row.focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Play', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Prepare track', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(row).toBeFocused()
  await expect(player.getByRole('slider')).toHaveAttribute('aria-valuenow', '1')
  const audio = await page.evaluate(() =>
    (window as unknown as { ui2Audio: HTMLMediaElement[] }).ui2Audio.map((a) => ({
      paused: a.paused,
      time: a.currentTime,
      src: a.src,
    })),
  )
  expect(audio).toHaveLength(1)
  expect(audio[0]).toMatchObject({ paused: true, time: 1 })
  expect(audio[0].src).toContain('ui2-0/audio')
  // Focusing a row must not override WISP's existing Space play/pause shortcut.
  await row.focus()
  await page.keyboard.press('Space')
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { ui2Audio: HTMLMediaElement[] }).ui2Audio[0].paused,
      ),
    )
    .toBe(false)
  await page.keyboard.press('Space')
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { ui2Audio: HTMLMediaElement[] }).ui2Audio[0].paused,
      ),
    )
    .toBe(true)
  expect(state.calls).toEqual([])
  expect(state.errors).toEqual([])
})

test('pointer resizing persists column and preparation sizes', async ({ page }) => {
  await setup(page)
  await play(page)
  const edge = page.getByRole('separator', { name: 'Resize Artist column', exact: true })
  const box = (await edge.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(edge).toHaveAttribute('aria-valuenow', '202')
  await page.getByRole('button', { name: 'Prepare', exact: true }).click()
  const separator = page.getByRole('separator', {
    name: 'Resize player and track list',
    exact: true,
  })
  const initial = Number(await separator.getAttribute('aria-valuenow')),
    handle = (await separator.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 40, {
    steps: 4,
  })
  await page.mouse.up()
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial - 40))
  await page.reload()
  await expect(edge).toHaveAttribute('aria-valuenow', '202')
  await play(page)
  await page.getByRole('button', { name: 'Prepare', exact: true }).click()
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial - 40))
})

test('compact playback keeps missing-audio recovery visible without waveform overlap', async ({
  page,
}) => {
  await setup(page)
  await page.route('**/api/tracks/ui2-0', (route) =>
    route.fulfill({ json: { ...library[0], isUnavailable: true } }),
  )
  await play(page)
  const player = page.getByLabel('Playback overview')
  const warning = player.getByRole('alert')
  await expect(warning).toContainText('file was missing')
  await expect(player.getByRole('button', { name: 'Retry audio', exact: true })).toBeVisible()
  await expect(
    player.getByRole('button', { name: 'Relink audio file…', exact: true }),
  ).toBeVisible()
  const warningBox = (await warning.boundingBox())!,
    waveformBox = (await player.getByRole('slider').boundingBox())!
  expect(waveformBox.y).toBeGreaterThan(warningBox.y + warningBox.height)
})

test('failed track details keep playback and Focus list reachable', async ({ page }) => {
  await setup(page)
  await page.route('**/api/tracks/ui2-0', (route) =>
    route.fulfill({ status: 500, json: { message: 'Details unavailable' } }),
  )
  await play(page)
  await page.getByRole('button', { name: 'Prepare', exact: true }).click()
  const prep = page.getByLabel('Track preparation', { exact: true })
  await expect(prep.getByRole('button', { name: 'Retry track details', exact: true })).toBeVisible()
  await expect(prep.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await prep.getByRole('button', { name: 'Focus list', exact: true }).click()
  await expect(page.getByLabel('Playback overview')).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { ui2Audio: HTMLMediaElement[] }).ui2Audio[0].paused,
    ),
  ).toBe(false)
})

test('failed cue and library reads show retry, never empty or auto-create cues', async ({
  page,
}) => {
  const state = await setup(page)
  await play(page)
  await page.route('**/api/tracks/ui2-0/cues', (route) =>
    route.fulfill({ status: 500, json: { message: 'Marker store unavailable' } }),
  )
  await page.getByRole('button', { name: 'Prepare', exact: true }).click()
  const prep = page.getByLabel('Track preparation', { exact: true })
  await expect(prep.getByRole('alert')).toContainText('Could not load WISP markers')
  expect(state.calls).toEqual([])
  await page.unroute('**/api/tracks/ui2-0/cues')
  await prep.getByRole('button', { name: 'Retry markers', exact: true }).click()
  await expect(prep.getByLabel('Marker 1 type')).toBeVisible()
  await prep.getByRole('button', { name: 'Focus list', exact: true }).click()
  await page.route('**/api/tracks?*', (route) =>
    route.fulfill({ status: 500, json: { message: 'Library unavailable' } }),
  )
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not load the library')
  await expect(page.getByRole('button', { name: 'Retry library', exact: true })).toBeVisible()
  await expect(page.getByText('No tracks match these filters.', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/tracks?*')
  await page.getByRole('button', { name: 'Retry library', exact: true }).click()
  await expect(page.locator('[data-track-id="ui2-500"]')).toBeVisible()
  expect(state.calls).toEqual([])
})

for (const scale of [1.25, 1.5]) {
  test(`scaled-equivalent viewport keeps preparation and list reachable at ${scale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: Math.floor(1366 / scale), height: Math.floor(768 / scale) })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const state = await setup(page)
    await play(page)
    await page.getByRole('button', { name: 'Prepare', exact: true }).click()
    const prep = page.getByLabel('Track preparation', { exact: true })
    await expect(prep.getByRole('slider', { name: 'Seek', exact: true })).toBeVisible()
    await expect(prep.getByRole('button', { name: 'Focus list', exact: true })).toBeVisible()
    await prep.getByRole('button', { name: 'Focus list', exact: true }).click()
    await expect(page.locator('[data-track-id="ui2-0"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      Math.floor(1366 / scale),
    )
    expect(state.errors).toEqual([])
  })
}
