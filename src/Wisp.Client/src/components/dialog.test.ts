import { expect, test } from 'vitest'
import { promptDialog, useDialogStore } from './dialog'

test('queued identical prompts have separate identities and resolve independently', async () => {
  const first = promptDialog({ title: 'Rename playlist', defaultValue: 'Demo' })
  const second = promptDialog({ title: 'Rename playlist', defaultValue: 'Demo' })
  const a = useDialogStore.getState().current!
  expect(useDialogStore.getState().queue).toHaveLength(1)
  if (a.kind !== 'prompt') throw new Error('Expected prompt')
  a.resolve('First')
  const b = useDialogStore.getState().current!
  expect(b.id).not.toBe(a.id)
  if (b.kind !== 'prompt') throw new Error('Expected prompt')
  b.resolve(null)
  expect(await first).toBe('First')
  expect(await second).toBeNull()
  expect(useDialogStore.getState().current).toBeNull()
})
