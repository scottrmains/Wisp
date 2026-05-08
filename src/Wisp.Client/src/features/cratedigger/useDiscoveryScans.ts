import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { subscribeToDiscoveryScan } from '../../api/discovery'
import type { DiscoveryScanProgress } from '../../api/types'

/// Page-level tracker for in-flight discovery scans.
/// Both "add source" (which auto-queues an initial scan) and "manual rescan" funnel through
/// `trackScan(sourceId)` so the same SSE subscription + completion handling works for both.
/// Multiple calls for the same source are deduplicated.
export function useDiscoveryScans() {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<Record<string, DiscoveryScanProgress>>({})
  const teardownsRef = useRef<Map<string, () => void>>(new Map())

  // Tear down all subscriptions on unmount.
  useEffect(() => {
    const map = teardownsRef.current
    return () => {
      for (const teardown of map.values()) teardown()
      map.clear()
    }
  }, [])

  const trackScan = useCallback(
    (sourceId: string) => {
      // Skip if already subscribed for this source.
      if (teardownsRef.current.has(sourceId)) return

      // Seed an immediate "pending" so the UI shows a spinner before the first SSE event lands.
      setProgress((prev) => ({
        ...prev,
        [sourceId]: {
          sourceId,
          status: 'Pending',
          totalImported: 0,
          newItems: 0,
          parsedConfidently: 0,
          error: null,
        },
      }))

      const teardown = subscribeToDiscoveryScan(sourceId, {
        onProgress: (p) => {
          setProgress((prev) => ({ ...prev, [sourceId]: p }))
        },
        onComplete: (p) => {
          setProgress((prev) => {
            const next = { ...prev }
            delete next[sourceId]
            return next
          })
          teardownsRef.current.delete(sourceId)

          if (p.status === 'Completed') {
            qc.invalidateQueries({ queryKey: ['discovery-sources'] })
            qc.invalidateQueries({ queryKey: ['discovery-tracks', sourceId] })
          }
        },
      })

      teardownsRef.current.set(sourceId, teardown)
    },
    [qc],
  )

  return { progress, trackScan }
}
