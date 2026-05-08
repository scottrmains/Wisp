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

export interface TrackSnapshot {
  filePath: string
  fileName: string
  artist: string | null
  title: string | null
  version: string | null
  album: string | null
  genre: string | null
}

export type CleanupChangeKind =
  | 'StripJunk'
  | 'TitleCase'
  | 'ExtractVersion'
  | 'RenameFile'
  | 'TrimWhitespace'

export interface CleanupChange {
  kind: CleanupChangeKind
  field: string
  description: string
  before: string
  after: string
}

export interface CleanupSuggestion {
  trackId: string
  before: TrackSnapshot
  after: TrackSnapshot
  changes: CleanupChange[]
  hasChanges: boolean
}

export type CleanupAction = 'Cleanup' | 'Undo'
export type CleanupStatus = 'Applied' | 'RolledBack' | 'Failed'

export interface AuditEntry {
  id: string
  trackId: string
  action: CleanupAction
  status: CleanupStatus
  failureReason: string | null
  filePathBefore: string
  filePathAfter: string
  createdAt: string
}

export interface SystemInfo {
  version: string
  appDataDir: string
  databasePath: string
  logsDir: string
  configPath: string
  environment: string
}

export type CatalogSource = 'Spotify' | 'Discogs' | 'YouTube'

export interface ArtistSummary {
  id: string
  name: string
  trackCount: number
  latestLocalYear: number | null
  newReleaseCount: number
  isMatchedSpotify: boolean
  isMatchedDiscogs: boolean
  isMatchedYouTube: boolean
  lastCheckedAt: string | null
}

export interface ArtistCandidate {
  source: string
  externalId: string
  name: string
  followers: number | null
  genres: string[]
  imageUrl: string | null
}

export type ReleaseType = 'Album' | 'Single' | 'Ep' | 'Remix' | 'Compilation' | 'AppearsOn' | 'Unknown'

export interface ExternalRelease {
  id: string
  artistProfileId: string
  source: string
  externalId: string
  title: string
  releaseType: ReleaseType
  releaseDate: string | null
  url: string | null
  artworkUrl: string | null
  isAlreadyInLibrary: boolean
  matchedLocalTrackId: string | null
  isDismissed: boolean
  isSavedForLater: boolean
  youTubeVideoId: string | null
  youTubeUrl: string | null
  fetchedAt: string
}

export type DiscoverySourceType = 'YouTubeChannel' | 'YouTubePlaylist'

export interface DiscoverySource {
  id: string
  name: string
  sourceType: DiscoverySourceType
  sourceUrl: string
  externalSourceId: string
  addedAt: string
  lastScannedAt: string | null
  importedCount: number
}

export type DiscoveryStatus =
  | 'New'
  | 'Want'
  | 'AlreadyHave'
  | 'Ignore'
  | 'NoMatch'
  | 'VinylOnly'
  | 'DigitalAvailable'
  | 'PossibleMatch'

export interface DiscoveredTrack {
  id: string
  discoverySourceId: string
  sourceVideoId: string
  sourceUrl: string
  rawTitle: string
  thumbnailUrl: string | null
  parsedArtist: string | null
  parsedTitle: string | null
  mixVersion: string | null
  releaseYear: number | null
  status: DiscoveryStatus
  isAlreadyInLibrary: boolean
  matchedLocalTrackId: string | null
  importedAt: string
  lastMatchedAt: string | null
}

export type MatchAvailability =
  | 'Unknown'
  | 'StreamingOnly'
  | 'DigitalPurchase'
  | 'PhysicalOnly'
  | 'Unavailable'
  | 'SearchLink'

export interface DigitalMatch {
  id: string
  source: string
  url: string
  artist: string
  title: string
  version: string | null
  year: number | null
  availability: MatchAvailability
  confidenceScore: number
  matchedAt: string
}

export interface DiscoveredTrackPage {
  total: number
  page: number
  size: number
  items: DiscoveredTrack[]
}

export interface DiscoveryScanProgress {
  sourceId: string
  status: 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Cancelled'
  totalImported: number
  newItems: number
  parsedConfidently: number
  error: string | null
}

export interface SoulseekSearchHit {
  username: string
  filename: string
  size: number
  bitRate: number | null
  sampleRate: number | null
  bitDepth: number | null
  length: number | null
  locked: boolean
  uploadSpeed: number
  queueLength: number
  hasFreeUploadSlot: boolean
}

export interface SoulseekSearchResult {
  id: string
  isComplete: boolean
  responseCount: number
  hits: SoulseekSearchHit[]
}

export interface SoulseekTransfer {
  id: string
  username: string
  filename: string
  size: number
  bytesTransferred: number
  percentage: number
  state: string
  startedAt: string | null
  endedAt: string | null
}
