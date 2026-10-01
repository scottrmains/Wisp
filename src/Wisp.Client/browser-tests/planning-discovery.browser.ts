import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

async function setup(page: Page) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = []
  const reads: URL[] = [],
    errors: string[] = [],
    failures = new Set<string>()
  const tracks = Array.from({ length: 24 }, (_, i) => ({
    id: `phase3-${i}`,
    title: i ? `Late Night Selection ${i}` : 'Moving Through',
    artist: i ? 'Warehouse Sessions' : 'Sunday Club',
    fileName: `Fixture ${i}.wav`,
    filePath: `D:/Fictional Music/Fixture ${i}.wav`,
    durationSeconds: 60,
    bpm: i === 1 ? 140 : 124,
    musicalKey: i === 1 ? '3A' : '8A',
    energy: 4 + (i % 5),
    isUnavailable: false,
    isArchived: false,
  }))
  let plan = {
    id: 'plan',
    name: 'Sunday warm-up',
    notes: null,
    recommendationScopePlaylistId: null as string | null,
    tracks: tracks.slice(0, 8).map((track, i) => ({
      id: `mpt-${i}`,
      position: i,
      track,
      transitionNotes: '',
      isAnchor: i < 2,
    })),
  }
  const plans = [
    { id: 'plan', name: plan.name, trackCount: plan.tracks.length },
    { id: 'empty', name: 'After-hours selections for the long weekend', trackCount: 0 },
  ]
  const artists = [
    {
      id: 'artist',
      name: 'Sunday Club',
      trackCount: 12,
      latestLocalYear: 1998,
      newReleaseCount: 1,
      isMatchedSpotify: true,
      isMatchedDiscogs: false,
      isMatchedYouTube: false,
      lastCheckedAt: null,
    },
  ]
  const sources = [
    {
      id: 'source',
      name: 'Sunday vinyl selections — archival grooves and white labels',
      sourceType: 'YouTubeChannel',
      sourceUrl: 'https://www.youtube.com/@fictional',
      importedCount: 601,
      lastScannedAt: null,
    },
    {
      id: 'source2',
      name: 'After-hours playlist',
      sourceType: 'YouTubePlaylist',
      importedCount: 601,
      lastScannedAt: null,
    },
  ]
  const discovered = Array.from({ length: 601 }, (_, i) => ({
    id: `discovered-${i}`,
    discoverySourceId: 'source',
    sourceVideoId: 'keTtiDqQrpc',
    sourceUrl: 'https://www.youtube.com/watch?v=keTtiDqQrpc',
    rawTitle: `Sunday Club - Vinyl find ${i}`,
    parsedArtist: 'Sunday Club',
    parsedTitle: `Vinyl find ${i}`,
    mixVersion: null,
    releaseYear: 1998,
    status: i === 1 ? 'Want' : 'New',
    isAlreadyInLibrary: false,
    thumbnailUrl: null,
    publishedAt: i === 2 ? null : '2026-09-28T12:00:00Z',
    importedAt: '2026-10-01T12:00:00Z',
  }))
  let wishlist = [
    {
      id: 'wanted1',
      artist: 'Sunday Club',
      title: 'Lost dub',
      source: 'Discover',
      matchedLocalTrackId: null as string | null,
      thumbnailUrl: null,
      sourceUrl: null,
      addedAt: '2026-09-20T12:00:00Z',
    },
    {
      id: 'wanted2',
      artist: 'Warehouse Sessions',
      title: 'After-hours',
      source: 'CrateDigger',
      matchedLocalTrackId: 'phase3-2',
      thumbnailUrl: null,
      sourceUrl: null,
      addedAt: '2026-09-30T12:00:00Z',
    },
  ]
  let release = {
    id: 'release',
    artistProfileId: 'artist',
    title: 'New white label',
    source: 'Spotify',
    releaseType: 'Single',
    releaseDate: '2026',
    artworkUrl: null,
    isAlreadyInLibrary: false,
    isSavedForLater: false,
    isDismissed: false,
    youTubeVideoId: 'keTtiDqQrpc',
    url: null,
  }
  let searchErrors: string[] = []
  await page.addInitScript(() => {
    if (!localStorage.getItem('wisp.activePlan'))
      localStorage.setItem(
        'wisp.activePlan',
        JSON.stringify({ version: 0, state: { activePlanId: 'plan' } }),
      )
    const state = window as unknown as { phase3Audio: HTMLMediaElement[] }
    state.phase3Audio = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (!state.phase3Audio.includes(this)) state.phase3Audio.push(this)
      return play.call(this)
    }
  })
  await page.route('https://www.youtube.com/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Isolated audition fixture</p>' }),
  )
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method()
    const body = request.postData() ? request.postDataJSON() : {}
    if (method !== 'GET') calls.push({ path, method, body })
    else reads.push(url)
    if (failures.has(`${method} ${path}`))
      return route.fulfill({ status: 500, json: { message: 'Fixture offline. Try again.' } })
    if (path.endsWith('/audio')) {
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
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/)
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: 'audio/wav',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}),
        },
        body: wav.subarray(start, end + 1),
      })
    }
    let result: unknown = []
    if (path === '/api/tracks') result = { items: tracks, total: tracks.length, page: 1, size: 500 }
    if (/^\/api\/tracks\/phase3-\d+$/.test(path)) result = tracks.find((t) => path.endsWith(t.id))
    if (/^\/api\/tracks\/phase3-\d+\/cues$/.test(path))
      result = [
        {
          id: 'fixture-cue',
          timeSeconds: path.includes('phase3-0/') ? 12 : 24,
          type: 'Cue',
          label: 'Fixture cue',
          isAutoSuggested: false,
        },
      ]
    if (path === '/api/mix-plans') {
      if (method === 'POST') {
        const created = { id: 'created', name: body.name, trackCount: 0 }
        plans.push(created)
        result = created
      } else result = plans
    }
    if (path === '/api/mix-plans/plan') {
      if (method === 'PATCH') {
        plan = { ...plan, ...body }
        plans[0].name = plan.name
      }
      result = plan
    }
    if (path === '/api/mix-plans/empty' || path === '/api/mix-plans/created')
      result = {
        ...plan,
        id: path.split('/').at(-1),
        name: plans.find((p) => path.endsWith(p.id))?.name,
        tracks: [],
      }
    if (path === '/api/mix-plans/created' && method === 'DELETE')
      return route.fulfill({ status: 204 })
    if (path === '/api/mix-plans/plan/tracks' && method === 'POST') {
      const row = {
        ...plan.tracks[0],
        id: `added-${calls.length}`,
        track: tracks.find((t) => t.id === body.trackId)!,
      }
      const after = plan.tracks.findIndex((t) => t.id === body.afterMixPlanTrackId)
      plan.tracks.splice(after + 1, 0, row)
      result = row
    }
    if (/^\/api\/mix-plans\/plan\/tracks\/[^/]+$/.test(path)) {
      const index = plan.tracks.findIndex((t) => path.endsWith(t.id)),
        row = plan.tracks[index]
      if (method === 'DELETE') {
        plan.tracks.splice(index, 1)
        return route.fulfill({ status: 204 })
      }
      if (method === 'PATCH') {
        Object.assign(row, body)
        if (body.afterMixPlanTrackId) {
          plan.tracks.splice(index, 1)
          const after = plan.tracks.findIndex((t) => t.id === body.afterMixPlanTrackId)
          plan.tracks.splice(after + 1, 0, row)
        }
      }
      result = row
    }
    if (path.endsWith('/suggest-route'))
      result = [{ tracks: [tracks[10]], totalScore: 90, warningCount: 0, summary: 'Fixture route' }]
    if (path === '/api/artists') result = artists
    if (path === '/api/artists/artist/releases') {
      const status = url.searchParams.get('status')
      result =
        status === 'saved'
          ? release.isSavedForLater
            ? [release]
            : []
          : status === 'dismissed'
            ? release.isDismissed
              ? [release]
              : []
            : !release.isSavedForLater && !release.isDismissed
              ? [release]
              : []
    }
    if (path === '/api/releases/release') {
      release = { ...release, ...body }
      result = release
    }
    if (path === '/api/discover/follow') {
      artists.push({ ...artists[0], id: 'followed', name: body.name })
      result = { id: 'followed', name: body.name, spotifyArtistId: body.spotifyArtistId }
    }
    if (path === '/api/discover/search')
      result = {
        query: url.searchParams.get('q'),
        videos: [
          {
            source: 'YouTube',
            videoId: 'keTtiDqQrpc',
            title: 'Brent Laurence - Big Buds',
            channelTitle: 'Vinyl Archives',
            url: 'https://www.youtube.com/watch?v=keTtiDqQrpc',
            thumbnailUrl: null,
            publishedAt: '1998-01-01T00:00:00Z',
          },
        ],
        artists: [
          {
            source: 'Spotify',
            externalId: 'spotify-artist',
            name: 'Brent Laurence',
            followers: 400,
            genres: ['House'],
            imageUrl: null,
          },
        ],
        errors: searchErrors,
        youTubeQuota: {
          dailyBudget: 100,
          searchesToday: 10,
          resetUtc: '2026-10-02T00:00:00Z',
          exhausted: searchErrors.includes('youtube_quota_exhausted'),
        },
      }
    if (path === '/api/discovery/sources') {
      if (method === 'POST') {
        const source = { ...sources[0], id: 'new-source', name: 'New fixture source' }
        sources.push(source)
        result = source
      } else result = sources
    }
    if (path.endsWith('/scan/events'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ sourceId: 'source', status: 'Completed', totalImported: 601, checkedItems: 601, newItems: 0, updatedDates: 3, finishedAt: '2026-10-01T12:00:00Z' })}\n\n`,
      })
    if (path.endsWith('/scan') && method === 'POST') return route.fulfill({ status: 204 })
    if (/^\/api\/discovery\/sources\/[^/]+\/tracks$/.test(path)) {
      const status = url.searchParams.get('status'),
        search = url.searchParams.get('search'),
        n = Number(url.searchParams.get('page') ?? 1)
      const rows = discovered.filter(
        (t) => (!status || t.status === status) && (!search || t.rawTitle.includes(search)),
      )
      result = {
        items: rows.slice((n - 1) * 500, n * 500),
        total: rows.length,
        undatedCount: 1,
        page: n,
        size: 500,
      }
    }
    if (/^\/api\/discovery\/tracks\/discovered-\d+$/.test(path))
      result = { track: discovered.find((t) => path.endsWith(t.id)), matches: [] }
    if (path.endsWith('/parse')) {
      const track = discovered.find((t) => path.includes(`/${t.id}/`))!
      track.parsedTitle = body.title
      track.parsedArtist = body.artist
      result = track
    }
    if (path.endsWith('/status') && path.includes('/discovery/tracks/')) {
      const track = discovered.find((t) => path.includes(`/${t.id}/`))!
      track.status = body.status
      result = track
    }
    if (path === '/api/wanted-tracks') {
      if (method === 'POST') {
        const wanted = { ...wishlist[0], ...body, id: 'wanted-new' }
        wishlist.push(wanted)
        result = wanted
      } else result = wishlist
    }
    if (path.startsWith('/api/wanted-tracks/') && method === 'DELETE') {
      wishlist = wishlist.filter((w) => !path.endsWith(w.id))
      return route.fulfill({ status: 204 })
    }
    if (path === '/api/settings/soulseek') result = { isConfigured: true }
    if (path === '/api/soulseek/connection')
      result = { isConfigured: true, daemonAvailable: true, isConnected: true, isLoggedIn: true }
    if (path === '/api/recording-input/test' || path.endsWith('/origin')) result = null
    if (path === '/api/recordings/status') result = { busy: false, session: null, seconds: 0 }
    if (path === '/api/transcoder/status') result = { available: false }
    await route.fulfill({ json: result })
  })
  await page.goto('/')
  await expect(page.getByText('Moving Through', { exact: true }).first()).toBeVisible()
  return {
    calls,
    reads,
    errors,
    tracks,
    discovered,
    fail: (method: string, path: string, enabled = true) => {
      if (enabled) failures.add(`${method} ${path}`)
      else failures.delete(`${method} ${path}`)
    },
    searchErrors: (values: string[]) => {
      searchErrors = values
    },
  }
}
async function navigate(page: Page, name: string) {
  await page.locator('.app-sidebar').getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
}
async function playing(page: Page) {
  await page
    .locator('[data-track-id="phase3-0"]')
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect(page.getByLabel('Playback overview')).toBeVisible()
}

for (const width of [1024, 1366, 1920])
  test(`phase 3 visual workspaces and live playback at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 })
    const state = await setup(page)
    await playing(page)
    await mkdir('../../artifacts/ui-phase-three', { recursive: true })
    for (const name of ['Mix Plans', 'Discover', 'Crate Digger', 'Wanted']) {
      await navigate(page, name)
      if (name === 'Discover') {
        await page.getByRole('button', { name: 'Search anywhere', exact: true }).click()
        await page.getByLabel('Discover search', { exact: true }).fill('Brent Laurence Big Buds')
        await expect(page.getByRole('article')).toBeVisible()
      }
      if (name === 'Mix Plans') await page.getByRole('button', { name: /Transition 1 → 2/ }).click()
      if (name === 'Crate Digger')
        await page.locator('[data-discovery-track="discovered-0"]').getByRole('button').click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      )
      console.info(
        JSON.stringify({
          width,
          page: name,
          main: await page.locator('.feature-workspace').boundingBox(),
          content:
            name === 'Mix Plans' ? await page.getByLabel('Plan tracks').boundingBox() : undefined,
        }),
      )
      await page.screenshot({
        path: `../../artifacts/ui-phase-three/${name.replaceAll(' ', '-').toLowerCase()}-${width}.png`,
      })
    }
    const audio = await page.evaluate(() =>
      (window as unknown as { phase3Audio: HTMLMediaElement[] }).phase3Audio.map((a) => ({
        paused: a.paused,
        src: a.src,
      })),
    )
    expect(audio).toHaveLength(1)
    expect(audio[0].paused).toBe(false)
    expect(state.errors).toEqual([])
  })

test('plan navigation resize/collapse persists and keyboard track ordering, notes and anchors work', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Mix Plans')
  const edge = page.getByRole('separator', { name: 'Resize Plans', exact: true })
  await edge.focus()
  await page.keyboard.press('ArrowRight')
  await expect(edge).toHaveAttribute('aria-valuenow', '260')
  await page.getByRole('button', { name: 'Hide plans', exact: true }).click()
  await expect(page.getByLabel('Plans', { exact: true })).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Show plans', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show plans', exact: true }).click()
  await expect(edge).toHaveAttribute('aria-valuenow', '260')
  const grip = page.getByRole('button', { name: 'Drag to reorder', exact: true }).first()
  await grip.focus()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('status').filter({ hasText: 'was moved over droppable area mpt-1' }),
  ).toBeVisible()
  await page.keyboard.press('Space')
  await expect
    .poll(() => state.calls.some((c) => c.body.afterMixPlanTrackId === 'mpt-1'))
    .toBe(true)
  await page.locator('.plan-track').first().locator('summary').click()
  const notes = page.getByRole('textbox', { name: /Transition notes/ }).first()
  const noteLabel = (await notes.getAttribute('aria-label'))!
  await notes.fill('Long bass swap')
  await notes.blur()
  await expect
    .poll(() => state.calls.some((c) => c.body.transitionNotes === 'Long bass swap'))
    .toBe(true)
  await page.getByRole('button', { name: 'Unpin anchor', exact: true }).first().click()
  await expect.poll(() => state.calls.some((c) => c.body.isAnchor === false)).toBe(true)
  await page.getByRole('button', { name: 'Chain view', exact: true }).click()
  await expect(page.locator('.plan-tracks--chain')).toBeVisible()
  await expect(page.getByRole('textbox', { name: noteLabel, exact: true })).toHaveValue(
    'Long bass swap',
  )
  expect(state.errors).toEqual([])
})

test('plan multi-drop, transition preview, scoped suggestions and mutation failures are explicit', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Mix Plans')
  await page.getByRole('button', { name: /Transition 1 → 2/ }).click()
  const details = page.getByLabel('Transition details', { exact: true })
  await expect(details).toContainText('BPM jump')
  await details.getByRole('button', { name: 'Preview transition', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Blend preview' })).toBeVisible()
  const preview = page.getByRole('dialog', { name: 'Blend preview', exact: true })
  const deckA = preview
    .locator('section')
    .filter({ has: page.getByText('Deck A', { exact: true }) })
  const deckB = preview
    .locator('section')
    .filter({ has: page.getByText('Deck B', { exact: true }) })
  await expect(deckA.getByText('Fixture cue', { exact: true })).toBeVisible()
  await deckA.getByRole('button', { name: 'Play', exact: true }).click()
  await deckA.getByRole('button', { name: 'Pause', exact: true }).click()
  await deckB.getByRole('button', { name: 'Play', exact: true }).click()
  await deckB.getByRole('button', { name: 'Pause', exact: true }).click()
  await preview.getByRole('button', { name: 'Close preview', exact: true }).focus()
  await page.keyboard.press('1')
  await expect(deckA.getByText('0:12 / 1:00', { exact: true })).toBeVisible()
  await page.keyboard.press('Shift+Digit1')
  await expect(deckB.getByText('0:24 / 1:00', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    details.getByRole('button', { name: 'Preview transition', exact: true }),
  ).toBeFocused()
  await details.getByRole('button', { name: 'Close transition details', exact: true }).click()
  await expect(page.getByRole('button', { name: /Transition 1 → 2/ })).toBeFocused()
  await page.getByRole('button', { name: /Transition 1 → 2/ }).click()
  await details.getByRole('button', { name: 'Suggest filler tracks', exact: true }).click()
  await page.getByRole('button', { name: 'Suggest routes', exact: true }).click()
  await expect(page.getByText('Fixture route', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect
    .poll(() =>
      state.calls.some(
        (c) => c.body.trackId === 'phase3-10' && c.body.afterMixPlanTrackId === 'mpt-0',
      ),
    )
    .toBe(true)
  await page.getByLabel('Plan workspace').evaluate((el) => {
    const data = new DataTransfer()
    data.setData('application/x-wisp-track-ids', JSON.stringify(['phase3-11', 'phase3-12']))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  })
  await expect
    .poll(() => state.calls.filter((c) => c.path === '/api/mix-plans/plan/tracks').length)
    .toBe(3)
  state.fail('DELETE', '/api/mix-plans/plan/tracks/mpt-0')
  await page
    .locator('.plan-track')
    .filter({ hasText: 'Moving Through' })
    .getByRole('button', { name: 'Remove from plan', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('Could not save plan change')
  await expect(page.getByLabel('Plan tracks')).toContainText('Moving Through')
  expect(state.errors).toEqual([])
})

test('Discover scopes, debounce, track-first results, direct link, Want/follow and audition', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Discover')
  await page.getByLabel('Discover search', { exact: true }).fill('Brent Laurence Big Buds')
  await expect(page.getByText(/No matches for/)).toBeVisible()
  expect(state.reads.filter((u) => u.pathname === '/api/discover/search')).toHaveLength(0)
  await page.getByRole('button', { name: /Search anywhere instead/ }).click()
  const result = page.getByRole('article', { name: 'Brent Laurence - Big Buds' })
  await expect(result).toBeVisible()
  expect((await page.locator('.discover-videos').boundingBox())!.y).toBeLessThan(
    (await page.locator('.discover-artists').boundingBox())!.y,
  )
  await result.getByRole('button', { name: 'Watch', exact: true }).click()
  await expect(result.locator('iframe')).toHaveAttribute('src', /keTtiDqQrpc/)
  await result.getByRole('button', { name: 'Want', exact: true }).click()
  await expect(result.getByRole('button', { name: 'Wanted', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '+ Follow', exact: true }).click()
  await expect(page.getByText('Following', { exact: true })).toBeVisible()
  await page
    .getByLabel('Discover search', { exact: true })
    .fill('https://www.youtube.com/watch?v=keTtiDqQrpc')
  await expect
    .poll(() =>
      state.reads
        .filter((u) => u.pathname === '/api/discover/search')
        .at(-1)
        ?.searchParams.get('q'),
    )
    .toBe('https://www.youtube.com/watch?v=keTtiDqQrpc')
  await result.getByRole('button', { name: 'Soulseek', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Search Soulseek', exact: true })).toBeVisible()
  expect(state.errors).toEqual([])
})

test('Discover partial/quota errors retain useful results and retry; artist release actions still work', async ({
  page,
}) => {
  const state = await setup(page)
  state.searchErrors(['youtube_quota_exhausted', 'spotify_failed'])
  await navigate(page, 'Discover')
  await page.getByRole('button', { name: 'Search anywhere', exact: true }).click()
  await page.getByLabel('Discover search', { exact: true }).fill('Lost dub')
  await expect(page.getByText(/local search budget or Google's API quota/)).toBeVisible()
  await expect(page.getByRole('article')).toBeVisible()
  state.fail('POST', '/api/wanted-tracks')
  await page.getByRole('button', { name: 'Want', exact: true }).click()
  await expect(page.getByRole('article').getByRole('alert')).toContainText(
    'Could not add to Wanted',
  )
  state.fail('POST', '/api/wanted-tracks', false)
  await page.getByRole('button', { name: 'Want', exact: true }).click()
  await expect(
    page.getByRole('article').getByRole('button', { name: 'Wanted', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'My artists', exact: true }).click()
  await page.getByLabel('Discover search', { exact: true }).fill('')
  await page
    .getByLabel('Artists', { exact: true })
    .getByRole('button')
    .filter({ hasText: 'Sunday Club' })
    .click()
  await page.getByRole('button', { name: 'Want', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Release status' })
    .getByRole('button', { name: 'Wanted', exact: true })
    .click()
  await expect(page.getByText('New white label', { exact: true })).toBeVisible()
  expect(state.errors).toEqual([])
})

test('Crate Digger ordering, filters/paging, inspector corrections and unsaved protection', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Crate Digger')
  await expect(page.getByLabel('Sort discoveries')).toHaveValue('-published')
  await page.getByLabel('Sort discoveries').selectOption('published')
  await expect
    .poll(() =>
      state.reads
        .filter((u) => u.pathname.endsWith('/tracks') && u.pathname.includes('/discovery/'))
        .at(-1)
        ?.searchParams.get('sort'),
    )
    .toBe('published')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('[data-discovery-track="discovered-500"]')).toBeVisible()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.locator('[data-discovery-track="discovered-0"]').getByRole('button').click()
  const details = page.getByLabel('Discovery track details')
  await details.getByText('Correct artist / title', { exact: true }).click()
  await details.getByLabel('Title', { exact: true }).fill('Corrected title')
  await page.getByRole('button', { name: 'Close discovery details' }).click()
  const confirm = page.getByRole('dialog', { name: 'Discard metadata correction?' })
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(details.getByLabel('Title', { exact: true })).toHaveValue('Corrected title')
  await details.getByRole('button', { name: 'Save correction', exact: true }).click()
  await expect.poll(() => state.discovered[0].parsedTitle).toBe('Corrected title')
  await page.getByRole('button', { name: 'Close discovery details' }).click()
  await expect(
    page.locator('[data-discovery-track="discovered-0"]').getByRole('button'),
  ).toBeFocused()
  await page.getByLabel('More discovery filters').selectOption('VinylOnly')
  await expect(page.getByText(/No tracks match/)).toBeVisible()
  await page.getByRole('button', { name: 'Want', exact: true }).click()
  await expect(page.locator('[data-discovery-track="discovered-1"]')).toBeVisible()
  expect(state.errors).toEqual([])
})

test('Crate rescan completion reports no new tracks and corrected upload dates', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Crate Digger')
  await page.getByRole('button', { name: 'Rescan source', exact: true }).click()
  await expect(page.getByText('No new tracks found.', { exact: false })).toBeVisible()
  await expect(page.getByText(/Updated upload dates for 3/)).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss scan result' }).click()
  await expect(page.getByText('No new tracks found.', { exact: false })).not.toBeVisible()
  expect(state.errors).toEqual([])
})

test('new discovery source stays selected while its navigator refreshes', async ({ page }) => {
  const state = await setup(page)
  await navigate(page, 'Crate Digger')
  // Hold the refetch so a fast fixture cannot hide the stale-list selection race.
  let releaseSources!: () => void
  const sourcesRefresh = new Promise<void>((resolve) => {
    releaseSources = resolve
  })
  await page.route('**/api/discovery/sources', async (route) => {
    if (route.request().method() === 'GET') await sourcesRefresh
    await route.fallback()
  })
  try {
    await page.getByRole('button', { name: 'Add YouTube source', exact: true }).click()
    const prompt = page.getByRole('dialog', { name: 'Add discovery source', exact: true })
    await prompt.getByRole('textbox').fill('https://www.youtube.com/@fictional-new-source')
    await prompt.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'New fixture source', exact: true }),
    ).toBeVisible()
    await expect
      .poll(
        () =>
          state.reads.filter((url) => url.pathname === '/api/discovery/sources/new-source/tracks')
            .length,
      )
      .toBeGreaterThan(0)
    await expect(
      page
        .getByLabel('Sources', { exact: true })
        .getByRole('button')
        .filter({ hasText: 'New fixture source' }),
    ).toHaveAttribute('aria-current', 'page')
  } finally {
    releaseSources()
  }
  expect(state.errors).toEqual([])
})

test('Wanted search/sort/status/removal never deletes local audio and failed removal can retry', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Wanted')
  const rows = page.getByLabel('Wanted tracks').getByRole('listitem')
  await expect(rows.first()).toContainText('After-hours')
  await page.getByLabel('Sort wanted tracks').selectOption('oldest')
  await expect(rows.first()).toContainText('Lost dub')
  await page.getByRole('button', { name: 'Found', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('Found in library')
  await page.getByRole('button', { name: 'Waiting', exact: true }).click()
  await expect(rows).toContainText('Lost dub')
  await page.getByLabel('Search wanted tracks').fill('missing')
  await expect(page.getByText(/No tracks match this search/)).toBeVisible()
  await page.getByLabel('Search wanted tracks').fill('')
  state.fail('DELETE', '/api/wanted-tracks/wanted1')
  await page.getByRole('button', { name: 'Remove from Wanted' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not remove')
  await expect(rows).toHaveCount(1)
  state.fail('DELETE', '/api/wanted-tracks/wanted1', false)
  await page.getByRole('button', { name: 'Remove from Wanted' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(rows).toHaveCount(0)
  expect(
    state.calls
      .filter((c) => c.method === 'DELETE')
      .every((c) => c.path.startsWith('/api/wanted-tracks/')),
  ).toBe(true)
  expect(state.errors).toEqual([])
})

for (const [name, path, retry] of [
  ['Mix Plans', '/api/mix-plans/plan', 'Retry plan'],
  ['Discover', '/api/artists', 'Retry artists'],
  ['Crate Digger', '/api/discovery/sources', 'Retry sources'],
  ['Wanted', '/api/wanted-tracks', 'Retry wanted tracks'],
])
  test(`${name} read failure is distinct from empty and can retry`, async ({ page }) => {
    const state = await setup(page)
    state.fail('GET', path)
    await page.reload()
    await navigate(page, name)
    await expect(page.getByRole('button', { name: retry, exact: true })).toBeVisible()
    state.fail('GET', path, false)
    await page.getByRole('button', { name: retry, exact: true }).click()
    await expect(page.getByRole('button', { name: retry, exact: true })).not.toBeVisible()
    expect(state.errors).toEqual([])
  })

for (const scale of [1.25, 1.5])
  test(`phase 3 scaled-equivalent layouts at ${scale}`, async ({ page }) => {
    const width = Math.floor(1366 / scale)
    await page.setViewportSize({ width, height: Math.floor(768 / scale) })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setup(page)
    for (const name of ['Mix Plans', 'Discover', 'Crate Digger', 'Wanted']) {
      await navigate(page, name)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      )
      if (name === 'Mix Plans') await expect(page.getByLabel('Plan tracks')).toBeVisible()
      if (name === 'Crate Digger') {
        await page.locator('[data-discovery-track="discovered-0"]').getByRole('button').click()
        await expect(page.getByRole('button', { name: 'Close discovery details' })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        )
      }
    }
  })

test('Crate inspector save/status/availability failures retain fields and permit retry', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Crate Digger')
  await page.locator('[data-discovery-track="discovered-0"]').getByRole('button').click()
  const details = page.getByLabel('Discovery track details')
  await details.getByText('Correct artist / title', { exact: true }).click()
  await details.getByLabel('Title', { exact: true }).fill('Unsaved correction')
  state.fail('POST', '/api/discovery/tracks/discovered-0/parse')
  await details.getByRole('button', { name: 'Save correction', exact: true }).click()
  await expect(details.getByRole('alert')).toContainText('Could not save correction')
  await expect(details.getByLabel('Title', { exact: true })).toHaveValue('Unsaved correction')
  state.fail('POST', '/api/discovery/tracks/discovered-0/parse', false)
  await details.getByRole('button', { name: 'Save correction', exact: true }).click()
  await expect.poll(() => state.discovered[0].parsedTitle).toBe('Unsaved correction')
  state.fail('POST', '/api/discovery/tracks/discovered-0/status')
  await details.getByRole('button', { name: 'Want', exact: true }).click()
  await expect(details.getByRole('alert')).toContainText('Could not save status')
  state.fail('POST', '/api/discovery/tracks/discovered-0/status', false)
  await details.getByRole('button', { name: 'Want', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Want', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await details.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Reset', exact: true })).not.toBeVisible()
  state.fail('POST', '/api/discovery/tracks/discovered-0/match')
  await details.getByRole('button', { name: 'Check availability', exact: true }).click()
  await expect(details.getByRole('alert')).toContainText('Availability check failed')
  state.fail('POST', '/api/discovery/tracks/discovered-0/match', false)
  await details.getByRole('button', { name: 'Check availability', exact: true }).click()
  await expect(details.getByRole('alert')).not.toBeVisible()
  await details.getByRole('button', { name: 'Search Soulseek', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Search Soulseek', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toBeVisible()
  expect(state.errors).toEqual([])
})

test('Artist releases preserve audition, dismiss/restore and retryable save failures', async ({
  page,
}) => {
  const state = await setup(page)
  await navigate(page, 'Discover')
  await page
    .getByLabel('Artists', { exact: true })
    .getByRole('button')
    .filter({ hasText: 'Sunday Club' })
    .click()
  const workspace = page.locator('.discover-workspace')
  await workspace.getByRole('button', { name: 'Watch', exact: true }).click()
  await expect(page.getByTitle('New white label — YouTube preview')).toBeVisible()
  state.fail('PATCH', '/api/releases/release')
  await workspace.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(workspace.getByRole('alert')).toContainText('Could not save release status')
  state.fail('PATCH', '/api/releases/release', false)
  await workspace.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await workspace
    .getByRole('navigation', { name: 'Release status' })
    .getByRole('button', { name: 'Dismissed', exact: true })
    .click()
  await workspace.getByRole('button', { name: 'Restore', exact: true }).click()
  await workspace
    .getByRole('navigation', { name: 'Release status' })
    .getByRole('button', { name: 'New', exact: true })
    .click()
  await expect(workspace.getByText('New white label', { exact: true })).toBeVisible()
  expect(state.errors).toEqual([])
})
