import { expect, test } from 'vitest'
import { columnWidth, defaultLibraryColumns, normalizeLibraryColumns } from './libraryColumns'
test('old profiles use DJ defaults; invalid column keys, duplicate keys and widths are bounded', () => {
  expect(normalizeLibraryColumns(undefined)).toEqual(defaultLibraryColumns)
  expect(
    normalizeLibraryColumns({
      preset: 'wrong',
      visible: ['title', 'title', 'not-a-column', 'artist'],
      widths: { artist: 9000, title: -4, bpm: NaN },
    }),
  ).toEqual({
    preset: 'custom',
    visible: ['actions', 'flags', 'artist', 'title'],
    widths: { artist: 600, title: 100 },
  })
  expect(columnWidth('bpm', 10)).toBe(48)
})
