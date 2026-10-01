import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const library = Array.from({ length: 18 }, (_, i) => ({
  id: `shell-track-${i}`,
  title: i ? `Track ${i}` : 'Moving Through',
  artist: 'Sunday Club',
  filePath: `D:\\Demo Music\\Track ${i}.mp3`,
  fileName: `Track ${i}.mp3`,
  durationSeconds: 60,
  bpm: 124,
  musicalKey: '8A',
  isUnavailable: false,
  isArchived: false,
}))

async function setup(
  page: Page,
  options: { configured?: boolean; manyPlaylists?: boolean; playlistError?: boolean } = {},
) {
  const configured = options.configured ?? true
  let list = [
    { id: 'warmup', name: 'Sunday warm-up', trackCount: 3 },
    {
      id: 'long',
      name: 'Sunday afternoons — warm-up selections for the long weekend',
      trackCount: 4,
    },
    ...Array.from({ length: options.manyPlaylists ? 55 : 2 }, (_, i) => ({
      id: `extra-${i}`,
      name: `Vinyl selection ${i}`,
      trackCount: 2,
    })),
  ]
  let playlistError = options.playlistError ?? false
  let busy = false
  let renameFails = false
  const mutations: { path: string; method: string }[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    if (!localStorage.getItem('wisp.uiPrefs'))
      localStorage.setItem(
        'wisp.uiPrefs',
        JSON.stringify({
          version: 0,
          state: { libraryPrepHeight: 314, libraryFiltersVisible: false, inspectorWidth: 510 },
        }),
      )
    const state = window as unknown as { shellAudio: HTMLMediaElement[] }
    state.shellAudio = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (!state.shellAudio.includes(this)) state.shellAudio.push(this)
      return play.call(this)
    }
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method()
    if (method !== 'GET') mutations.push({ path, method })
    if (path === '/api/playlists') {
      if (playlistError)
        return route.fulfill({ status: 500, json: { message: 'Demo temporarily unavailable.' } })
      if (method === 'POST') {
        const item = { id: 'created', name: request.postDataJSON().name, trackCount: 0 }
        list.push(item)
        return route.fulfill({ json: item })
      }
      return route.fulfill({ json: list })
    }
    if (/^\/api\/playlists\/[^/]+$/.test(path) && method === 'PATCH') {
      if (renameFails)
        return route.fulfill({
          status: 500,
          json: { message: 'Demo rename unavailable. Try again.' },
        })
      const item = list.find((p) => path.endsWith(p.id))!
      item.name = request.postDataJSON().name
      return route.fulfill({ json: item })
    }
    if (/^\/api\/playlists\/[^/]+$/.test(path) && method === 'DELETE') {
      list = list.filter((p) => !path.endsWith(p.id))
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/tracks/bulk'))
      return route.fulfill({ json: { added: request.postDataJSON().trackIds.length, skipped: 0 } })
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
      return route.fulfill({ contentType: 'audio/wav', body: wav })
    }
    let response: unknown = []
    if (path === '/api/tracks')
      response = { items: library, total: library.length, page: 1, size: 500 }
    if (/^\/api\/tracks\/shell-track-\d+$/.test(path))
      response = library.find((t) => path.endsWith(t.id))
    if (path === '/api/settings/soulseek')
      response = {
        isConfigured: configured,
        hasUsername: configured,
        hasPassword: configured,
        manageSlskd: true,
      }
    if (path === '/api/soulseek/connection')
      response = {
        isConfigured: configured,
        daemonAvailable: configured,
        isConnected: configured,
        isLoggedIn: configured,
      }
    if (path === '/api/recording-input/test') response = null
    if (path === '/api/recording-input/devices')
      response = { devices: [], selectedEndpointId: null }
    if (path === '/api/recordings/status')
      response = {
        busy,
        session: busy
          ? {
              id: 'demo-recording',
              title: 'Live test mix',
              state: 'Recording',
              deviceName: 'Demo input',
              startedAt: '2026-10-01T00:00:00Z',
            }
          : null,
        seconds: 15,
        remainingSeconds: 3600,
        closeRequested: false,
      }
    if (path === '/api/settings/soulseek/download-folder')
      response = {
        effectiveDownloadFolder: 'D:/Demo Music',
        nextDownloadFolder: 'D:/Demo Music',
        restartRequired: false,
      }
    if (path === '/api/soulseek/sharing')
      response = {
        settings: { enabled: false, folders: [], uploadSlots: 2, uploadSpeedLimit: 512 },
        canConfigure: true,
      }
    if (path === '/api/recordings/settings') response = { folder: 'D:/Demo Mixes' }
    if (path === '/api/system') response = { version: 'Demo', environment: 'Isolated fixture' }
    if (['/api/settings/spotify', '/api/settings/discogs', '/api/settings/youtube'].includes(path))
      response = { isConfigured: false }
    if (path === '/api/transcoder/status') response = { available: false }
    await route.fulfill({ json: response })
  })
  await page.goto('/')
  await expect(page.getByText('Moving Through', { exact: true }).first()).toBeVisible()
  return {
    errors,
    mutations,
    startCapture: () => {
      busy = true
    },
    failRename: (value: boolean) => {
      renameFails = value
    },
    recoverPlaylists: () => {
      playlistError = false
    },
  }
}

for (const width of [1024, 1366, 1920])
  test(`shell visual layout, separate playlist scroll and all destinations at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 })
    const fixture = await setup(page, { manyPlaylists: true })
    const sidebar = page.getByRole('complementary', { name: 'WISP sidebar' })
    await expect(sidebar).toHaveClass(width === 1024 ? /app-sidebar--compact/ : /^app-sidebar$/)
    if (width === 1024)
      await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    const scroll = page.locator('.app-playlist-scroll').first()
    expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: 'Library', exact: true }),
    ).toBeVisible()
    await scroll.evaluate((el) => {
      el.scrollTop = 0
    })
    await mkdir('../../artifacts/ui-phase-one', { recursive: true })
    await page.screenshot({ path: `../../artifacts/ui-phase-one/app-shell-${width}.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    expect(
      await sidebar
        .getByRole('button', { name: 'Discover', exact: true })
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(38)
    for (const label of [
      'Mix Plans',
      'Mixes',
      'Discover',
      'Crate Digger',
      'Wanted',
      'Soulseek',
      'Library',
    ]) {
      const button = page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: label, exact: true })
      await button.focus()
      await page.keyboard.press('Enter')
      await expect(button).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('.app-breadcrumb strong')).toHaveText(label)
      if (width === 1366)
        await page.screenshot({
          path: `../../artifacts/ui-phase-one/page-${label.toLowerCase().replaceAll(' ', '-')}.png`,
        })
    }
    expect(fixture.errors).toEqual([])
    expect(fixture.mutations).toEqual([])
  })

test('playlist search, empty state, compact drawer and additive persisted preferences', async ({
  page,
}) => {
  await setup(page)
  await page.getByRole('button', { name: 'Search playlists', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search playlists', exact: true }).fill('afternoons')
  await expect(page.locator('.app-playlist-row')).toHaveCount(1)
  await page
    .getByRole('searchbox', { name: 'Search playlists', exact: true })
    .fill('does not exist')
  await expect(page.getByText('No matching playlists. Try another name.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search playlists', exact: true }).fill('')
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Open playlists', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Playlists', exact: true })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('searchbox', { name: 'Find playlist in drawer' }).fill('afternoons')
  await drawer.getByRole('button', { name: /Sunday afternoons.*, 4 tracks/ }).click()
  await expect(drawer).toHaveCount(0)
  await expect(page.locator('.app-breadcrumb strong')).toContainText('Sunday afternoons')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Collapse sidebar', exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('wisp.uiPrefs')!).state),
  ).toMatchObject({
    libraryPrepHeight: 314,
    inspectorWidth: 510,
    sidebarCollapsed: true,
    sidebarCompactExpanded: true,
  })
})

test('playlist actions support keyboard, confirmation, errors and native creation dialog', async ({
  page,
}) => {
  const fixture = await setup(page)
  const trigger = page.getByRole('button', { name: 'Actions for Sunday warm-up', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Actions for Sunday warm-up' })
  await expect(menu.getByRole('menuitem', { name: 'Rename playlist' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Delete playlist' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.keyboard.press('Enter')
  const rename = page.getByRole('dialog', { name: 'Rename playlist' })
  await rename.getByRole('textbox').fill('Sunday renamed')
  fixture.failRename(true)
  await rename.getByRole('button', { name: 'Rename', exact: true }).click()
  const alert = page.getByRole('alertdialog', { name: 'Could not rename playlist' })
  await expect(alert).toContainText('Demo rename unavailable. Try again.')
  await alert.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(trigger).toBeFocused()
  fixture.failRename(false)
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Rename playlist' }).click()
  await rename.getByRole('textbox').fill('Sunday renamed')
  await rename.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Sunday renamed, 3 tracks', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Actions for Sunday renamed', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete playlist' }).click()
  const remove = page.getByRole('dialog', { name: 'Delete playlist "Sunday renamed"?' })
  await expect(remove.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  expect(fixture.mutations.some((r) => r.method === 'DELETE')).toBe(false)
  await page.getByRole('button', { name: 'New playlist', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'New playlist', exact: true })
  await create.getByRole('textbox', { name: 'Playlist name' }).fill('New demo set')
  await create.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(create).toHaveCount(0)
  await expect(page.locator('.app-breadcrumb strong')).toHaveText('New demo set')
  expect(fixture.errors).toEqual([])
})

test('Settings traps focus, is inert behind, restores focus and tooltip describes disabled scan', async ({
  page,
}) => {
  const fixture = await setup(page, { configured: false })
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Soulseek', exact: true }),
  ).toHaveCount(0)
  const settings = page
    .locator('.app-header')
    .getByRole('button', { name: 'Settings', exact: true })
  await settings.click()
  const dialog = page.getByRole('dialog', { name: 'WISP settings', exact: true })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: '../../artifacts/ui-phase-one/app-settings.png' })
  await dialog.getByRole('button', { name: 'About & diagnostics', exact: true }).click()
  for (const link of ['DM Sans', 'Barlow Condensed']) {
    const href = await dialog.getByRole('link', { name: link, exact: true }).getAttribute('href')
    expect(href).toMatch(/\.txt$/)
    const licence = await page.request.get(href!)
    expect(licence.ok()).toBe(true)
    expect(await licence.text()).toContain('SIL OPEN FONT LICENSE')
  }
  const focusableCount = await dialog
    .locator('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')
    .count()
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < focusableCount + 2; i++) {
      await page.keyboard.press(key)
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
    }
  }
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Discover', exact: true })
    .evaluate((el) => el.focus())
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  const close = dialog.getByRole('button', { name: 'Close settings', exact: true })
  await close.focus()
  await expect(page.getByRole('tooltip')).toHaveText('Close settings')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(settings).toBeFocused()
  const hint = page.locator('.ui-disabled-hint').first()
  await hint.focus()
  await expect(page.getByRole('tooltip')).toContainText('requires the WISP desktop app')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Scan folder', exact: true })).toBeDisabled()
  expect(fixture.errors).toEqual([])
})

test('UI4 Settings categories retain masked credential drafts, fail safely and retry', async ({
  page,
}) => {
  const fixture = await setup(page, { configured: false })
  let fail = true
  await page.route('**/api/settings/discogs', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { message: 'Demo settings offline' } }
        : { json: { isConfigured: false } },
    ),
  )
  await page.locator('.app-header').getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'WISP settings' })
  await dialog.getByRole('button', { name: 'Connections', exact: true }).click()
  const spotify = dialog.getByRole('heading', { name: 'Spotify · artist releases' }).locator('..')
  await spotify.getByRole('textbox', { name: 'Spotify Client ID' }).fill('fictional-client')
  await spotify.getByLabel('Spotify Client Secret', { exact: true }).fill('fictional-secret')
  await expect(spotify.getByLabel('Spotify Client Secret', { exact: true })).toHaveAttribute(
    'type',
    'password',
  )
  const discogs = dialog
    .getByRole('heading', { name: 'Discogs · vinyl and older releases' })
    .locator('..')
  await expect(discogs.getByRole('alert')).toContainText('Demo settings offline')
  await expect(discogs.getByRole('button', { name: 'Save personal access token' })).toBeDisabled()
  fail = false
  await discogs.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(discogs.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Audio tools', exact: true }).click()
  await expect(spotify).toBeHidden()
  await dialog.getByRole('button', { name: 'Connections', exact: true }).click()
  await expect(spotify.getByLabel('Spotify Client Secret', { exact: true })).toHaveValue(
    'fictional-secret',
  )
  await expect(spotify.getByRole('textbox', { name: 'Spotify Client ID' })).toHaveValue(
    'fictional-client',
  )
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fictional-secret')
  await mkdir('../../artifacts/ui-phase-four', { recursive: true })
  await spotify.getByLabel('Spotify Client Secret', { exact: true }).fill('')
  for (const section of ['Connections', 'Library', 'Audio tools', 'About & diagnostics']) {
    await dialog.getByRole('button', { name: section, exact: true }).click()
    await page.screenshot({
      path: `../../artifacts/ui-phase-four/settings-${section.split(' ')[0].toLowerCase()}.png`,
    })
  }
  await page.setViewportSize({ width: 800, height: 600 })
  await page.screenshot({ path: '../../artifacts/ui-phase-four/settings-800.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(fixture.mutations).toEqual([])
  expect(fixture.errors).toEqual([])
})

test('UI4 failed credential saves retain drafts and compact categories remain keyboard accessible', async ({
  page,
}) => {
  await setup(page, { configured: false })
  await page.route('**/api/settings/spotify', (route) =>
    route.fulfill(
      route.request().method() === 'POST'
        ? { status: 503, json: { message: 'Demo save unavailable' } }
        : { json: { isConfigured: false } },
    ),
  )
  await page.locator('.app-header').getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'WISP settings' })
  await dialog.getByRole('button', { name: 'Connections', exact: true }).click()
  const spotify = dialog.getByRole('heading', { name: 'Spotify · artist releases' }).locator('..')
  await spotify.getByLabel('Spotify Client ID').fill('demo-client')
  await spotify.getByLabel('Spotify Client Secret', { exact: true }).fill('demo-secret')
  await spotify.getByRole('button', { name: 'Save credentials' }).click()
  await expect(spotify.getByRole('alert')).toContainText('Demo save unavailable')
  await expect(spotify.getByLabel('Spotify Client Secret', { exact: true })).toHaveValue(
    'demo-secret',
  )
  for (const scale of [1.25, 1.5]) {
    await page.setViewportSize({ width: Math.floor(1366 / scale), height: Math.floor(768 / scale) })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const name of ['Library', 'Connections', 'Audio tools', 'About & diagnostics']) {
      const button = dialog
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('button', { name, exact: true })
      await button.focus()
      await button.press('Enter')
      await expect(button).toHaveAttribute('aria-current', 'page')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        Math.floor(1366 / scale),
      )
    }
  }
  await page.keyboard.press('Escape')
  await page.locator('.app-header').getByRole('button', { name: 'Settings', exact: true }).click()
  await dialog.getByRole('button', { name: 'Connections', exact: true }).click()
  await expect(spotify.getByLabel('Spotify Client Secret', { exact: true })).toHaveValue('')
})

test('compact playlist drawer keeps Library usable for internal drops and restores focus on Escape', async ({
  page,
}) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Open playlists', exact: true })
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: 'Playlists', exact: true })
  expect(await drawer.evaluate((el) => el.matches(':modal'))).toBe(false)
  const source = page.getByText('Moving Through', { exact: true }).first()
  await source.click()
  await drawer
    .getByRole('button', { name: 'Sunday warm-up, 3 tracks', exact: true })
    .evaluate((el) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(
        'application/x-wisp-track-ids',
        JSON.stringify(['shell-track-0', 'shell-track-1']),
      )
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    })
  await expect.poll(() => fixture.mutations.some((r) => r.path.endsWith('/tracks/bulk'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(fixture.errors).toEqual([])
})

test('compact sidebar tooltips remain hoverable without blocking adjacent navigation', async ({ page }) => {
  const fixture = await setup(page)
  await page.setViewportSize({ width: 910, height: 600 })
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  const discover = nav.getByRole('button', { name: 'Discover', exact: true })
  const crate = nav.getByRole('button', { name: 'Crate Digger', exact: true })
  await discover.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toHaveText('Discover')
  const buttonBounds = await crate.boundingBox()
  const tipBounds = await tip.boundingBox()
  expect(tipBounds!.x).toBeGreaterThan(buttonBounds!.x + buttonBounds!.width)
  await tip.hover()
  await expect(tip).toBeVisible()
  await crate.click()
  await expect(page.locator('.app-breadcrumb strong')).toHaveText('Crate Digger')
  await crate.focus()
  await expect(tip).toHaveText('Crate Digger')
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
  expect(fixture.errors).toEqual([])
})

test('shared colour tokens meet contrast and reduced-motion/zoom layout remains usable', async ({
  page,
}) => {
  await setup(page)
  const contrast = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const luminance = (token: string) => {
      const hex = style.getPropertyValue(token).trim().replace('#', '')
      const rgb = [0, 2, 4]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    }
    const ratio = (a: string, b: string) => {
      const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (values[0] + 0.05) / (values[1] + 0.05)
    }
    return {
      body: ratio('--color-text', '--color-bg'),
      muted: ratio('--color-muted', '--color-surface'),
      accent: ratio('--color-accent', '--color-bg'),
      primary: ratio('--color-text', '--ui-primary'),
      focus: ratio('--ui-focus', '--color-surface'),
      control: ratio('--ui-control-border', '--color-surface'),
    }
  })
  for (const key of ['body', 'muted', 'accent', 'primary'] as const)
    expect(contrast[key]).toBeGreaterThanOrEqual(4.5)
  expect(contrast.focus).toBeGreaterThanOrEqual(3)
  expect(contrast.control).toBeGreaterThanOrEqual(3)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const scale of [1.25, 1.5]) {
    const width = Math.floor(1366 / scale)
    await page.setViewportSize({ width, height: Math.floor(768 / scale) })
    await expect(page.getByRole('button', { name: 'Open playlists', exact: true })).toBeVisible()
    await expect(
      page.locator('.app-header').getByRole('button', { name: 'Settings', exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  }
})

test('playlist API failure is visible and retry recovers; right-click uses the accessible menu', async ({
  page,
}) => {
  const fixture = await setup(page, { playlistError: true })
  await expect(page.getByRole('alert')).toContainText('Could not load playlists')
  fixture.recoverPlaylists()
  await page.getByRole('button', { name: 'Retry playlists' }).click()
  const row = page.getByRole('button', { name: 'Sunday warm-up, 3 tracks', exact: true })
  await row.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Rename playlist' })).toBeFocused()
  await page.keyboard.press('Escape')
  expect(fixture.errors).toEqual([])
})

test('navigation, sidebar collapse and Settings do not replace or stop the library audio deck', async ({
  page,
}) => {
  const fixture = await setup(page)
  await page.getByText('Moving Through', { exact: true }).first().dblclick()
  const audioState = () =>
    page.evaluate(() => {
      const audio = (window as unknown as { shellAudio: HTMLMediaElement[] }).shellAudio
      return { count: audio.length, paused: audio[0]?.paused, position: audio[0]?.currentTime }
    })
  await expect.poll(audioState).toMatchObject({ count: 1, paused: false })
  for (const label of ['Discover', 'Wanted', 'Soulseek', 'Library']) {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true })
      .click()
    await expect.poll(audioState).toMatchObject({ count: 1, paused: false })
  }
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.locator('.app-header').getByRole('button', { name: 'Settings', exact: true }).click()
  await expect.poll(audioState).toMatchObject({ count: 1, paused: false })
  await page.keyboard.press('Escape')
  expect(fixture.errors).toEqual([])
})

test('active capture remains visible across navigation and Settings without sending stop or restart', async ({
  page,
}) => {
  const fixture = await setup(page)
  fixture.startCapture()
  await expect(page.getByRole('button', { name: /Recording.*View/ })).toBeVisible()
  for (const label of ['Discover', 'Wanted', 'Mix Plans', 'Soulseek', 'Library']) {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true })
      .click()
    await expect(page.getByRole('button', { name: /Recording.*View/ })).toBeVisible()
  }
  await page.locator('.app-header').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.keyboard.press('Escape')
  expect(fixture.mutations).toEqual([])
  expect(fixture.errors).toEqual([])
})
