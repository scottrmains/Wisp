export type ScanStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Cancelled'

export interface Track {
  id: string
  filePath: string
  fileName: string
  artist: string | null
  title: string | null
  version: string | null
  album: string | null
  genre: string | null
  bpm: number | null
  musicalKey: string | null
  energy: number | null
  releaseYear: number | null
  durationSeconds: number
  isMissingMetadata: boolean
  isDirtyName: boolean
  addedAt: string
  lastScannedAt: string | null
}

export interface TrackPage {
  items: Track[]
  total: number
  page: number
  size: number
}

export interface ScanJob {
  id: string
  folderPath: string
  status: ScanStatus
  error: string | null
  totalFiles: number
  scannedFiles: number
  addedTracks: number
  updatedTracks: number
  removedTracks: number
  skippedFiles: number
  startedAt: string
  completedAt: string | null
}

export interface ScanProgress {
  scanJobId: string
  status: ScanStatus
  totalFiles: number
  scannedFiles: number
  addedTracks: number
  updatedTracks: number
  removedTracks: number
  skippedFiles: number
  error: string | null
}

export interface TrackQuery {
  search?: string
  key?: string
  bpmMin?: number
  bpmMax?: number
  energyMin?: number
  energyMax?: number
  missing?: boolean
  sort?: string
  page?: number
  size?: number
}

export type RecommendationMode =
  | 'Safe'
  | 'EnergyUp'
  | 'EnergyDown'
  | 'SameVibe'
  | 'Creative'
  | 'Wildcard'

export interface Recommendation {
  track: Track
  total: number
  keyScore: number
  bpmScore: number
  energyScore: number
  genreScore: number
  penalties: number
  reasons: string[]
}

export interface MixPlanSummary {
  id: string
  name: string
  notes: string | null
  trackCount: number
  createdAt: string
  updatedAt: string
}

export interface MixPlanTrack {
  id: string
  trackId: string
  order: number
  cueInSeconds: number | null
  cueOutSeconds: number | null
  transitionNotes: string | null
  track: Track
}

export interface MixPlan {
  id: string
  name: string
  notes: string | null
  createdAt: string
  updatedAt: string
  tracks: MixPlanTrack[]
}

export type CuePointType =
  | 'FirstBeat'
  | 'Intro'
  | 'MixIn'
  | 'Breakdown'
  | 'Drop'
  | 'VocalIn'
  | 'MixOut'
  | 'Outro'
  | 'Custom'

export interface CuePoint {
  id: string
  trackId: string
  timeSeconds: number
  label: string
  type: CuePointType
  isAutoSuggested: boolean
  createdAt: string
}
