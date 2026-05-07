import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cleanup } from '../../api/cleanup'
import type { AuditEntry } from '../../api/types'

interface Props {
  audit: AuditEntry
  onDismiss: () => void
  autoDismissMs?: number
}

export function UndoToast({ audit, onDismiss, autoDismissMs = 8000 }: Props) {
  const qc = useQueryClient()
  const [undone, setUndone] = useState(false)

  const undo = useMutation({
    mutationFn: () => cleanup.undo(audit.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracks'] })
      setUndone(true)
      setTimeout(onDismiss, 1500)
    },
  })

  useEffect(() => {
    if (undone) return
    const id = setTimeout(onDismiss, autoDismissMs)
    return () => clearTimeout(id)
  }, [undone, onDismiss, autoDismissMs])

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-lg">
      <span className="text-sm">
        {undone ? 'Restored.' : 'Cleanup applied.'}
      </span>
      {!undone && (
        <button
          onClick={() => undo.mutate()}
          disabled={undo.isPending}
          className="text-sm text-[var(--color-accent)] hover:underline disabled:opacity-40"
        >
          {undo.isPending ? 'Undoing…' : 'Undo'}
        </button>
      )}
      {undo.error && <span className="text-xs text-red-400">{(undo.error as Error).message}</span>}
      <button onClick={onDismiss} className="text-[var(--color-muted)] hover:text-white">
        ×
      </button>
    </div>
  )
}
