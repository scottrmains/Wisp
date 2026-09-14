import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Link, RotateCcw, Trash2, GitBranch } from 'lucide-react'
import { apiPost } from '../../api/client'
import { bridge, bridgeAvailable } from '../../bridge'
import { confirmDialog } from '../../components/dialog'
import { useRecorderStatus, type Session } from './useRecorderStatus'
import { useRecordingNavigation } from './useRecordingTracklist'

export function RecordingFileActions({ session }: { session: Session }) {
  const qc = useQueryClient()
  const recorder = useRecorderStatus()
  const [error, setError] = useState<string | null>(null)
  const action = useMutation({
    mutationFn: ({ operation, body }: { operation: string; body?: unknown }) =>
      apiPost(`/api/recordings/${session.id}/${operation}`, body),
    onSuccess: async (_, variables) => {
      await Promise.all(
        [
          'recording-workspace-mixes',
          'recording-sessions',
          'mix-recorder-status',
          'recording-peaks',
          'recording-thumbnail',
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      )
      if (variables.operation === 'remove') useRecordingNavigation.getState().home()
    },
  })
  const busy = !!recorder.data?.busy || action.isPending
  const remove = async (deleteAudio: boolean) => {
    if (
      await confirmDialog({
        title: deleteAudio ? 'Permanently delete managed audio?' : 'Remove this entry?',
        danger: deleteAudio,
        message: deleteAudio
          ? 'The managed master and managed import copy will be permanently deleted. Original imported files and separately relinked files are never deleted. This cannot be undone.'
          : 'The audio stays on disk. This entry will be hidden.',
        confirmLabel: deleteAudio ? 'Delete managed audio' : 'Remove entry',
      })
    )
      action.mutate({ operation: 'remove', body: { deleteAudio, confirmed: true } })
  }
  return (
    <section className="wm-file-actions" aria-label="Mix file management">
      <p className="wm-muted break-all">{session.relinkedPath ?? session.directoryPath}</p>
      {session.issue && <p role="status">{session.issue}</p>}
      <div className="wm-actions">
        <button
          className="wm-button"
          disabled={!bridgeAvailable()}
          onClick={() =>
            void bridge.openInExplorer(session.directoryPath).catch((e) => setError(String(e)))
          }
        >
          <FolderOpen /> Show folder
        </button>
        {session.state === 'Recoverable' && (
          <button
            className="wm-button wm-primary"
            disabled={busy}
            onClick={() => action.mutate({ operation: 'recover' })}
          >
            <RotateCcw /> Recover saved audio
          </button>
        )}
        <button
          className="wm-button"
          disabled={busy}
          onClick={() => useRecordingNavigation.getState().newTake(session.id, session.title)}
        >
          <GitBranch /> New linked take
        </button>
        {session.state === 'Ready' && (
          <button
            className="wm-button"
            disabled={busy || !bridgeAvailable()}
            onClick={async () => {
              try {
                const result = await bridge.pickAudioFile()
                if (result.path) action.mutate({ operation: 'relink', body: { path: result.path } })
              } catch (e) {
                setError(String(e))
              }
            }}
          >
            <Link /> Relink missing master
          </button>
        )}
        <button className="wm-button" disabled={busy} onClick={() => void remove(false)}>
          Remove entry
        </button>
        {session.state === 'Ready' && (
          <button className="wm-button wm-danger" disabled={busy} onClick={() => void remove(true)}>
            <Trash2 /> Delete managed audio
          </button>
        )}
      </div>
      {(error || action.error) && <p role="alert">{error ?? action.error?.message}</p>}
    </section>
  )
}
