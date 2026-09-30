import type { ScanProgress } from '../../api/types'
import { X } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'

interface Props {
  progress: ScanProgress | null
  error: string | null
  active: boolean
  onDismiss: () => void
}

export function ScanToast({ progress, error, active, onDismiss }: Props) {
  if (!progress && !error) return null

  if (error) {
    return (
      <div role="alert" className="fixed bottom-6 right-6 max-w-sm rounded-[var(--ui-radius)] border border-[var(--ui-danger)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-red-400">Scan failed</h3>
            <p className="mt-1 text-xs text-[var(--color-muted)]">{error}</p>
          </div>
          <IconButton onClick={onDismiss} label="Dismiss scan error" variant="quiet"><X aria-hidden="true" /></IconButton>
        </div>
      </div>
    )
  }

  if (!progress) return null

  const pct =
    progress.totalFiles > 0
      ? Math.round((progress.scannedFiles / progress.totalFiles) * 100)
      : 0

  const done = !active && (progress.status === 'Completed' || progress.status === 'Cancelled')

  return (
    <div role="status" className="fixed bottom-6 right-6 w-[22rem] max-w-[calc(100vw-3rem)] rounded-[var(--ui-radius)] border border-[var(--ui-control-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold">
            {progress.status === 'Pending' && 'Queued'}
            {progress.status === 'Running' && 'Scanning library…'}
            {progress.status === 'Completed' && 'Scan complete'}
            {progress.status === 'Failed' && 'Scan failed'}
            {progress.status === 'Cancelled' && 'Scan cancelled'}
          </h3>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {progress.scannedFiles} / {progress.totalFiles || '?'} files
            {progress.addedTracks > 0 && ` · ${progress.addedTracks} added`}
            {progress.updatedTracks > 0 && ` · ${progress.updatedTracks} updated`}
            {progress.removedTracks > 0 && ` · ${progress.removedTracks} removed`}
            {progress.skippedFiles > 0 && ` · ${progress.skippedFiles} skipped`}
          </p>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${done ? 100 : pct}%` }}
            />
          </div>
        </div>
        {done && (
          <IconButton onClick={onDismiss} label="Dismiss scan result" variant="quiet"><X aria-hidden="true" /></IconButton>
        )}
      </div>
    </div>
  )
}
