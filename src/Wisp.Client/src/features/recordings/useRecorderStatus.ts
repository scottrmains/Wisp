import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'

export interface Session {
  id: string; title: string; directoryPath: string; endpointId: string; deviceName: string
  sampleRate: number; startedAt: string; state: string; audioBytes: number; issue: string | null
  previousTakeId: string | null; relinkedPath: string | null
}
export interface Status {
  session: Session | null; busy: boolean; seconds: number; savedSeconds: number
  leftPeak: number; rightPeak: number; clipped: boolean; remainingSeconds: number | null; closeRequested: boolean
}
export const statusKey = ['mix-recorder-status']
export function useRecorderStatus() {
  return useQuery({ queryKey: statusKey, queryFn: () => apiGet<Status>('/api/recordings/status'),
    refetchInterval: query => query.state.data?.busy ? 500 : 2000 })
}
