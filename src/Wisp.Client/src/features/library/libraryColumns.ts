export const libraryColumns = [
  { key: 'actions', label: 'Actions', width: 64 },
  { key: 'flags', label: 'File status', width: 24 },
  { key: 'artist', label: 'Artist', width: 170, sortKey: 'artist' },
  { key: 'title', label: 'Title', width: 240, sortKey: 'title' },
  { key: 'version', label: 'Version', width: 150 },
  { key: 'bpm', label: 'BPM', width: 64, sortKey: 'bpm' },
  { key: 'musicalKey', label: 'Key', width: 64, sortKey: 'key' },
  { key: 'energy', label: 'Energy', width: 64, sortKey: 'energy' },
  { key: 'genre', label: 'Genre', width: 120, sortKey: 'genre' },
  // SQLite's current TimeSpan representation does not support duration sorting.
  { key: 'duration', label: 'Duration', width: 96 },
  { key: 'addedAt', label: 'Date added', width: 180, sortKey: 'added' },
  { key: 'fileModifiedAt', label: 'Date modified', width: 180, sortKey: 'modified' },
  { key: 'fileName', label: 'File', width: 280 },
] as const

export type LibraryColumnKey = (typeof libraryColumns)[number]['key']
export type LibraryPreset = 'dj' | 'recent' | 'files' | 'custom'
export interface LibraryColumnPrefs {
  preset: LibraryPreset
  visible: LibraryColumnKey[]
  widths: Partial<Record<LibraryColumnKey, number>>
}
const mandatory: LibraryColumnKey[] = ['actions', 'flags', 'title']
export const columnPresets: Record<Exclude<LibraryPreset, 'custom'>, LibraryColumnKey[]> = {
  dj: ['actions', 'flags', 'artist', 'title', 'bpm', 'musicalKey', 'energy', 'duration'],
  recent: ['actions', 'flags', 'artist', 'title', 'bpm', 'musicalKey', 'addedAt'],
  files: ['actions', 'flags', 'artist', 'title', 'addedAt', 'fileModifiedAt', 'fileName'],
}
export const defaultLibraryColumns: LibraryColumnPrefs = {
  preset: 'dj',
  visible: columnPresets.dj,
  widths: {},
}
export function columnWidth(key: LibraryColumnKey, value: number) {
  const min = key === 'title' || key === 'artist' ? 100 : 48
  return Number.isFinite(value)
    ? Math.max(min, Math.min(600, Math.round(value)))
    : libraryColumns.find((c) => c.key === key)!.width
}
export function normalizeLibraryColumns(value: unknown): LibraryColumnPrefs {
  if (!value || typeof value !== 'object') return defaultLibraryColumns
  const raw = value as Partial<LibraryColumnPrefs>
  const visible = libraryColumns
    .map((c) => c.key)
    .filter(
      (key) => mandatory.includes(key) || (Array.isArray(raw.visible) && raw.visible.includes(key)),
    )
  if (!Array.isArray(raw.visible)) return defaultLibraryColumns
  const widths: LibraryColumnPrefs['widths'] = {}
  for (const c of libraryColumns) {
    const width = raw.widths?.[c.key]
    if (
      typeof width === 'number' &&
      Number.isFinite(width) &&
      !mandatory.slice(0, 2).includes(c.key)
    )
      widths[c.key] = columnWidth(c.key, width)
  }
  return {
    preset: ['dj', 'recent', 'files', 'custom'].includes(raw.preset ?? '') ? raw.preset! : 'custom',
    visible,
    widths,
  }
}
