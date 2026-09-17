import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'

export interface MixExport { id: string; recordingId: string; title: string; format: string; state: string; error: string | null; directoryPath: string; createdAt: string; outputBytes: number; hasTracklist: boolean; available: boolean }
export const exportName = (format: string) => format === 'mp3' ? 'MP3 · 320 kbps' : format === 'wav' ? 'WAV · 24-bit PCM' : 'Original master'
export function useMixExports(id: string) {
  return useQuery({ queryKey: ['recording-exports', id], queryFn: () => apiGet<MixExport[]>(`/api/recording-exports/${id}`), refetchInterval: 2000 })
}
