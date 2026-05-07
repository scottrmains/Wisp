import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActivePlanState {
  activePlanId: string | null
  setActivePlanId: (id: string | null) => void
}

export const useActivePlan = create<ActivePlanState>()(
  persist(
    (set) => ({
      activePlanId: null,
      setActivePlanId: (id) => set({ activePlanId: id }),
    }),
    { name: 'wisp.activePlan' },
  ),
)
