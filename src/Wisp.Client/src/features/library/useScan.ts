import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { library, subscribeToScan } from '../../api/library'
import type { ScanProgress } from '../../api/types'

export function useScan() {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const teardownRef = useRef<(() => void) | null>(null)

  useEffect(() => () => teardownRef.current?.(), [])

  const start = useCallback(
    async (folderPath: string) => {
      setError(null)
      teardownRef.current?.()
      setActive(true)

      try {
        const job = await library.startScan(folderPath)
        setProgress({
          scanJobId: job.id,
          status: job.status,
          totalFiles: 0,
          scannedFiles: 0,
          addedTracks: 0,
          updatedTracks: 0,
          removedTracks: 0,
          skippedFiles: 0,
          error: null,
        })

        teardownRef.current = subscribeToScan(job.id, {
          onProgress: setProgress,
          onComplete: () => {
            setActive(false)
            qc.invalidateQueries({ queryKey: ['tracks'] })
          },
          onError: () => {
            // SSE auto-retries on transient errors; only mark fatal on a final close
          },
        })
      } catch (err) {
        setActive(false)
        setError((err as Error).message)
      }
    },
    [qc],
  )

  const dismiss = useCallback(() => {
    setProgress(null)
    setError(null)
  }, [])

  return { start, progress, error, active, dismiss }
}
