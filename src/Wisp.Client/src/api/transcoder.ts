import { apiGet, apiPost } from './client'

export interface TranscoderStatus {
  isReady: boolean
  ffmpegPath: string | null
  bundled: boolean
}

export interface ConvertToMp3Response {
  outputPath: string
  sizeBytes: number
  durationSeconds: number
}

export const transcoder = {
  status: () => apiGet<TranscoderStatus>('/api/transcoder/status'),
  convertToMp3: (
    trackId: string,
    body: { outputFolder?: string; bitrate?: number } = {},
  ) => apiPost<ConvertToMp3Response>(`/api/tracks/${trackId}/convert-to-mp3`, body),
}
