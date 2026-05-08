import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mixPlans } from '../../api/mixPlans'
import { useActivePlan } from '../../state/activePlan'
import type { MixPlanSummary } from '../../api/types'

export function useMixPlans() {
  const qc = useQueryClient()
  const { activePlanId, setActivePlanId } = useActivePlan()

  const list = useQuery({
    queryKey: ['mixPlans'],
    queryFn: () => mixPlans.list(),
  })

  // If the persisted active plan no longer exists, drop it.
  useEffect(() => {
    if (!list.data || !activePlanId) return
    if (!list.data.some((p) => p.id === activePlanId)) setActivePlanId(null)
  }, [list.data, activePlanId, setActivePlanId])

  const create = useMutation({
    mutationFn: (name: string) => mixPlans.create(name),
    onSuccess: (created: MixPlanSummary) => {
      qc.invalidateQueries({ queryKey: ['mixPlans'] })
      setActivePlanId(created.id)
    },
  })

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => mixPlans.update(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mixPlans'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => mixPlans.delete(id),
    onSuccess: (_, deletedId) => {
      qc.invalidateQueries({ queryKey: ['mixPlans'] })
      if (activePlanId === deletedId) setActivePlanId(null)
    },
  })

  return {
    plans: list.data ?? [],
    activePlanId,
    setActivePlanId,
    create,
    rename,
    remove,
  }
}

export function useMixPlan(id: string | null) {
  const qc = useQueryClient()

  const detail = useQuery({
    queryKey: ['mixPlan', id],
    queryFn: () => mixPlans.get(id!),
    enabled: !!id,
  })

  const invalidate = () => {
    if (id) qc.invalidateQueries({ queryKey: ['mixPlan', id] })
    qc.invalidateQueries({ queryKey: ['mixPlans'] })
  }

  const addTrack = useMutation({
    mutationFn: ({ trackId, after }: { trackId: string; after?: string | null }) =>
      mixPlans.addTrack(id!, trackId, after ?? null),
    onSuccess: invalidate,
  })

  const moveTrack = useMutation({
    mutationFn: ({ mptId, after }: { mptId: string; after: string | null }) =>
      mixPlans.moveTrack(id!, mptId, after),
    onSuccess: invalidate,
  })

  const updateNotes = useMutation({
    mutationFn: ({ mptId, notes }: { mptId: string; notes: string }) =>
      mixPlans.updateNotes(id!, mptId, notes),
    onSuccess: invalidate,
  })

  const setAnchor = useMutation({
    mutationFn: ({ mptId, isAnchor }: { mptId: string; isAnchor: boolean }) =>
      mixPlans.setAnchor(id!, mptId, isAnchor),
    onSuccess: invalidate,
  })

  const removeTrack = useMutation({
    mutationFn: (mptId: string) => mixPlans.removeTrack(id!, mptId),
    onSuccess: invalidate,
  })

  return { plan: detail.data, loading: detail.isLoading, addTrack, moveTrack, updateNotes, setAnchor, removeTrack }
}
