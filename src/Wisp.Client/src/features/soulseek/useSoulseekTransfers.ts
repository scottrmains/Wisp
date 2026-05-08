import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import { soulseek } from '../../api/soulseek'
import { useSoulseekStatus } from '../../state/soulseekStatus'

const POLL_INTERVAL_MS = 2_000

interface SoulseekConfigStatus {
  isConfigured: boolean
}

/// Single source of truth for the active Soulseek transfer list. Any component
/// that wants to render progress/state subscribes to this hook — they all share
/// the same TanStack Query cache and the same App-level polling cadence.
///
/// Polling rules:
///   - Only enabled when slskd is configured AND someone has flipped
///     `useSoulseekStatus().pollingActive` (e.g. by queueing a download).
///   - Auto-stops when the list contains no in-flight transfers.
///   - Side effect: when transfers complete, invalidates `['tracks']` after a short
///     delay so the library refetches and the new files appear without a manual scan.
export function useSoulseekTransfers() {
  const qc = useQueryClient()
  const pollingActive = useSoulseekStatus((s) => s.pollingActive)
  const stopPolling = useSoulseekStatus((s) => s.stopPolling)
  const completedSeenRef = useRef<Set<string>>(new Set())

  const status = useQuery({
    queryKey: ['soulseek-status'],
    queryFn: () => apiGet<SoulseekConfigStatus>('/api/settings/soulseek'),
    staleTime: 60_000,
  })
  const slskdConfigured = status.data?.isConfigured ?? false

  const transfers = useQuery({
    queryKey: ['soulseek-downloads'],
    queryFn: () => soulseek.listDownloads(),
    enabled: slskdConfigured && pollingActive,
    refetchInterval: (q) => {
      const data = q.state.data ?? []
      const stillActive = data.some((t) => !t.state.includes('Completed'))
      if (!stillActive) {
        // Defer the state flip so we don't mutate during a TanStack callback.
        setTimeout(stopPolling, 0)
        return false
      }
      return POLL_INTERVAL_MS
    },
    retry: false,
  })

  // Newly-completed transfers trigger a library refresh — same logic that used to
  // live inside SoulseekPanel; lifting it here means the refresh happens regardless
  // of which page the user is on when the completion lands.
  useEffect(() => {
    const newlyDone = (transfers.data ?? []).filter(
      (t) => t.state.includes('Completed') && t.id && !completedSeenRef.current.has(t.id),
    )
    if (newlyDone.length === 0) return
    for (const t of newlyDone) completedSeenRef.current.add(t.id)
    // Two refetches catch both "scanner already finished" and "scanner still going".
    const earlyId = setTimeout(() => qc.invalidateQueries({ queryKey: ['tracks'] }), 1_500)
    const lateId = setTimeout(() => qc.invalidateQueries({ queryKey: ['tracks'] }), 6_000)
    return () => {
      clearTimeout(earlyId)
      clearTimeout(lateId)
    }
  }, [transfers.data, qc])

  return {
    slskdConfigured,
    transfers: transfers.data ?? [],
    isLoading: transfers.isLoading,
    error: transfers.error,
  }
}
