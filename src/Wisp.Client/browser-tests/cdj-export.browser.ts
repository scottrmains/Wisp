import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page, replace = false, fail = false) {
  const exports: unknown[] = []
  await page.addInitScript(() => {
    let receive: (raw: string) => void
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (callback: typeof receive) => { receive = callback },
      sendMessage: (raw: string) => {
        const request = JSON.parse(raw)
        const result = request.method === 'pickFolder' ? { path: 'F:\\' } : { externalFileDrag: true }
        setTimeout(() => receive(JSON.stringify({ id: request.id, result })), 0)
      },
    } })
  })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cdj-export/preflight')) return route.fulfill({ json: {
      trackCount: 1, deviceCueCount: 2, requiredBytes: 1000, availableBytes: 100000,
      missingFiles: [], unsupportedFiles: [], needsPioneerReplacement: replace,
    } })
    if (path.endsWith('/export-to-cdj')) {
      exports.push(route.request().postDataJSON())
      if (fail) return route.fulfill({ status: 400, json: { message: 'Pioneer reference not found. Preserve it before formatting.' } })
      return route.fulfill({ json: { trackCount: 1, playlistCount: 1 } })
    }
    if (path === '/api/playlists') return route.fulfill({ json: [{ id: 'test', name: 'Cue test', trackCount: 1 }] })
    if (path === '/api/tracks') return route.fulfill({ json: { items: [{
      id: 'track', playlistEntryId: 'entry', title: 'Test track', artist: 'Test', filePath: 'D:\\Test.mp3',
      fileName: 'Test.mp3', durationSeconds: 180, bpm: 128, isUnavailable: false,
    }], total: 1, page: 1, size: 500 } })
    if (path === '/api/settings/soulseek') return route.fulfill({ json: { isConfigured: false } })
    return route.fulfill({ json: [] })
  })
  await page.goto('/')
  await page.getByText('Cue test', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Export to CDJ USB', exact: true }).click()
  return exports
}

test('fresh USB export is explicit, single-flight, and shows hardware test instructions', async ({ page }) => {
  const exports = await setup(page)
  const confirm = page.getByRole('dialog', { name: 'Run Memory Cue compatibility test?' })
  await expect(confirm).toContainText('2 WISP Memory Cue(s)')
  await expect(page.getByRole('button', { name: 'Preparing CDJ export…' })).toBeDisabled()
  expect(exports).toHaveLength(0)
  await confirm.getByRole('button', { name: 'Create test USB' }).click()
  const result = page.getByRole('heading', { name: 'CDJ Memory Cue test USB created' }).locator('..')
  await expect(result).toContainText('CUE/LOOP CALL')
  await expect(result).toContainText('Physical compatibility is not yet confirmed')
  expect(exports).toEqual([{ targetFolder: 'F:\\', confirmReplaceExistingPioneerLibrary: false }])
  await result.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Export to CDJ USB', exact: true })).toBeEnabled()
})

test('replacement warning acknowledges retained reference tracks and cancel does not export', async ({ page }) => {
  const exports = await setup(page, true)
  const dialog = page.getByRole('dialog', { name: 'Replace the Pioneer library?' })
  await expect(dialog).toContainText('other reference tracks may not load')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(exports).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Export to CDJ USB', exact: true })).toBeEnabled()
})

test('export errors use Wisp dialog and allow retry without reporting success', async ({ page }) => {
  await setup(page, false, true)
  await page.getByRole('button', { name: 'Create test USB' }).click()
  const dialog = page.getByRole('heading', { name: 'CDJ export could not complete' }).locator('..')
  await expect(dialog).toContainText('Pioneer reference not found')
  await expect(page.getByRole('heading', { name: 'CDJ Memory Cue test USB created' })).toHaveCount(0)
  await dialog.getByRole('button').click()
  await expect(page.getByRole('button', { name: 'Export to CDJ USB', exact: true })).toBeEnabled()
})
