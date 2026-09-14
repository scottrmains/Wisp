import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { apiGet } from '../../api/client'

export interface PerformedEntry {
  id: string; trackId: string | null; artist: string; title: string
  played: boolean; startSeconds: number | null; blueprintEntryId: string | null
}
export interface BlueprintEntry {
  id: string; trackId: string; artist: string; title: string; bpm: number | null
  musicalKey: string | null; cueInSeconds: number | null; cueOutSeconds: number | null
  transitionNotes: string | null; isAnchor: boolean
}
export interface PlanSnapshot {
  id: string; sourcePlanId: string; planName: string; takenAt: string; sourceUpdatedAt: string
  timing: string; sourceExists: boolean; blueprint: { notes: string | null; entries: BlueprintEntry[] }
}
export interface Tracklist {
  revision: number; activeSnapshotId: string | null; entries: PerformedEntry[]
  snapshots: PlanSnapshot[]; timesDisagree: boolean; missingTrackIds: string[]
}
export const tracklistKey = (id: string) => ['recording-tracklist', id]
export const useRecordingTracklist = (id: string) => useQuery({
  queryKey: tracklistKey(id), queryFn: () => apiGet<Tracklist>(`/api/recording-tracklists/${id}`),
})

// Navigation intent only: no automatic recording, persisted plan links or audio changes.
export const useRecordingNavigation = create<{
  blueprintPlanId: string | null; selected: string | null; setupRequested: boolean
  view: 'library' | 'record' | 'mix'; previousTake: { id: string; title: string } | null
  home: () => void; record: () => void; newTake: (id: string, title: string) => void
  chooseBlueprint: (id: string | null) => void; select: (id: string) => void
  prepare: (id: string) => void; closeSetupIntent: () => void
}>()(persist(set => ({
  blueprintPlanId: null, selected: null, setupRequested: false, view: 'library', previousTake: null,
  home: () => set({ view: 'library', setupRequested: false }),
  record: () => set({ view: 'record', setupRequested: true }),
  newTake: (id, title) => set({ previousTake: { id, title }, view: 'record', setupRequested: true }),
  chooseBlueprint: blueprintPlanId => set({ blueprintPlanId }),
  select: selected => set({ selected, view: 'mix', setupRequested: false }),
  prepare: blueprintPlanId => set({ blueprintPlanId, previousTake: null, view: 'record', setupRequested: true }),
  closeSetupIntent: () => set({ setupRequested: false }),
}), { name: 'wisp.mixesNavigation', storage: createJSONStorage(() => ({
  getItem: key => { try { return sessionStorage.getItem(key) } catch { return null } },
  setItem: (key, value) => { try { sessionStorage.setItem(key, value) } catch { /* Navigation still works in memory; no review data is stored here. */ } },
  removeItem: key => { try { sessionStorage.removeItem(key) } catch { /* Optional navigation preference only. */ } },
})), partialize: state => ({ view: state.view, selected: state.selected }) }))

export function formatTrackStart(seconds: number): string {
  const centiseconds = Math.round(seconds * 100)
  return `${Math.floor(centiseconds / 360000)}:${String(Math.floor(centiseconds / 6000) % 60).padStart(2, '0')}:${(centiseconds % 6000 / 100).toFixed(2).padStart(5, '0')}`
}
export function parseTrackStart(text: string): number | null {
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/.test(text.trim())) return null
  const parts = text.trim().split(':').map(Number)
  const seconds = parts.reduce((total, part) => total * 60 + part, 0)
  return Number.isFinite(seconds) ? seconds : null
}
