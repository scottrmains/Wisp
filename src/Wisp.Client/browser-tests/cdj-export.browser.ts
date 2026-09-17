import { expect, test, type Page } from '@playwright/test'
import type { CdjUsbDevice } from '../src/api/cdjExport'

const usb: CdjUsbDevice = { deviceId: 'disk-A', rootPath: 'F:\\', label: 'DJ USB', model: 'Flash drive',
  sizeBytes: 32000000000, freeBytes: 31000000000, fileSystem: 'FAT32', partitionStyle: 'MBR', partitionCount: 1,
  canExport: true, compatibilityProblem: null }

async function setup(page: Page, replace = false, fail = false, pick = true, headerPlan = false) {
  const exports: unknown[] = []
  const exportPaths: string[] = []
  let devices: CdjUsbDevice[] = [usb]
  let detectionFails = false
  await page.addInitScript((headerPlan) => {
    if (headerPlan) localStorage.setItem('wisp.activePlan', JSON.stringify({ state: { activePlanId: 'header-plan' }, version: 0 }))
    let receive: (raw: string) => void
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (callback: typeof receive) => { receive = callback },
      sendMessage: (raw: string) => {
        const request = JSON.parse(raw)
        if (request.method === 'pickFolder') throw new Error('CDJ export must not open a folder picker')
        const result = request.method === 'pickFolder' ? { path: 'F:\\' } : { externalFileDrag: true }
        setTimeout(() => receive(JSON.stringify({ id: request.id, result })), 0)
      },
    } })
  }, headerPlan)
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/cdj-export/devices') return detectionFails
      ? route.fulfill({ status: 503, json: { message: 'USB detection failed. Reconnect and refresh.' } })
      : route.fulfill({ json: devices })
    if (path.endsWith('/cdj-export/preflight')) return route.fulfill({ json: {
      trackCount: 1, deviceCueCount: 2, requiredBytes: 1000, availableBytes: 100000,
      missingFiles: [], unsupportedFiles: [], needsPioneerReplacement: replace,
    } })
    if (path.endsWith('/export-to-cdj')) {
      exportPaths.push(path)
      exports.push(route.request().postDataJSON())
      if (fail) return route.fulfill({ status: 400, json: { message: 'Pioneer reference not found. Preserve it before formatting.' } })
      return route.fulfill({ json: { trackCount: 1, playlistCount: 1 } })
    }
    if (path === '/api/playlists') return route.fulfill({ json: [{ id: 'test', name: 'Cue test', trackCount: 1 }] })
    if (path === '/api/mix-plans') return route.fulfill({ json: headerPlan ? [{ id: 'header-plan', name: 'Header export', trackCount: 1 }] : [] })
    if (path === '/api/mix-plans/header-plan') return route.fulfill({ json: { id: 'header-plan', name: 'Header export', tracks: [] } })
    if (path === '/api/tracks') return route.fulfill({ json: { items: [{
      id: 'track', playlistEntryId: 'entry', title: 'Test track', artist: 'Test', filePath: 'D:\\Test.mp3',
      fileName: 'Test.mp3', durationSeconds: 180, bpm: 128, isUnavailable: false,
    }], total: 1, page: 1, size: 500 } })
    if (path === '/api/settings/soulseek') return route.fulfill({ json: { isConfigured: false } })
    return route.fulfill({ json: [] })
  })
  await page.goto('/')
  if (headerPlan) await page.getByRole('button', { name: 'Mix plan: Header export' }).click()
  else await page.getByText('Cue test', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Export to CDJ USB', exact: true }).click()
  if (pick) {
    await page.getByLabel('Connected USB', { exact: true }).selectOption('disk-A')
    await page.getByRole('button', { name: 'Review export', exact: true }).click()
  }
  return { exports, exportPaths, setDevices: (value: CdjUsbDevice[]) => { devices = value }, failDetection: (value: boolean) => { detectionFails = value } }
}

test('top-bar mix-plan export uses the shared USB picker and physical device identity', async ({ page }) => {
  const state = await setup(page, false, false, true, true)
  await page.getByRole('dialog', { name: 'Export to CDJ USB?' }).getByRole('button', { name: 'Export tracks', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'CDJ export complete' })).toBeVisible()
  expect(state.exportPaths).toEqual(['/api/mix-plans/header-plan/export-to-cdj'])
  expect(state.exports).toEqual([{ targetFolder: 'F:\\', confirmReplaceExistingPioneerLibrary: false, usbDeviceId: 'disk-A' }])
})

test('fresh USB export is explicit, single-flight, and describes verified scope and limitations', async ({ page }) => {
  const { exports } = await setup(page)
  const confirm = page.getByRole('dialog', { name: 'Export to CDJ USB?' })
  await expect(confirm).toContainText('2 Memory Cue(s)')
  await expect(confirm).toContainText('DJ USB')
  await expect(confirm).toContainText('extra reference entries may appear')
  await expect(page.getByRole('button', { name: 'Preparing CDJ export…' })).toBeDisabled()
  expect(exports).toHaveLength(0)
  await confirm.getByRole('button', { name: 'Export tracks', exact: true }).click()
  const result = page.getByRole('heading', { name: 'CDJ export complete' }).locator('..')
  await expect(result).toContainText('CUE/LOOP CALL')
  await expect(result).toContainText('tested on CDJ-900')
  await expect(result).toContainText('CDJ-850 profile remains unverified')
  await expect(result).toContainText('validated overview waveforms')
  await expect(result).not.toContainText('missing waveforms are expected')
  expect(exports).toEqual([{ targetFolder: 'F:\\', confirmReplaceExistingPioneerLibrary: false, usbDeviceId: 'disk-A' }])
  await result.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Export to CDJ USB', exact: true })).toBeEnabled()
})

test('replacement warning acknowledges retained reference tracks and cancel does not export', async ({ page }) => {
  const { exports } = await setup(page, true)
  const dialog = page.getByRole('dialog', { name: 'Replace the Pioneer library?' })
  await expect(dialog).toContainText('leftover reference entries are still listed and may not load')
  await expect(dialog).toContainText('not an incremental sync')
  await expect(dialog).toContainText('backs up PIONEER and its previous exported audio')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(exports).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Export to CDJ USB', exact: true })).toBeEnabled()
})

test('export errors use Wisp dialog and allow retry without reporting success', async ({ page }) => {
  await setup(page, false, true)
  await page.getByRole('button', { name: 'Export tracks', exact: true }).click()
  const dialog = page.getByRole('heading', { name: 'CDJ export could not complete' }).locator('..')
  await expect(dialog).toContainText('Pioneer reference not found')
  await expect(page.getByRole('heading', { name: 'CDJ export complete' })).toHaveCount(0)
  await dialog.getByRole('button').click()
  await expect(page.getByRole('button', { name: 'Export to CDJ USB', exact: true })).toBeEnabled()
})

test('GPT USB is visible with a preparation warning, and cannot proceed', async ({ page }, testInfo) => {
  const state = await setup(page, false, false, false)
  state.setDevices([{ ...usb, partitionStyle: 'GPT', partitionCount: 2, canExport: false,
    compatibilityProblem: 'This USB uses GPT. CDJ-850/900 export requires MBR with one FAT32 partition. Back up the USB before repartitioning it.' }])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByLabel('Connected USB', { exact: true }).selectOption('disk-A')
  const dialog = page.getByRole('dialog', { name: 'Choose your USB' })
  await expect(dialog).toContainText('GPT · 2 partitions')
  await expect(dialog).toContainText('Back up the USB before repartitioning')
  await expect(dialog.getByRole('button', { name: 'Review export' })).toBeDisabled()
  expect(state.exports).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('usb-gpt-warning.png') })
  await page.setViewportSize({ width: 800, height: 650 })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('usb-gpt-warning-800.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('refresh discovers USBs; disconnect or drive-letter reuse never selects a different stick', async ({ page }) => {
  const state = await setup(page, false, false, false)
  const select = page.getByLabel('Connected USB', { exact: true })
  await select.selectOption('disk-A')
  state.setDevices([{ ...usb, deviceId: 'disk-B', label: 'Other USB' }])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('disconnected or changed')
  await expect(select).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled()
  await select.selectOption('disk-B')
  await expect(page.getByRole('button', { name: 'Review export' })).toBeEnabled()
  state.setDevices([])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review export' })).toBeDisabled()
  expect(state.exports).toHaveLength(0)
})

test('empty and failed device discovery are actionable and refresh can recover', async ({ page }) => {
  const state = await setup(page, false, false, false)
  state.setDevices([])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Plug in a USB drive, then refresh.', { exact: false })).toBeVisible()
  state.failDetection(true)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('USB detection failed')
  state.failDetection(false)
  state.setDevices([usb])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByLabel('Connected USB', { exact: true }).selectOption('disk-A')
  await expect(page.getByRole('button', { name: 'Review export' })).toBeEnabled()
})
