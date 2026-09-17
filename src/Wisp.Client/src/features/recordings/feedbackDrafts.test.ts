import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
  return values
})
vi.mock('../../api/client', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
import { apiPost } from '../../api/client'
import { emptyFeedback, saveFeedback, useFeedbackDrafts } from './useRecordingFeedback'

describe('feedback drafts', () => {
  beforeEach(() => { useFeedbackDrafts.setState({ drafts: {} }); storage.clear(); vi.mocked(apiPost).mockReset() })
  it('persists unsaved text but never persists an in-flight lock', () => {
    useFeedbackDrafts.getState().put('mix', { feedback: { ...emptyFeedback, notes: 'Keep this' }, composer: null, saving: true, error: null })
    const saved = JSON.parse(storage.get('wisp.recordingFeedbackDrafts')!)
    expect(saved.state.drafts.mix.feedback.notes).toBe('Keep this'); expect(saved.state.drafts.mix.saving).toBe(false)
  })
  it('retains a failed draft and its optimistic revision for explicit recovery', async () => {
    const feedback = { ...emptyFeedback, notes: 'Unsaved', revision: 7 }
    useFeedbackDrafts.getState().put('mix', { feedback, composer: null, saving: false, error: null })
    vi.mocked(apiPost).mockRejectedValue(new Error('Changed elsewhere'))
    expect(await saveFeedback('mix', feedback)).toBe(false)
    expect(useFeedbackDrafts.getState().drafts.mix).toMatchObject({ feedback, saving: false, error: 'Changed elsewhere' })
  })
  it('serialises saves and clears a successful draft even without a mounted component', async () => {
    useFeedbackDrafts.getState().put('mix', { feedback: emptyFeedback, composer: null, saving: false, error: null })
    let resolve!: () => void
    vi.mocked(apiPost).mockImplementation(() => new Promise<void>(r => { resolve = r }))
    const saving = saveFeedback('mix', emptyFeedback)
    expect(await saveFeedback('mix', emptyFeedback)).toBe(false); expect(apiPost).toHaveBeenCalledTimes(1)
    resolve(); expect(await saving).toBe(true); expect(useFeedbackDrafts.getState().drafts.mix).toBeUndefined()
  })
})
