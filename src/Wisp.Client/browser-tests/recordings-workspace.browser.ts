import { expect, test, type Page, type Locator } from '@playwright/test'
import type { Tracklist } from '../src/features/recordings/useRecordingTracklist'
import type { Feedback, RevisionRequest } from '../src/features/recordings/useRecordingFeedback'
import type { MixExport } from '../src/features/recordings/useMixExports'

async function openDetails(details: Locator) { if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click() }

function wav() {
  const bytes = 8000 * 2 * 60; const data = Buffer.alloc(44 + bytes)
  data.write('RIFF', 0); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40)
  return data
}
async function setup(page: Page, missing = false, linked = false) {
  const sessions = ['Alpha practice', 'Beta session'].map((title, n) => ({ id: `mix-${n}`, title, directoryPath: 'D:/Mixes/WISP Recordings/test',
    endpointId: 'input', deviceName: 'Xone', sampleRate: 44100, startedAt: `2026-09-${13 - n}T12:00:00Z`, state: 'Ready', audioBytes: 44100 * 8 * 60, issue: null, previousTakeId: null, relinkedPath: null }))
  const reviews: Record<string, { revision: number; rating: number | null; markers: { id: string; seconds: number; label: string }[] }> = {
    'mix-0': { revision: 0, rating: null, markers: [] }, 'mix-1': { revision: 0, rating: 4, markers: [] },
  }
  let job: { id: string; recordingId: string; kind: string; state: string; progress: number; error: string | null } | null = null
  let live = false, failReview = false, failTracklist = false
  let feedbackError = false, revisionError = false
  const exports: MixExport[] = []
  const exportRequests: { requestId: string; folder: string; format: string; includeTracklist: boolean; tracklistRevision: number }[] = []
  let exportJob: { id: string; recordingId: string; state: string; progress: number; error: string | null } | null = null
  let failExportStart = false
  let feedbackGate: Promise<void> | null = null; let releaseFeedback = () => {}
  const feedbacks: Record<string, Feedback> = Object.fromEntries(sessions.map(s => [s.id, { revision: 0, notes: '', status: 'Practice', rating: reviews[s.id].rating, ratingRevision: 0, annotations: [], detachedAnnotationIds: [] }]))
  const revisionRequests: RevisionRequest[] = []
  const plans = [{ id: 'plan', name: 'Original plan', notes: 'Warm-up', tracks: [], trackCount: 3 }]
  const tracklists: Record<string, Tracklist> = Object.fromEntries(sessions.map(s => [s.id, {
    revision: 0, activeSnapshotId: linked ? 'snapshot' : null, entries: [], timesDisagree: false, missingTrackIds: [],
    snapshots: linked ? [{ id: 'snapshot', sourcePlanId: 'plan', planName: 'Original plan', sourceUpdatedAt: s.startedAt, takenAt: s.startedAt, timing: 'At recording start', sourceExists: true,
      blueprint: { notes: 'Warm-up', entries: ['A', 'B', 'C'].map(title => ({ id: `blueprint-${title}`, trackId: title, artist: 'Artist', title, bpm: 128, musicalKey: '8A', cueInSeconds: 30, cueOutSeconds: null, transitionNotes: null, isAnchor: false })) } }] : [],
  }]))
  const data = wav()
  await page.addInitScript(() => {
    let handler: ((raw: string) => void) | null = null
    Object.defineProperty(window, 'external', { configurable: true, value: {
      receiveMessage: (fn: (raw: string) => void) => { handler = fn }, sendMessage: (raw: string) => {
        const request = JSON.parse(raw)
        handler?.(JSON.stringify({ id: request.id, result: { path: request.method === 'pickFolder' ? 'D:/Mixes' : 'D:/Existing/mix.wav' } }))
      },
    } })
  })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/recording-exports/job') return route.fulfill({ json: exportJob })
    if (path.startsWith('/api/recording-exports/job/') && path.endsWith('/cancel')) {
      if (exportJob) { exportJob.state = 'Cancelled'; exports.find(e => e.id === exportJob!.id)!.state = 'Cancelled' }
      return route.fulfill({ status: 204 })
    }
    if (path.startsWith('/api/recording-exports/mix-')) {
      const id = path.split('/')[3]
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); exportRequests.push(body)
        if (failExportStart) return route.fulfill({ status: 409, json: { message: 'The actual tracklist changed. Refresh it before exporting.' } })
        exportJob = { id: body.requestId, recordingId: id, state: 'Running', progress: .3, error: null }
        exports.push({ ...exportJob, title: 'Mix', format: body.format, directoryPath: `D:/Mixes/WISP Mix Exports/${body.requestId}`, createdAt: '2026-09-13T15:00:00Z', outputBytes: 100000, hasTracklist: body.includeTracklist, available: false })
        return route.fulfill({ json: exportJob })
      }
      return route.fulfill({ json: exports.filter(e => e.recordingId === id) })
    }
    if (path.startsWith('/api/recording-feedback/mix-')) {
      const [, , , id, operation] = path.split('/'); const feedback = feedbacks[id]
      if (operation === 'revisions') return route.fulfill({ json: revisionRequests.map(r => ({ id: r.requestId, planName: r.name, exists: true })) })
      if (operation === 'preview' || operation === 'revise') {
        const body = route.request().postDataJSON() as RevisionRequest
        if (operation === 'revise') {
          if (revisionError) return route.fulfill({ status: 409, json: { message: 'The preview changed. Preview again.' } })
          revisionRequests.push(body); plans.push({ id: body.requestId, name: body.name, notes: 'Selected feedback', tracks: [], trackCount: body.entries.length }); return route.fulfill({ json: { planId: body.requestId, exists: true } })
        }
        const list = tracklists[id]; const source = body.source === 'actual' ? list.entries.filter(e => e.played) : list.snapshots[0].blueprint.entries
        const problems: string[] = []
        if (body.source === 'actual' && list.entries.some(e => !e.played) && !body.excludeDrafts) problems.push('Acknowledge excluding unconfirmed draft entries.')
        if (body.entries.some(e => !e.omit && !e.trackId)) problems.push('Match or explicitly omit missing library references.')
        return route.fulfill({ json: { token: 'preview-token', tracks: body.entries.filter(e => !e.omit && e.trackId).map(e => ({ sourceEntryId: e.sourceEntryId, trackId: e.trackId, artist: 'Artist', title: e.trackId === 'X' ? 'Matched X' : source.find(s => s.id === e.sourceEntryId)!.title, cueInSeconds: null, cueOutSeconds: null, isAnchor: false, transitionNotes: null })), notes: `${body.includeOverallNotes ? feedback.notes : ''}\n${feedback.annotations.filter(a => body.annotationIds.includes(a.id)).map(a => a.text).join('\n')}`, problems, warnings: [], excludedDrafts: list.entries.filter(e => !e.played).length } })
      }
      if (route.request().method() === 'POST') {
        if (feedbackGate) await feedbackGate
        if (feedbackError) return route.fulfill({ status: 409, json: { message: 'Saved feedback changed. Your draft has not been applied.' } })
        const body = route.request().postDataJSON() as Feedback & { liveAnnotationId?: string }
        feedbacks[id] = { ...body, revision: feedback.revision + 1, ratingRevision: feedback.ratingRevision + 1, detachedAnnotationIds: [] }
        if (body.liveAnnotationId) feedbacks[id].annotations = body.annotations.map(a => a.id === body.liveAnnotationId ? { ...a, seconds: 15, endSeconds: null } : a)
        reviews[id].rating = body.rating
        return route.fulfill({ status: 204 })
      }
      return route.fulfill({ json: feedback })
    }
    if (path === '/api/mix-plans') return route.fulfill({ json: linked ? plans : [] })
    if (path.startsWith('/api/mix-plans/')) return route.fulfill({ json: plans.find(p => p.id === path.split('/')[3]) ?? plans[0] })
    if (path.startsWith('/api/recording-feedback/plans/')) return route.fulfill({ status: 204 })
    if (path === '/api/recording-tracklists/library') return route.fulfill({ json: [{ id: 'X', artist: 'Guest', title: 'X' }] })
    if (path === '/api/recording-tracklists/plans/plan/recordings') return route.fulfill({ json: [sessions[0]] })
    if (path.startsWith('/api/recording-tracklists/mix-')) {
      const [, , , id, operation] = path.split('/'); const list = tracklists[id]
      if (route.request().method() === 'POST') {
        if (failTracklist) return route.fulfill({ status: 409, json: { message: 'Tracklist changed; refresh before retrying.' } })
        const body = route.request().postDataJSON()
        if (operation === 'copy') list.entries = list.snapshots[0].blueprint.entries.map(e => ({ id: `actual-${e.id}`, trackId: e.trackId, artist: e.artist, title: e.title, played: false, startSeconds: null, blueprintEntryId: e.id }))
        if (operation === 'entries') {
          list.entries = body.entries
          if (body.liveEntryId) list.entries = list.entries.map(e => e.id === body.liveEntryId ? { ...e, played: true, startSeconds: 15 } : e)
          const times = list.entries.flatMap(e => e.startSeconds == null ? [] : [e.startSeconds]); list.timesDisagree = times.some((t, i) => i > 0 && t < times[i - 1])
        }
        if (operation === 'unlink') list.activeSnapshotId = null
        if (operation === 'link') { list.snapshots.push({ ...structuredClone(tracklists['mix-1'].snapshots[0]), id: body.snapshotId, timing: 'Linked after recording started' }); list.activeSnapshotId = body.snapshotId }
        list.revision++; return route.fulfill({ status: 204 })
      }
      return route.fulfill({ json: list })
    }
    if (path === '/api/recording-workspace/mixes') return route.fulfill({ json: sessions.map(s => ({ session: s, rating: reviews[s.id].rating, duration: 60, missing: missing && s.id === 'mix-0' })) })
    if (path === '/api/recording-workspace/job') return route.fulfill({ json: job })
    if (path === '/api/recording-workspace/import') { job = { id: 'job', recordingId: 'imported', kind: 'import', state: 'Running', progress: .2, error: null }; return route.fulfill({ json: job }) }
    if (path.endsWith('/cancel')) { if (job) job.state = 'Cancelled'; return route.fulfill({ status: 204 }) }
    if (path.endsWith('/thumbnail')) return route.fulfill({ json: Array.from({ length: 32 }, (_, i) => .2 + Math.abs(Math.sin(i * .3)) * .6) })
    if (path.endsWith('/peaks')) return route.fulfill({ json: { duration: 60, levels: [{ secondsPerBucket: .1, min: Array.from({ length: 600 }, (_, i) => -.2 - Math.abs(Math.sin(i * .1)) * .45), max: Array.from({ length: 600 }, (_, i) => .2 + Math.abs(Math.cos(i * .1)) * .4) }] } })
    if (path.endsWith('/review')) {
      const id = path.split('/')[3]
      if (route.request().method() === 'POST') {
        if (failReview) return route.fulfill({ status: 409, json: { message: 'Review changed; refresh before retrying.' } })
        reviews[id] = { ...route.request().postDataJSON(), revision: reviews[id].revision + 1 }
      }
      return route.fulfill({ json: reviews[id] })
    }
    if (path.endsWith('/audio') || path.startsWith('/api/recording-exports/audio/')) {
      const range = route.request().headers()['range']?.match(/bytes=(\d+)-(\d*)/)
      const start = range ? +range[1] : 0; const end = range?.[2] ? Math.min(+range[2], data.length - 1) : data.length - 1
      return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: data.subarray(start, end + 1),
        headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) } })
    }
    if (path === '/api/recordings/') return route.fulfill({ json: sessions })
    if (path === '/api/recordings/status') return route.fulfill({ json: { session: live ? sessions[0] : null, busy: live, seconds: 15, savedSeconds: 14, leftPeak: .4, rightPeak: .4, closeRequested: false } })
    if (path === '/api/recording-input/devices') return route.fulfill({ json: { devices: [], selectedEndpointId: null } })
    if (path === '/api/recording-input/test') return route.fulfill({ json: { state: 'Idle', id: null, seconds: 0 } })
    if (path === '/api/recordings/settings') return route.fulfill({ json: { folder: 'D:/Mixes' } })
    if (path === '/api/tracks') return route.fulfill({ json: { items: [], total: 0, page: 1, size: 500 } })
    return route.fulfill({ json: [] })
  })
  await page.goto('/'); await page.getByRole('button', { name: 'Mixes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your mixes', exact: true })).toBeVisible()
  await page.getByRole('region', { name: 'Mix history' }).getByRole('button', { name: /Alpha practice/ }).click()
  return { reviews, tracklists, feedbacks, revisionRequests, exports, exportRequests, failExportStart: (value: boolean) => { failExportStart = value },
    largeMaster: () => { sessions[0].audioBytes = 4294967296 }, completeExport: (error: string | null = null) => { if (exportJob) { exportJob.state = error ? 'Failed' : 'Ready'; exportJob.error = error; const row = exports.find(e => e.id === exportJob!.id)!; row.state = exportJob.state; row.error = error; row.available = !error } },
    startLive: () => { live = true; sessions[0].state = 'Recording' }, failReview: () => { failReview = true }, failTracklist: (value: boolean) => { failTracklist = value },
    stopLive: () => { live = false; sessions[0].state = 'Ready' }, failFeedback: (value: boolean) => { feedbackError = value }, failRevision: (value: boolean) => { revisionError = value },
    holdFeedback: () => { feedbackGate = new Promise<void>(resolve => { releaseFeedback = resolve }) }, releaseFeedback: () => { releaseFeedback(); feedbackGate = null } }
}

test('mix export offers explicit formats, snapshot tracklist, progress, navigation and cancellation', async ({ page }, info) => {
  const fixture = await setup(page)
  fixture.tracklists['mix-0'].revision = 3
  fixture.tracklists['mix-0'].entries = [
    { id: 'a', trackId: 'a', artist: 'A', title: 'Timed', played: true, startSeconds: 0, blueprintEntryId: null },
    { id: 'b', trackId: null, artist: 'B', title: 'Untimed', played: true, startSeconds: null, blueprintEntryId: null },
    { id: 'c', trackId: null, artist: 'C', title: 'Draft', played: false, startSeconds: null, blueprintEntryId: null },
  ]
  await page.reload(); await page.getByRole('button', { name: 'Mixes', exact: true }).click()
  await page.getByRole('button', { name: 'Exports', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Export finished mix', exact: true })
  await expect(panel.getByRole('button', { name: 'Create export' })).toBeDisabled()
  await panel.getByRole('button', { name: 'Choose export folder' }).click()
  await panel.getByRole('checkbox', { name: 'Include saved actual tracklist' }).check()
  await expect(panel).toContainText('1 timed · 1 clearly labelled untimed · 1 drafts excluded')
  await panel.getByRole('radio', { name: /WAV · 24-bit PCM/ }).check()
  await panel.getByRole('button', { name: 'Create export' }).click()
  expect(fixture.exportRequests[0]).toMatchObject({ folder: 'D:/Mixes', format: 'wav', includeTracklist: true, tracklistRevision: 3 })
  await expect(page.getByRole('progressbar', { name: 'Mix export progress' })).toBeVisible()
  await page.getByRole('button', { name: 'All mixes', exact: true }).click(); await page.getByRole('region', { name: 'Mix history' }).getByRole('button', { name: /Beta session/ }).click()
  await expect(page.getByRole('button', { name: 'Cancel export' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel export' }).click()
  await expect(page.getByText('Mix export · Cancelled', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'All mixes', exact: true }).click(); await page.getByRole('region', { name: 'Mix history' }).getByRole('button', { name: /Alpha practice/ }).click()
  await page.getByRole('button', { name: 'Exports', exact: true }).click()
  await expect(panel.getByText('WAV · 24-bit PCM · Cancelled · Tracklist included')).toBeVisible()
  await page.setViewportSize({ width: 800, height: 600 }); await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('export-panel-800.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('export start errors retain options and retry identity, and job failure survives reload', async ({ page }) => {
  const fixture = await setup(page); fixture.failExportStart(true)
  await page.getByRole('button', { name: 'Exports', exact: true }).click()
  await page.getByRole('button', { name: 'Choose export folder' }).click()
  await page.getByRole('button', { name: 'Create export' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'actual tracklist changed' })).toBeVisible()
  fixture.failExportStart(false); await page.getByRole('button', { name: 'Create export' }).click()
  expect(fixture.exportRequests[0].requestId).toBe(fixture.exportRequests[1].requestId)
  fixture.completeExport('FFmpeg unavailable. Check its path in Settings.')
  await page.reload(); await page.getByRole('button', { name: 'Mixes', exact: true }).click()
  await expect(page.getByText('Mix export · Failed', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Exports', exact: true }).click()
  await expect(page.getByLabel('Export history')).toContainText('FFmpeg unavailable')
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeEnabled()
})

test('large RF64 playback uses verified export, preserves review times and still blocks during capture', async ({ page }) => {
  const fixture = await setup(page); fixture.largeMaster()
  await expect(page.getByText(/This RF64 master is too large/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Exports', exact: true }).click()
  await page.getByRole('button', { name: 'Choose export folder' }).click(); await page.getByRole('button', { name: 'Create export' }).click()
  fixture.completeExport()
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  const audio = page.getByRole('region', { name: 'Mix playback', exact: true }).locator('audio')
  await expect(audio).toHaveAttribute('src', `/api/recording-exports/audio/${fixture.exportRequests[0].requestId}`)
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('20')
  await expect.poll(() => audio.evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThanOrEqual(19.9)
  fixture.startLive(); await expect.poll(() => audio.evaluate((e: HTMLAudioElement) => e.paused)).toBe(true)
  await expect(page.getByRole('button', { name: 'Create export' })).toBeDisabled()
})

test('detailed feedback saves rating, range, category and status; seek, loop, edit and resolve', async ({ page }, info) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Play mix', exact: true }).click(); await page.getByRole('button', { name: 'Pause mix', exact: true }).click()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('10')
  const panel = page.getByRole('region', { name: 'Detailed mix review' })
  await page.getByText('Personal reflection', { exact: true }).click()
  await panel.getByRole('button', { name: 'Rate 4 out of 5' }).click(); await panel.getByLabel('Review status').selectOption('Needs review')
  await panel.getByRole('textbox', { name: 'Overall notes', exact: true }).fill('Work on the middle section')
  await panel.getByRole('button', { name: 'Add comment here' }).click()
  await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('Bring the bass in later')
  await panel.getByLabel('Comment end (optional)').fill('20'); await panel.getByText('Category & track association', { exact: true }).click(); await panel.getByRole('combobox', { name: 'Category', exact: true }).selectOption('Phrasing')
  await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await expect(panel.getByText('Feedback saved', { exact: true })).toBeVisible()
  expect(fixture.feedbacks['mix-0'].annotations[0]).toMatchObject({ seconds: 10, endSeconds: 20, category: 'Phrasing', text: 'Bring the bass in later' })
  const note = panel.getByRole('article', { name: 'Comment: Bring the bass in later' })
  await note.getByRole('button', { name: '0:00:10.00 – 0:00:20.00', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('7')
  await note.getByRole('button', { name: 'Loop comment range' }).click()
  await openDetails(page.locator('.wm-player-tools')); await page.getByText('Section loop', { exact: true }).click(); await expect(page.getByLabel('Loop section')).toBeChecked()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('21'); await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('10')
  await note.getByRole('button', { name: 'Edit comment' }).click(); await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('Bass timing improved')
  await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await panel.getByRole('button', { name: 'Mark resolved', exact: true }).click(); await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await panel.getByLabel('Show comments').selectOption('revisit'); await expect(panel.getByText('No comments in this view.')).toBeVisible()
  await panel.getByLabel('Show comments').selectOption('resolved'); await expect(panel.getByRole('article')).toContainText('Bass timing improved')
  await page.setViewportSize({ width: 800, height: 600 }); await panel.getByRole('textbox', { name: 'Overall notes', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('feedback-800.png') })
  await panel.getByRole('button', { name: 'Remove comment (draft)' }).click(); await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await expect(panel.getByRole('article')).toHaveCount(0)
})

test('unfinished feedback survives navigation and reload; save failure while away remains visible', async ({ page }) => {
  const fixture = await setup(page)
  const panel = page.getByRole('region', { name: 'Detailed mix review' })
  await page.getByText('Personal reflection', { exact: true }).click()
  await panel.getByRole('textbox', { name: 'Overall notes', exact: true }).fill('Keep this overall draft'); await panel.getByRole('button', { name: 'Add comment here' }).click()
  await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('Unfinished transition thought')
  await page.getByRole('button', { name: 'Library', exact: true }).click(); await page.getByRole('button', { name: 'Mixes', exact: true }).click()
  await expect(panel.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Unfinished transition thought')
  await page.reload(); await expect(panel.getByRole('textbox', { name: 'Overall notes', exact: true })).toHaveValue('Keep this overall draft')
  fixture.failFeedback(true); fixture.holdFeedback()
  await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click(); fixture.releaseFeedback()
  await page.getByRole('button', { name: 'Mixes', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Saved feedback changed')
  await expect(panel.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Unfinished transition thought')
  fixture.failFeedback(false); await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await expect(panel.getByText('Feedback saved', { exact: true })).toBeVisible()
  expect(fixture.feedbacks['mix-0'].annotations).toHaveLength(1)
})

test('revision preview explicitly resolves drafts and manual tracks, carries selected feedback, then creates a separate plan', async ({ page }) => {
  const fixture = await setup(page, false, true)
  fixture.tracklists['mix-0'].entries = [
    { id: 'played-A', trackId: 'A', artist: 'Artist', title: 'A', played: true, startSeconds: 10, blueprintEntryId: 'blueprint-A' },
    { id: 'manual-X', trackId: null, artist: 'Unknown', title: 'Unreleased', played: true, startSeconds: null, blueprintEntryId: null },
    { id: 'draft-B', trackId: 'B', artist: 'Artist', title: 'B', played: false, startSeconds: null, blueprintEntryId: 'blueprint-B' },
  ]
  fixture.feedbacks['mix-0'].notes = 'Try another opening'
  fixture.feedbacks['mix-0'].annotations = [{ id: 'comment-1', seconds: 10, endSeconds: null, text: 'Keep this transition', category: 'Keep this', resolved: false, occurrenceId: 'played-A', toOccurrenceId: null, associationLabel: 'Artist — A' }]
  await page.reload()
  const panel = page.locator('.wm-mix-detail')
  await page.getByText('Personal reflection', { exact: true }).click(); await page.getByRole('button', { name: 'Tracklist', exact: true }).click(); await page.getByText('Revise for next time · Create a revised Mix Plan', { exact: true }).click()
  await panel.getByLabel('New plan name').fill('Practice v2')
  await panel.getByRole('button', { name: 'Preview revised plan' }).click()
  await expect(panel.getByRole('region', { name: 'Revised plan preview' })).toContainText('Acknowledge excluding unconfirmed')
  await expect(panel.getByRole('button', { name: 'Create new Mix Plan' })).toBeDisabled()
  await panel.getByLabel(/Exclude 1 unconfirmed draft/).click()
  await panel.getByLabel('Revision source entry 2', { exact: true }).getByRole('button', { name: 'Match library track' }).click()
  await panel.getByLabel('Search library match').fill('Guest'); await panel.getByRole('button', { name: 'Use Guest — X' }).click()
  await panel.getByLabel('Include saved overall notes').check(); await panel.getByRole('checkbox', { name: /0:00:10.00 · Keep this transition/ }).check()
  await panel.getByRole('button', { name: 'Preview revised plan' }).click()
  await expect(panel.getByRole('region', { name: 'Revised plan preview' })).toContainText('Matched X')
  await panel.getByText('Notes that will be copied', { exact: true }).click(); await expect(panel.getByRole('region', { name: 'Revised plan preview' })).toContainText('Try another opening')
  fixture.failRevision(true); await panel.getByRole('button', { name: 'Create new Mix Plan' }).click(); await expect(panel.getByRole('alert')).toContainText('preview changed')
  fixture.failRevision(false); await panel.getByRole('button', { name: 'Preview revised plan' }).click(); await panel.getByRole('button', { name: 'Create new Mix Plan' }).click()
  await expect(panel.getByRole('button', { name: 'Open revised plan' })).toBeVisible()
  expect(fixture.revisionRequests[0]).toMatchObject({ source: 'actual', name: 'Practice v2', excludeDrafts: true, annotationIds: ['comment-1'], includeOverallNotes: true })
  expect(fixture.revisionRequests[0].entries).toEqual([{ sourceEntryId: 'played-A', trackId: 'A', omit: false }, { sourceEntryId: 'manual-X', trackId: 'X', omit: false }])
  expect(fixture.tracklists['mix-0'].entries).toHaveLength(3); expect(fixture.tracklists['mix-0'].snapshots[0].planName).toBe('Original plan')
  await panel.getByRole('button', { name: 'Open revised plan' }).click(); await page.getByRole('button', { name: 'Record this plan' }).click()
  await expect(page.getByLabel('Planned set (optional)')).toHaveValue(fixture.revisionRequests[0].requestId)
})

test('live feedback uses server time; invalid ranges stay editable and drafts block revision', async ({ page }) => {
  const fixture = await setup(page, false, true)
  const panel = page.getByRole('region', { name: 'Detailed mix review' })
  await page.getByText('Personal reflection', { exact: true }).click()
  await panel.getByRole('button', { name: 'Add comment here' }).click(); await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('Invalid range draft')
  await panel.getByLabel('Comment start', { exact: true }).fill('20'); await panel.getByLabel('Comment end (optional)').fill('10')
  await panel.getByRole('button', { name: 'Save feedback', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('valid point or range')
  await page.getByRole('button', { name: 'Tracklist', exact: true }).click(); await page.getByText('Revise for next time · Create a revised Mix Plan', { exact: true }).click(); await expect(page.getByRole('button', { name: 'Preview revised plan' })).toBeDisabled(); await page.getByRole('button', { name: 'Review', exact: true }).click()
  await panel.getByRole('button', { name: 'Discard draft / reload saved' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Discard draft', exact: true }).click()
  fixture.startLive(); await panel.getByRole('button', { name: 'Add comment (live)' }).click()
  await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('Listen back to this'); await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await expect(panel.getByRole('article')).toContainText('0:00:15.00'); expect(fixture.feedbacks['mix-0'].annotations[0].endSeconds).toBeNull()
  await panel.getByRole('button', { name: 'Add comment (live)' }).click(); await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('Saved after stopping')
  fixture.stopLive(); await panel.getByRole('button', { name: 'Set comment time from playhead' }).click()
  await panel.getByLabel('Comment start', { exact: true }).fill('5'); await panel.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await expect(panel.getByRole('article', { name: 'Comment: Saved after stopping' })).toContainText('0:00:05.00')
})

test('local storage failure warns instead of losing an in-session feedback draft', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'wisp.recordingFeedbackDrafts') throw new DOMException('Full', 'QuotaExceededError'); original.call(this, key, value) } })
  const panel = page.getByRole('region', { name: 'Detailed mix review' })
  await page.getByText('Personal reflection', { exact: true }).click(); await panel.getByRole('textbox', { name: 'Overall notes', exact: true }).fill('Session draft is safe')
  await expect(page.getByRole('alert')).toContainText('storage is unavailable or full')
  await expect(panel.getByRole('textbox', { name: 'Overall notes', exact: true })).toHaveValue('Session draft is safe')
  await panel.getByRole('button', { name: 'Save feedback', exact: true }).click(); await expect(panel.getByText('Feedback saved', { exact: true })).toBeVisible()
})

test('blueprint A B C becomes actual A X C with waveform times, without rewriting the plan', async ({ page }, info) => {
  const fixture = await setup(page, false, true)
  await page.getByRole('button', { name: 'Tracklist', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  await panel.getByRole('button', { name: 'Copy blueprint as draft' }).click()
  await expect(panel.getByText('Unconfirmed · Untimed', { exact: false })).toHaveCount(3)
  await expect(panel.getByRole('button', { name: 'Copy blueprint as draft' })).toBeDisabled()
  await openDetails(panel.getByLabel('Tracklist entry 2', { exact: true }).locator('details'))
  await panel.getByLabel('Tracklist entry 2', { exact: true }).getByRole('button', { name: 'Remove tracklist entry' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove entry', exact: true }).click()
  await panel.getByText('Add actual tracks', { exact: true }).click()
  await panel.getByLabel('Find library track').fill('Guest')
  await panel.getByRole('button', { name: 'Add Guest — X' }).click()
  await openDetails(panel.getByLabel('Tracklist entry 3', { exact: true }).locator('details'))
  await panel.getByRole('button', { name: 'Move entry 3 up' }).click()
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  await page.getByRole('button', { name: 'Pause mix', exact: true }).click()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('1')
  for (const [index, time] of [0, 20, 40].entries()) {
    await page.getByRole('slider', { name: 'Mix position', exact: true }).fill(String(time))
    await openDetails(panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).locator('details'))
    await panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByRole('button', { name: 'Set start here' }).click()
    await expect(panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByLabel('Confirmed played')).toBeChecked()
  }
  expect(fixture.tracklists['mix-0'].entries.map(e => [e.title, e.startSeconds])).toEqual([['A', 0], ['X', 20], ['C', 40]])
  expect(fixture.tracklists['mix-0'].snapshots[0].blueprint.entries.map(e => e.title)).toEqual(['A', 'B', 'C'])
  expect(fixture.reviews['mix-0'].markers).toEqual([])
  await page.setViewportSize({ width: 800, height: 600 }); await panel.getByRole('heading', { name: /Actual tracklist/ }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('tracklist-800.png') })
  await page.reload(); await page.getByRole('button', { name: 'Tracklist', exact: true }).click()
  await expect(panel.getByLabel('Tracklist entry 2', { exact: true })).toContainText('Guest — X')
})

test('standalone manual repeated tracks, clear versus unconfirm, sort and failed save recovery', async ({ page }) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Tracklist', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  await panel.getByText('Add actual tracks', { exact: true }).click()
  for (let n = 0; n < 2; n++) {
    await panel.getByLabel('Manual title', { exact: true }).fill('Repeat')
    await panel.getByRole('button', { name: 'Add manual track' }).click()
    await expect(panel.getByLabel('Manual title', { exact: true })).toHaveValue('')
  }
  await openDetails(panel.getByLabel('Tracklist entry 1', { exact: true }).locator('details'))
  await panel.getByLabel('Tracklist entry 1', { exact: true }).getByLabel('Confirmed played').click()
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true })).toContainText('Played · Untimed')
  await panel.getByLabel('Tracklist entry 1', { exact: true }).getByRole('button', { name: 'Edit start time' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('not a time')
  await page.getByRole('dialog').getByRole('button', { name: 'Save start' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Enter a valid time')
  await page.getByRole('dialog').press('Escape')
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true }).getByRole('button', { name: 'Edit start time' })).toBeFocused()
  for (const [index, time] of ['30', '10'].entries()) {
    await openDetails(panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).locator('details'))
    await panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByRole('button', { name: 'Edit start time' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill(time)
    await page.getByRole('dialog').getByRole('button', { name: 'Save start' }).click()
    await expect(panel.getByLabel(`Tracklist entry ${index + 1}`, { exact: true }).getByRole('button', { name: 'Clear time' })).toBeVisible()
  }
  await panel.getByRole('button', { name: 'Order by start time' }).click()
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true })).toContainText('0:00:10.00')
  await panel.getByLabel('Tracklist entry 1', { exact: true }).getByRole('button', { name: 'Clear time' }).click()
  await expect(panel.getByLabel('Tracklist entry 1', { exact: true })).toContainText('Played · Untimed')
  await panel.getByLabel('Tracklist entry 2', { exact: true }).getByLabel('Confirmed played').click()
  await expect(panel.getByLabel('Tracklist entry 2', { exact: true })).toContainText('Unconfirmed · Untimed')
  fixture.failTracklist(true)
  await panel.getByLabel('Manual title', { exact: true }).fill('Keep this draft')
  await panel.getByRole('button', { name: 'Add manual track' }).click()
  await expect(panel.getByRole('alert')).toContainText('Tracklist changed')
  await expect(panel.getByLabel('Manual title', { exact: true })).toHaveValue('Keep this draft')
  expect(fixture.tracklists['mix-0'].entries).toHaveLength(2)
  fixture.failTracklist(false)
  await panel.getByRole('button', { name: 'Refresh tracklist' }).click()
  await panel.getByRole('button', { name: 'Add manual track' }).click()
  await expect(panel.getByLabel('Tracklist entry 3', { exact: true })).toContainText('Keep this draft')
})

test('recording and Mix Plan navigation preserves snapshots; recording setup is explicit', async ({ page }) => {
  const fixture = await setup(page, false, true)
  await page.getByRole('button', { name: 'Tracklist', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  await panel.getByText('Saved blueprint · Original plan', { exact: true }).click()
  await panel.getByRole('button', { name: 'Open current Mix Plan' }).click()
  await expect(page.getByRole('button', { name: 'Record this plan' })).toBeVisible()
  await page.getByText('Recordings with snapshots of this plan (1)', { exact: true }).click()
  await page.getByRole('button', { name: 'Alpha practice · Ready', exact: true }).click()
  await page.getByRole('button', { name: 'Tracklist', exact: true }).click()
  await expect(panel).toBeVisible()
  await panel.getByText('Saved blueprint · Original plan', { exact: true }).click()
  await panel.getByRole('button', { name: 'Unlink blueprint' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink', exact: true }).click()
  await expect(panel.getByText('Saved blueprint · No active plan', { exact: true })).toBeVisible()
  expect(fixture.tracklists['mix-0'].snapshots).toHaveLength(1)
  await panel.getByText(/Earlier snapshot · Original plan/).click()
  await panel.getByRole('button', { name: 'Open current Mix Plan' }).click()
  await page.getByRole('button', { name: 'Record this plan' }).click()
  await expect(page.getByLabel('Planned set (optional)')).toHaveValue('plan')
  await expect(page.getByRole('heading', { name: 'Record your mix', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop and save mix' })).toHaveCount(0)
})

test('live entry marking is explicit and does not turn review markers into tracks', async ({ page }) => {
  const fixture = await setup(page, false, true)
  await page.getByRole('button', { name: 'Tracklist', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Recording tracklist', exact: true })
  await panel.getByRole('button', { name: 'Copy blueprint as draft' }).click()
  fixture.startLive()
  await openDetails(panel.getByLabel('Tracklist entry 2', { exact: true }).locator('details'))
  await panel.getByLabel('Tracklist entry 2', { exact: true }).getByRole('button', { name: 'Track started (live)' }).click()
  await expect(panel.getByLabel('Tracklist entry 2', { exact: true })).toContainText('Played · 0:00:15.00')
  expect(fixture.tracklists['mix-0'].entries.filter(e => e.played)).toHaveLength(1)
  expect(fixture.reviews['mix-0'].markers).toHaveLength(0)
})

test('history searches and sorts; ratings survive selection and reload', async ({ page }) => {
  const fixture = await setup(page)
  await page.getByText('Personal reflection', { exact: true }).click()
  await page.getByRole('button', { name: 'Rate 5 out of 5' }).click()
  await page.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await expect(page.getByText('Feedback saved', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'All mixes', exact: true }).click()
  await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('rating')
  await expect(page.getByRole('region', { name: 'Mix history' }).getByRole('button').first()).toContainText('Alpha practice')
  await page.getByLabel('Find a mix').fill('Beta')
  await expect(page.getByRole('region', { name: 'Mix history' }).getByRole('button')).toHaveCount(1)
  await page.reload(); await page.getByRole('button', { name: 'Mixes', exact: true }).click()
  await page.getByRole('region', { name: 'Mix history' }).getByRole('button', { name: /Alpha practice/ }).click()
  await expect(page.getByRole('button', { name: 'Rate 5 out of 5' })).toHaveAttribute('aria-pressed', 'true')
  expect(fixture.reviews['mix-0'].rating).toBe(5)
})

test('real audio playback, seek, zoom, markers, pre-roll and section looping', async ({ page }, info) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  await page.getByRole('button', { name: 'Pause mix', exact: true }).click()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('20')
  await openDetails(page.locator('.wm-bookmarks'))
  await page.getByLabel('Marker label', { exact: true }).fill('Tighten this transition')
  await page.getByRole('button', { name: 'Mark this moment', exact: true }).click()
  await expect(page.getByRole('button', { name: /0:00:20 · Tighten/ })).toBeVisible()
  await page.getByRole('button', { name: /0:00:20 · Tighten/ }).click()
  await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('17')
  await openDetails(page.locator('.wm-player-tools'))
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('4')
  await page.getByRole('slider', { name: 'Recording waveform position', exact: true }).press('ArrowRight')
  await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('22')
  await openDetails(page.locator('.wm-player-tools')); await page.getByText('Section loop', { exact: true }).click()
  await page.getByRole('button', { name: /Set loop start/ }).click()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('30')
  await page.getByRole('button', { name: /Set loop end/ }).click()
  await page.getByLabel('Loop section').check()
  await page.getByRole('slider', { name: 'Mix position', exact: true }).fill('31')
  await expect(page.getByRole('slider', { name: 'Mix position', exact: true })).toHaveValue('22')
  expect(fixture.reviews['mix-0'].markers).toHaveLength(1)
  await page.setViewportSize({ width: 800, height: 600 })
  await page.getByRole('slider', { name: 'Recording waveform position', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('workspace-800.png') })
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: info.outputPath('workspace-1440.png') })
})

test('waveform height is adjustable and typing a marker does not start playback', async ({ page }) => {
  await setup(page)
  await openDetails(page.locator('.wm-player-tools'))
  await page.getByRole('slider', { name: 'Waveform height' }).fill('180')
  await expect(page.locator('.wm-waveform')).toHaveAttribute('style', 'height: 180px;')
  await openDetails(page.locator('.wm-bookmarks'))
  await page.getByLabel('Marker label', { exact: true }).fill('Review the next mix')
  await page.getByLabel('Marker label', { exact: true }).press('Space')
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeVisible()
})

test('redesigned library drills into a mix and tabs preserve playback and unsaved composer', async ({ page }, info) => {
  const fixture = await setup(page, false, true)
  fixture.feedbacks['mix-0'].annotations = [{ id: 'note', seconds: 19, endSeconds: 25, text: 'Bring the low end in more gradually.', category: 'Transition', resolved: false, occurrenceId: null, toOccurrenceId: null, associationLabel: null }]
  fixture.tracklists['mix-0'].entries = [{ id: 'track', trackId: 'A', artist: 'Brent Laurence', title: 'Big Buds', played: true, startSeconds: 0, blueprintEntryId: 'blueprint-A' }]
  await page.reload()
  await page.getByRole('button', { name: 'All mixes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Mix playback' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Scan folder', exact: true })).toHaveCount(0)
  await expect(page.locator('.wm-thumbnail span').first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('mixes-library-1440.png') })
  await page.getByRole('region', { name: 'Mix history' }).getByRole('button', { name: /Alpha practice/ }).click()
  await expect(page.getByRole('region', { name: 'Detailed mix review' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recording tracklist' })).toBeHidden()
  await expect(page.getByRole('region', { name: 'Export finished mix' })).toBeHidden()
  await page.screenshot({ path: info.outputPath('mix-review-1440.png') })
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  const audio = page.getByRole('region', { name: 'Mix playback', exact: true }).locator('audio')
  await audio.evaluate(e => e.setAttribute('data-instance', 'original'))
  const feedback = page.getByRole('region', { name: 'Detailed mix review' })
  await feedback.getByRole('button', { name: 'Add comment here' }).click()
  await feedback.getByRole('textbox', { name: 'Comment', exact: true }).fill('Still thinking about this transition')
  for (const section of ['Tracklist', 'Exports', 'Review']) {
    await page.getByRole('button', { name: section, exact: true }).click()
    await expect(audio).toHaveAttribute('data-instance', 'original')
    await expect.poll(() => audio.evaluate((e: HTMLAudioElement) => e.paused)).toBe(false)
  }
  await expect(feedback.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Still thinking about this transition')
  expect(fixture.feedbacks['mix-0'].annotations).toHaveLength(1)
  await page.getByRole('button', { name: 'Pause mix', exact: true }).click()
  await page.setViewportSize({ width: 800, height: 600 })
  await page.locator('.wm-workspace').evaluate(e => { e.scrollTop = e.scrollHeight })
  const player = await page.locator('.wm-sticky-player').boundingBox()
  expect(player!.y).toBeGreaterThanOrEqual(47)
  expect(player!.y + player!.height).toBeLessThan(600)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800)
  await page.screenshot({ path: info.outputPath('mix-review-sticky-800.png') })
  await page.getByRole('button', { name: 'Tracklist', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Recording tracklist' }).getByText('Edit track · timing & order')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit start time' })).toBeHidden()
  await page.screenshot({ path: info.outputPath('mix-tracklist-800.png') })
})

test('missing media and failed review saves remain actionable without dropping draft text', async ({ page }) => {
  const fixture = await setup(page, true)
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeDisabled()
  await expect(page.getByText(/Master file is missing/)).toBeVisible()
  fixture.failReview()
  await openDetails(page.locator('.wm-bookmarks'))
  await page.getByLabel('Marker label', { exact: true }).fill('Keep my draft')
  await page.getByRole('button', { name: 'Mark this moment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Review changed')
  await expect(page.getByLabel('Marker label', { exact: true })).toHaveValue('Keep my draft')
})

test('capture stops playback, blocks imports and records a live marker; import cancellation is explicit', async ({ page }) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'All mixes', exact: true }).click()
  await page.getByRole('button', { name: 'Import a mix', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel processing', exact: true }).click()
  await expect(page.getByText('Mix import · Cancelled', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'All mixes', exact: true }).click(); await page.getByRole('region', { name: 'Mix history' }).getByRole('button', { name: /Alpha practice/ }).click()
  await page.getByRole('button', { name: 'Play mix', exact: true }).click()
  fixture.startLive()
  await expect(page.getByRole('button', { name: 'Play mix', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'All mixes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Import a mix', exact: true })).toBeDisabled()
  await page.getByRole('region', { name: 'Mix history' }).getByRole('button', { name: /Alpha practice/ }).click(); await openDetails(page.locator('.wm-bookmarks'))
  await page.getByRole('button', { name: 'Mark this moment (live)', exact: true }).click()
  await expect.poll(() => fixture.reviews['mix-0'].markers.length).toBe(1)
  expect(fixture.reviews['mix-0'].markers[0].seconds).toBe(15)
})
