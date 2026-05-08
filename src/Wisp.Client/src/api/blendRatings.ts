import { apiGet, apiPost } from './client'
import type { BlendRating, BlendRatingValue } from './types'

export const blendRatings = {
  /// Returns null if there's no prior rating for this pair (the API responds 204).
  getForPair: async (trackAId: string, trackBId: string): Promise<BlendRating | null> => {
    const r = await apiGet<BlendRating | undefined>('/api/blend-ratings', { trackAId, trackBId })
    return r ?? null
  },
  upsert: (body: { trackAId: string; trackBId: string; rating: BlendRatingValue; contextNotes?: string | null }) =>
    apiPost<BlendRating>('/api/blend-ratings', body),
}
