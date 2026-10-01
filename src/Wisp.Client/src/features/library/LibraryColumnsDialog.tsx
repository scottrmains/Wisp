import { X } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button, IconButton } from '../../components/ui/Button'
import { useUiPrefs } from '../../state/uiPrefs'
import { columnPresets, libraryColumns, type LibraryPreset } from './libraryColumns'

export function LibraryColumnsDialog({
  onClose,
  onPreset,
}: {
  onClose: () => void
  onPreset: (preset: LibraryPreset) => void
}) {
  const prefs = useUiPrefs((s) => s.libraryColumns)
  const set = useUiPrefs((s) => s.setLibraryColumns)
  return (
    <Modal labelledBy="library-columns-title" onClose={onClose}>
      <header className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
        <h2 id="library-columns-title" className="ui-dialog-heading">
          Library columns
        </h2>
        <IconButton label="Close columns" variant="quiet" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="space-y-4 overflow-auto p-4">
        <label className="flex items-center justify-between gap-4">
          View preset
          <select
            aria-label="Column preset"
            value={prefs.preset}
            onChange={(e) => {
              const preset = e.target.value as Exclude<LibraryPreset, 'custom'>
              set({ preset, visible: columnPresets[preset], widths: {} })
              onPreset(preset)
            }}
          >
            <option value="custom" disabled>
              Custom
            </option>
            <option value="dj">DJ preparation</option>
            <option value="recent">Recently added</option>
            <option value="files">File management</option>
          </select>
        </label>
        <p className="text-sm text-[var(--color-muted)]">
          Drag a column edge to resize, or focus its separator and use the arrow keys. Dates
          describe the track, not when it joined a playlist.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {libraryColumns
            .filter((c) => !['actions', 'flags'].includes(c.key))
            .map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.visible.includes(c.key)}
                  disabled={c.key === 'title'}
                  onChange={(e) =>
                    set({
                      ...prefs,
                      preset: 'custom',
                      visible: e.target.checked
                        ? [...prefs.visible, c.key]
                        : prefs.visible.filter((key) => key !== c.key),
                    })
                  }
                />
                {c.label}
              </label>
            ))}
        </div>
      </div>
      <footer className="flex justify-end border-t border-[var(--color-border)] p-4">
        <Button onClick={onClose}>Done</Button>
      </footer>
    </Modal>
  )
}
