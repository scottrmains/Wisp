import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cues as api } from '../../api/cues'
import type { CuePoint, CuePointType } from '../../api/types'

export function useCues(trackId: string | null) {
  const qc = useQueryClient()
  const queryKey = ['cues', trackId]

  const list = useQuery({
    queryKey,
    queryFn: () => api.list(trackId!),
    enabled: !!trackId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey })

  const create = useMutation({
    mutationFn: (body: { timeSeconds: number; type: CuePointType; label?: string; isAutoSuggested?: boolean }) =>
      api.create(trackId!, body),
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; timeSeconds?: number; label?: string; type?: CuePointType }) =>
      api.update(id, body),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: invalidate,
  })

  const removeAll = useMutation({
    mutationFn: () => api.deleteAll(trackId!),
    onSuccess: invalidate,
  })

  const generatePhraseMarkers = useMutation({
    mutationFn: (body: { firstBeatSeconds: number; stepBeats?: number; replaceExisting?: boolean }) =>
      api.generatePhraseMarkers(trackId!, body),
    onSuccess: invalidate,
  })

  return {
    cues: (list.data ?? []) as CuePoint[],
    loading: list.isLoading,
    create,
    update,
    remove,
    removeAll,
    generatePhraseMarkers,
  }
}
