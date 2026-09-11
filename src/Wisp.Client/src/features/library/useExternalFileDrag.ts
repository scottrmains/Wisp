import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bridge, bridgeAvailable } from '../../bridge'

export function useExternalFileDrag(scope: string) {
  const capabilities = useQuery({
    queryKey: ['desktop-capabilities'], queryFn: bridge.desktopCapabilities,
    enabled: bridgeAvailable(), staleTime: Infinity, retry: false,
  })
  // Photino identifies itself as "Photino WebView", not a Windows browser.
  // Ask the native host; neither the user agent nor browser platform is authority.
  const available = capabilities.data?.externalFileDrag === true
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ scope: string; failed: boolean; message: string } | null>(null)
  const explain = (message: string, failed = false) => setFeedback({ scope, message, failed })
  const begin = async (ids: string[]) => {
    if (inFlight.current) return
    if (!available) { explain('File dragging needs the Windows desktop app. Restart WISP if you recently updated it.', true); return }
    if (ids.length === 0) { explain('Select at least one track first.'); return }
    const max = capabilities.data!.maxDragTracks
    if (ids.length > max) { explain(`Select at most ${max.toLocaleString()} tracks per drag. No files were sent.`, true); return }
    inFlight.current = true
    setBusy(true); setFeedback(null)
    try {
      const result = await bridge.dragFiles(ids)
      explain(result.dropAccepted
        ? `${result.fileCount} files handed to the destination. Check the destination for import or copy results.`
        : result.reason === 'released-before-start'
          ? 'Released before the files were ready. Keep holding the mouse button until you reach the destination.'
          : 'No files were accepted. Drop onto a folder’s file area or a rekordbox playlist. If either app is running as administrator, restart both normally; Escape also cancels a drag.')
    } catch (error) { explain(error instanceof Error ? error.message : 'Could not start file dragging. Try again.', true) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return { available, busy, begin, feedback: feedback?.scope === scope ? feedback : null, explain, dismiss: () => setFeedback(null),
    capabilityError: capabilities.error?.message }
}

export type ExternalFileDragController = ReturnType<typeof useExternalFileDrag>
