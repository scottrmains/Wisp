import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { wanted as api } from '../../api/wanted'
import type { CreateWantedTrackRequest, WantedTrack } from '../../api/types'

/// Single source of truth for the cross-feature wishlist. Discover, Crate
/// Digger, and the Wanted page all read/write through this hook so the
/// sidebar count + Wanted page list stay in sync via TanStack invalidate.
export function useWantedTracks() {
  const qc = useQueryClient()
  const queryKey = ['wanted-tracks']

  const list = useQuery({
    queryKey,
    queryFn: () => api.list(),
    staleTime: 30_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey })

  const create = useMutation({
    mutationFn: (body: CreateWantedTrackRequest) => api.create(body),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: invalidate,
  })

  return {
    items: (list.data ?? []) as WantedTrack[],
    loading: list.isLoading,
    create,
    remove,
  }
}
