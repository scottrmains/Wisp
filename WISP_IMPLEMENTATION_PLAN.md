# Wisp — Implementation Plan

> Local-first DJ prep assistant. Turns a chaotic folder of analysed tracks into a smart, playable mix plan.
> Source spec: `DJ_Mix_Assistant_Technical_Brief.docx`.

---

## Stack (committed)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind | |
| UI state | Zustand | Mix chain, transient UI |
| Server state | TanStack Query | All API calls |
| Drag & drop | dnd-kit | Mix chain reorder, library → chain |
| Tables | TanStack Table + virtualization | Library can grow large |
| Audio | Web Audio API | NOT NAudio — Web Audio gives GainNodes/crossfades natively |
| Waveform | OfflineAudioContext for peaks (no extra dep) → peaks.js if needed later | |
| Backend | ASP.NET Core 9 Minimal API | |
| ORM | EF Core 9 + SQLite | |
| Tagging | **TagLibSharp2** (maintained fork) | Not original TagLib# |
| Background work | `IHostedService` + `Channel<T>` queue | Avoid Hangfire for v1 |
| File decoding (later) | FFmpeg sidecar binary | Ship, do not require pre-install |
| Logging | Serilog → rolling file in app data | |
| Desktop shell | **Photino.NET (WebView2 on Windows)** | Single .NET process hosts the API and the embedded WebView2 window |

### Shell architecture
A single `Wisp.Api` process is the entry point. At startup it:
1. Boots Kestrel on a free localhost port and serves both `/api/*` and the built React `dist/` (with SPA fallback).
2. Opens a `PhotinoWindow` pointed at that local URL.
3. Exposes a small JS↔.NET bridge (`window.wisp.invoke('pickFolder')` etc.) for native dialogs that the browser can't do alone.
4. Shuts down Kestrel when the window closes.

No Node runtime in production. No two-process orchestration. WebView2 runtime ships with Windows 11 and on Win10 via the evergreen bootstrapper.

---

## Phase 0 — Bootstrap ✅

**Goal:** Empty shell that runs the API, serves the React UI, and migrates an empty SQLite DB.

- [x] Create solution layout:
  ```
  Wisp/
    src/
      Wisp.Api/            ASP.NET Core minimal API + Photino host
      Wisp.Core/           Domain types, scoring, no I/O
      Wisp.Infrastructure/ EF Core, file system, TagLib, audio
      Wisp.Client/         React + Vite
    tests/
      Wisp.Core.Tests/
      Wisp.Infrastructure.Tests/
  ```
- [x] `Wisp.Api`: minimal API, OpenAPI on, CORS for `localhost:5173` in Development only
- [x] Add `Photino.NET` package to `Wisp.Api`; wire `PhotinoWindow` startup after Kestrel binds a free port — fixed-port (5125) instead of "free port" for predictability; STA threading enforced via fire-and-forget Kestrel
- [x] JS↔.NET bridge: `window.wisp.invoke(method, args)` mapped to `PhotinoWindow.RegisterWebMessageReceivedHandler`. First method: `pickFolder` (uses Photino's built-in `ShowOpenFolder` — no WinForms/WinRT needed)
- [x] `Wisp.Client`: Vite + React + TS + Tailwind + ESLint + Prettier
- [x] Vite dev proxy `/api → http://localhost:5125` (now `127.0.0.1` — WebView2 reliability)
- [x] EF Core: `WispDbContext`, initial empty migration, SQLite at `%LOCALAPPDATA%\Wisp\wisp.db`
- [x] Settings file at `%LOCALAPPDATA%\Wisp\config.json` (last folder, window size, etc.) — atomic write + bounds-checked load
- [x] Serilog: console in Dev, rolling file `%LOCALAPPDATA%\Wisp\logs\wisp-.log`
- [x] Health endpoint `GET /api/health`
- [x] Dev workflow: three launch profiles (`Dev`, `Shell`, `DevShell`). **Bonus:** `DevShell` profile spawns Vite as a sidecar from the .NET process and points Photino at it — single F5 launches API + Vite + Photino window with HMR. Root `npm run dev` / `npm run shell` / `npm run devshell` mirror the profiles.
- [x] Production build: `npm run build` → outputs to `Wisp.Api/wwwroot/`; `dotnet publish` MSBuild target chains the npm build; Kestrel serves with `UseStaticFiles` + SPA fallback; Photino opens `http://127.0.0.1:{port}`
- [ ] WebView2 runtime check on first run; surface a friendly download link if missing (Win10 only — Win11 has it built in) — *deferred; Win11 ships it, will revisit when packaging in Phase 7*
- [ ] Commit baseline, tag `v0.0.0` — *staged but not yet committed*

**Done when:** running `Wisp.Api` (Release) opens a Photino window showing the React shell, which calls `/api/health` and gets 200. ✅

---

## Phase 1 — Library scanner ✅

**Goal:** Pick a folder → see a table of tracks with BPM/key/energy from Mixed in Key tags.

### Backend
- [x] `Track` entity (per spec §10.1) + EF migration — added `int? ReleaseYear` beyond the spec for Phase 8
- [x] `ScanJob` entity (id, folder, status, counts, started/finished) — also tracks `SkippedFiles`
- [x] `IFileScanner`: recursive enumerate `.mp3 .flac .wav .aiff .aif .m4a .ogg .opus`
- [x] File fingerprint: SHA-256 of first 1 MiB + last 1 MiB + size (fast, stable for renames)
- [x] `IMetadataReader` (**TagLibSharp** v2.3.0 — actual NuGet name; "TagLibSharp2" was the planning placeholder):
  - Standard tags: artist, title, album, genre, duration
  - **Mixed in Key compatibility**: reads `INITIALKEY`/`TKEY`, `TBPM`, energy from custom TXXX frames (`EnergyLevel`, `ENERGY`, `Mixed In Key - Energy`) and from comment field
  - Fallback to filename parsing when tags absent
- [x] Scan pipeline as a `BackgroundService` consuming a `Channel<ScanRequest>` — single-reader (one scan at a time, queues the rest)
- [x] Diff existing rows by hash → insert new / update changed / **hard-delete** removed *(soft-delete deferred until Phase 3/5 add cue/plan FK refs that need preserving)*
- [x] API:
  - `POST /api/library/scan` body `{ folderPath }` → returns `scanJobId`
  - `GET  /api/library/scan/{id}` → progress
  - `GET  /api/tracks?search=&key=&bpmMin=&bpmMax=&energyMin=&energyMax=&missing=&page=&size=&sort=` (split energy into min/max)
  - `GET  /api/tracks/{id}`
- [x] Progress stream — chose **SSE** over SignalR (one less dep) at `GET /api/library/scan/{id}/events` via `ScanProgressBus` in-memory pub/sub

### Frontend
- [x] Folder picker — `bridge.pickFolder()` wired through `useScan()` hook
- [x] `LibraryTable` with TanStack Table + TanStack Virtual
- [x] Columns: Artist, Title, Version, BPM, Key, Energy, Genre, Duration, File
- [x] Filters: search box, BPM range, key, missing-metadata toggle *(energy filter is API-side only; UI not yet exposed — small follow-up)*
- [ ] Status row showing `last scanned · n tracks` — *partial: track count shown, "last scanned" timestamp not yet*
- [x] Scan progress toast subscribing to the SSE stream (queued / scanning N/M / added/updated/removed/skipped + progress bar)
- [x] Empty state w/ "Pick a folder" CTA

### Tests
- [x] Filename parser unit tests (`Artist - Title (Extended Mix) [Label] 320kbps.mp3`, underscored, leading track no., low-confidence cases, year-in-loose-text)
- [x] Hash function: same bytes at two paths → same hash; large files differ on tail-only changes; idempotent on repeat
- [x] Scan integration tests (in-test temp dirs with synthetic mp3 bytes — empty / add / idempotent / removed-detection / unreadable-skip). 16/16 passing. *(Did not create the persistent `tests/fixtures/audio/` folder — synthetic bytes + filename fallback covers the same paths without committing binary fixtures.)*

**Done when:** spec acceptance criterion 1 — pick folder, see tracks with BPM/key/energy. ✅ (verified live against Pioneer demo tracks)

---

## Phase 2 — Recommendation engine ✅

**Goal:** Select a track → ranked list of compatible tracks with reasons.

- [x] `Camelot` value type: parse `8A`/`12B`, expose `.Adjacent`, `.RelativeMajorMinor`, `.PerfectFifthUp/Down`, `.RelationTo()` returning `KeyRelation { SameKey, Adjacent, RelativeMajorMinor, Creative, Distant }` with wheel wrap-around
- [x] `BpmCompatibility`: handles half/double-time. Returns `BpmScore { Points, Relation: Same|Half|Double, EffectiveDistance }`. Half/double matches scored at 0.85× of same-tempo
- [x] `RecommendationMode` enum: Safe, EnergyUp, EnergyDown, SameVibe, Creative, Wildcard
- [x] `RecommendationService.Score(seed, candidate, mode)` returns `RecommendationScore { Total, KeyScore, BpmScore, EnergyScore, GenreScore, Penalties, Reasons[] }`
  - Reasons are human-readable: `"Adjacent key (8A → 9A)"`, `"BPM diff 1 (125 ↔ 124)"`, `"Energy +1 (7 → 8)"`, `"Genre match (house)"`, `"Same artist (Solomun)"`
- [x] Genre similarity: token overlap on normalized genre string; SameVibe mode doubles weight
- [x] Penalty rules: same-artist back-to-back applies `-10`. Recently-used penalty deferred to Phase 3 (needs MixPlan history first)
- [x] API: `GET /api/tracks/{id}/recommendations?mode=Safe&limit=50`
- [x] Frontend: `RecommendationPanel`
  - Slide-in panel from the right when a library row is clicked
  - Score badge (color-coded green/amber/grey by total)
  - Mode pill selector at top (Safe / Energy ↑ / Energy ↓ / Same vibe / Creative / Wildcard)
  - Per-row "Why?" toggle expanding to reason chips
  - "Add to chain" button — *deferred until Phase 3 (no chain exists yet)*
- [ ] Settings: weights overridable in `config.json` for power users — *deferred; current weights match the spec and feel right against real library data*

### Tests
- [x] Camelot adjacency: parsing, same/adjacent/relative/creative/distant, wheel wrap (12A ↔ 1A), all 24 cells covered
- [x] BPM scoring: boundaries at 1, 2, 4, 6 BPM diffs; half-time and double-time matches; same-tempo prefers over half when both close
- [x] Mode behaviour: EnergyUp ranks `+2` above `-2`; EnergyDown inverts; same-artist penalty applies; SameVibe doubles genre weight; Rank skips seed and zero-score candidates

**Done when:** spec acceptance criterion 2 — open recommendations, ranked list with reasons. ✅ (verified live: Janet Rushmore — Try My Love @ 125/5A/E7 returns 8 perfect-score matches)

---

## Phase 3 — Mix chain builder ✅

**Goal:** Drag tracks into an ordered plan; see key/BPM/energy flow.

- [x] `MixPlan` + `MixPlanTrack` entities (spec §10.3) + migration. Cascade delete from MixPlan; FK to Track also cascades on track removal
- [x] **Fractional ordering** (`Order` as `double`, midpoint inserts via `FractionalOrder.Between(before, after)`) — never reindexes; throws `InvalidOperationException` if precision collapses so the caller can rebalance
- [x] API:
  - `GET    /api/mix-plans` (list with `trackCount`)
  - `POST   /api/mix-plans` (create)
  - `GET    /api/mix-plans/{id}` (with tracks ordered)
  - `PATCH  /api/mix-plans/{id}` (rename/notes)
  - `DELETE /api/mix-plans/{id}`
  - `POST   /api/mix-plans/{id}/tracks` body `{ trackId, afterMixPlanTrackId? }` — null = append, `Guid.Empty` = head, specific id = after that
  - `PATCH  /api/mix-plans/{id}/tracks/{mptId}` (move + transition notes)
  - `DELETE /api/mix-plans/{id}/tracks/{mptId}`
- [x] Frontend:
  - [x] `ChainDock` — bottom-docked, collapsible. Horizontal card layout (better for set planning than vertical lists)
  - [x] dnd-kit `SortableContext` with `horizontalListSortingStrategy`. Drag handles + 5px activation distance to prevent accidental drags
  - [x] "Add to chain" `+` buttons in `LibraryTable` rows and `RecommendationPanel` rows (active when a plan is selected)
  - [x] `EnergyCurve` — SVG polyline of energy 1-10 across cards
  - [x] `KeyPathView` — Camelot pills with `→` between, `⚠` flag on bad transitions (anything beyond same / adjacent / relative major-minor)
  - [x] BPM delta strip between cards, color-coded green ≤2 / amber ≤6 / red beyond
  - [x] Inline `TransitionNotes` textarea per card, auto-saves on blur
  - [x] `PlanSwitcher` dropdown in header: list, switch active, create, delete. Active plan persisted in localStorage via Zustand

### Tests
- [x] `FractionalOrder.Between` — empty list, head, tail, midpoint, 50 nested left-inserts (no precision collapse), throws cleanly when neighbours are adjacent doubles
- *(Concurrent-edit test deferred — single-user local app, last-write-wins is fine)*

**Done when:** spec acceptance criterion 3 — drag a recommendation into the chain, order persists. ✅ (verified live: append-by-default + move-to-head + after-id move + notes update + delete all green)

---

## Phase 4 — Audio preview / blend

**Goal:** Two-deck preview with crossfade between adjacent chain tracks.

### Backend
- [ ] `GET /api/tracks/{id}/audio` — streams the file with **Range request** support and `ETag` (file hash)
- [ ] Content-Type from extension; for non-browser-friendly formats (FLAC in some browsers, AIFF, WAV variants), decode-on-the-fly to PCM/WebM via FFmpeg sidecar
- [ ] Detect FFmpeg presence at startup; surface a clear error if missing

### Frontend
- [ ] `useAudioDeck(trackId)` hook wrapping `AudioContext`
  - `AudioBufferSourceNode` per play (sources are one-shot — recreate on each play)
  - Or `MediaElementSource` if you want HTML5 streaming + seeking on long tracks (recommended for >5 min files)
- [ ] `DeckPreview` component: play/pause, seek, volume
- [ ] `Crossfader` — single slider feeding two `GainNode`s (equal-power curve)
- [ ] `WaveformView`:
  - Generate peaks via `OfflineAudioContext.decodeAudioData` on first load
  - Cache peaks JSON next to the track or in DB blob
  - Click waveform = seek
- [ ] Cue jump buttons appear once Phase 5 ships

### Tests
- [ ] Range request: server returns 206 with correct `Content-Range`
- [ ] Waveform peaks endpoint cached on second load (no recompute)

**Done when:** spec acceptance criterion 4 — open preview for two adjacent tracks, play both, crossfade works.

---

## Phase 5 — Cue helper

**Goal:** Manual cue points + phrase markers from BPM.

- [ ] `CuePoint` entity (spec §10.2) + migration
- [ ] API:
  - `GET    /api/tracks/{id}/cues`
  - `POST   /api/tracks/{id}/cues`
  - `PATCH  /api/cues/{id}`
  - `DELETE /api/cues/{id}`
- [ ] Phrase marker generator: given `firstBeatSec` and `BPM`, emit 16/32/64-beat markers as `IsAutoSuggested = true`
- [ ] Frontend: `CuePointEditor`
  - Click waveform → drop a cue at that time
  - Type dropdown (FirstBeat, Intro, MixIn, Breakdown, Drop, VocalIn, MixOut, Outro, Custom)
  - "Generate phrase markers" button (disabled until FirstBeat set)
  - Cue chips visible on `WaveformView` and `DeckPreview` timeline
- [ ] Cue jump on deck: hotkeys 1–8 jump to first 8 cues

### Tests
- [ ] Phrase math: at 126 BPM, 32-beat marker = 15.238s ± 1 ms
- [ ] Cue persists across track reload (acceptance §15.5)

**Done when:** spec acceptance criterion 5.

---

## Phase 6 — Metadata cleanup

**Goal:** Suggest cleaner names/tags. Never write without explicit approval. Always undoable.

- [ ] `MetadataAuditLog` entity: `TrackId, Timestamp, Action, BeforeJson, AfterJson, FilePathBefore, FilePathAfter`
- [ ] Dirty-name detector — regex blacklist for `320kbps`, `\(copy\)`, `\(final\)`, `free download`, blog/site names, etc.
- [ ] Title-case normalizer (preserve `VIP`, `(Extended Mix)`, `(Remix)`, `(Dub)`, `(Club Mix)`, etc.)
- [ ] `CleanupSuggestionService.Suggest(trackId)` returns `{ before, after, changes[] }`
- [ ] API:
  - `GET  /api/tracks/{id}/cleanup`        (preview)
  - `POST /api/tracks/{id}/cleanup/apply`  (write tags + rename, with audit log)
  - `POST /api/cleanup/audit/{id}/undo`    (best-effort revert)
- [ ] Atomic writes:
  - Tag write: TagLibSharp2 → `Save()` to a temp copy → swap (avoid corruption mid-write)
  - File rename: `File.Move(srcPath, tempPath)` → `File.Move(tempPath, finalPath)`
  - On failure, restore from `BeforeJson`
- [ ] Backup the SQLite file before any cleanup-batch operation
- [ ] Frontend: `MetadataCleanupModal`
  - Side-by-side diff (before/after) for tags and filename
  - Per-change checkboxes
  - "Apply", "Apply all matching", "Undo" buttons
  - Audit log view

### Tests
- [ ] Cleanup is **idempotent** (running twice on a clean track = no-op)
- [ ] Rollback restores original filename + tags exactly
- [ ] Junk-token regex doesn't strip useful tokens (`VIP Mix`, `320 BPM` track titles)

**Done when:** spec acceptance criterion 6 — approve a cleanup, action is logged and undoable.

---

## Phase 7 — Packaging & polish

- [ ] Splash / first-run flow: pick a folder, run a scan
- [ ] Settings screen: scoring weights, default mode, FFmpeg path override, audio device
- [ ] Export: `M3U`, `CSV`, `JSON` (Rekordbox XML later — see §17)
- [ ] App icon, window chrome
- [ ] `npm run build` then `dotnet publish -r win-x64 -c Release --self-contained` → single folder containing `Wisp.exe`, `wwwroot/`, native runtimes
- [ ] Installer: Velopack (preferred — handles delta updates) or Inno Setup as a simpler fallback
- [ ] WebView2 evergreen bootstrapper bundled or downloaded on first run for Win10 targets
- [ ] Crash handler writes to log + offers to open log folder
- [ ] First-run DB migration runner (don't crash on schema upgrades)
- [ ] Optional code signing (later)

---

## Phase 8 — Artist Refresh / Rediscover (post-MVP)

**Goal:** Surface what the artists already in your library have released since your newest local track of theirs. *"I've been away for years — what did I miss?"*

> **Explicitly post-MVP.** Don't start until Phases 0–6 ship. External catalog APIs add auth, rate limits, secrets, and artist-matching ambiguity that will derail the core mix-prep flow if they land too early.

### Why this is a strong angle for Wisp
The library already knows which artists you care about and roughly when you stopped buying them. Most "discovery" tools start cold — Wisp can start from your taste history and just tell you what you missed.

### Data model

```csharp
public class ArtistProfile
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";

    public string? SpotifyArtistId { get; set; }
    public string? MusicBrainzArtistId { get; set; }
    public string? DiscogsArtistId { get; set; }

    public DateTime? LastCheckedAt { get; set; }
}

public class ExternalRelease
{
    public Guid Id { get; set; }
    public Guid ArtistProfileId { get; set; }

    public string Source { get; set; } = "";    // Spotify | MusicBrainz | Discogs
    public string ExternalId { get; set; } = "";

    public string Title { get; set; } = "";
    public string? ReleaseType { get; set; }    // Album | Single | EP | Remix | Compilation | AppearsOn
    public DateOnly? ReleaseDate { get; set; }

    public string? Url { get; set; }
    public string? ArtworkUrl { get; set; }

    public bool IsAlreadyInLibrary { get; set; }
    public bool IsDismissed { get; set; }
    public bool IsSavedForLater { get; set; }
}
```

> **Phase 1 dependency:** ensure `Track` carries `int? ReleaseYear` (read from `TDRC` / `TYER` / `Year` tags). Cheap to add now; required to compute "latest local track per artist" in Phase 8a.

### Architecture

```
Wisp.Infrastructure/
  ExternalCatalog/
    ICatalogClient.cs                       Source-agnostic interface
    Spotify/SpotifyCatalogClient.cs         OAuth client_credentials, token cache
    MusicBrainz/MusicBrainzCatalogClient.cs 1 req/sec, custom User-Agent required
    Discogs/DiscogsCatalogClient.cs         Personal access token
    ArtistMatcher.cs                        Name → candidate artists with confidence
    ReleaseNormalizer.cs                    Cross-source dedupe; remix/compilation tagging
    LibraryOverlap.cs                       "Is this release already in my library?"
```

Catalog credentials live in `%LOCALAPPDATA%\Wisp\config.json` under `Catalog:Spotify:ClientId/Secret`, `Catalog:Discogs:Token`, etc. A Settings panel lets the user paste keys. Plain JSON is fine for a single-user local app — be explicit in the UI that they're not vaulted.

### Phase 8a — MVP of the feature (Spotify only)

- [ ] `ArtistProfile` + `ExternalRelease` entities + EF migration
- [ ] Confirm `Track.ReleaseYear` exists (added during Phase 1 if not)
- [ ] Background job: extract distinct artists from `Track`, dedupe on normalized name
- [ ] `SpotifyCatalogClient`:
  - [ ] `client_credentials` OAuth flow with token cache + refresh
  - [ ] `GET /v1/search?type=artist&q=...` → candidate artists
  - [ ] `GET /v1/artists/{id}/albums?include_groups=album,single,appears_on` with paging
  - [ ] Respect `429 Retry-After`
- [ ] **Artist disambiguation UI** — when Spotify returns >1 candidate, show a picker (avatar + genre tags + follower count). Persist the chosen `SpotifyArtistId` on `ArtistProfile`. **Never auto-link a low-confidence match** — that's how the feature loses trust.
- [ ] Refresh job per artist (cap one in flight, queue the rest):
  - [ ] Fetch releases since `max(Track.ReleaseYear) - 1` for that artist (fallback: last 10 years if no year data)
  - [ ] `LibraryOverlap` flags releases whose normalized title already appears in local tracks
- [ ] API:
  - `GET   /api/artists` — every distinct local artist + `{ trackCount, latestLocalYear, newReleaseCount }`
  - `GET   /api/artists/{id}/match-candidates?source=spotify`
  - `POST  /api/artists/{id}/match` body `{ source, externalId }`
  - `POST  /api/artists/{id}/refresh` (queue a fetch)
  - `GET   /api/artists/{id}/releases?status=new|dismissed|saved`
  - `PATCH /api/releases/{id}` body `{ isDismissed?, isSavedForLater? }`
- [ ] Frontend: `RediscoverScreen`
  - [ ] Artist list with `tracks · latest local · N new releases` per row
  - [ ] Click an artist → split view: "You have" (local tracks) | "Latest releases" (external)
  - [ ] Per-release actions: **Interested** / **Dismissed** / **Already have**
  - [ ] External link out — add new bridge method `bridge.openExternal(url)` (Photino has `OpenExternalUrl` or shell out via `Process.Start`)
- [ ] Settings panel: paste Spotify Client ID / Secret; "Test connection" button
- [ ] Empty state when API keys missing — clear "add a key in Settings" CTA

### Phase 8b — Catalog breadth

- [ ] MusicBrainz client (free, no auth — but requires polite `User-Agent: Wisp/1.0 (contact-email)` and 1 req/sec rate limit)
- [ ] Discogs client (personal access token; much better than Spotify for 90s/00s house, vinyl-only EPs, remixes)
- [ ] `ReleaseNormalizer` cross-source dedupe (same release on Spotify + Discogs collapses into one card)
- [ ] Source badges per release (S / MB / D)
- [ ] **Beatport — deferred indefinitely.** Their developer portal is gated and access is awkward; don't block the feature on it. Track separately.

### Phase 8c — Taste-aware filtering

The version that makes this feature actually special, not just a discography crawl.

- [ ] Compute a "taste profile" per artist from local tracks: BPM range, dominant Camelot keys, energy range, genre tokens
- [ ] For each surfaced release, fetch analysis (Spotify Audio Features → tempo/key/energy proxies; MusicBrainz/Discogs lack these)
- [ ] Rank releases by similarity to the taste profile
- [ ] UI: "Newer MK-related releases that fit your library" header above the filtered list (vs. raw discography below)

### Tests
- [ ] Spotify client: golden-file replay of paged `/albums` response (no live calls in CI)
- [ ] Token refresh: expired token triggers a single re-auth, not a stampede
- [ ] Rate limiter: `429` + `Retry-After` is respected; concurrent calls back off
- [ ] `ArtistMatcher`: ambiguous names ("MK", "Sonic") return >1 candidate, never auto-pick
- [ ] `LibraryOverlap`: title normalization handles `(Extended Mix)`, `feat. X`, remixer-as-artist, `Various Artists` compilations

### Risks & guardrails
- **Artist matching is the hard bit.** Names like `MK` ↔ `Marc Kinchen` ↔ `MK & Sonny Fodera` will silently mismatch. Require user confirmation; never auto-link below a high confidence threshold.
- **Rate limits.** Cap concurrent requests per source. Persist `ArtistProfile.LastCheckedAt` and skip artists refreshed within N days unless the user forces.
- **Spotify catalog gaps.** A lot of underground house / vinyl-only releases simply aren't on Spotify. That's why MusicBrainz + Discogs matter for Phase 8b — Spotify alone will undersell exactly the kind of artists this feature is built for.
- **Secrets storage.** Plain JSON in `%LOCALAPPDATA%\Wisp\config.json` is acceptable for a personal app; surface this clearly in Settings.

**Done when:** for at least one matched artist, the user sees a list of releases newer than their newest local track for that artist, and can mark each as Interested / Dismissed / Already have.

---

## Phase 9 — Crate Digger (post-MVP)

**Goal:** Turn curated YouTube channels (e.g. Rok Torkar) into a structured *want list* — import public video metadata, parse likely track names, preview in-app, check legitimate digital availability.

> **Originally pitched as "Phase 8" — bumped to 9 because Artist Refresh already holds the 8 slot.** Both are post-MVP and share an `ExternalCatalog` module; whichever ships first builds the Discogs / MusicBrainz clients, the other inherits them. Swap the numbering if you'd rather Crate Digger ship first.

### Product promise
> *"Find old-school tunes from curated YouTube channels, preview them in-app, and check where you can legally get them."*

### What this is *not*
- **Not** a YouTube downloader, ripper, or audio extractor.
- **Not** a Web Audio source — YouTube previews stay in the embedded iframe player. Crossfading, waveforms, and cue points apply only to local files. Once the user buys a tune and rescans, it becomes a normal local track and gets the full treatment.
- **Not** a YouTube alternative; only an indexing layer over **public** metadata.

UI/copy/docs/about-page wording must consistently say *import metadata*, *preview embedded*, *check digital availability*. Never *download*, *rip*, *stream audio-only*, *extract*.

### Data model

```csharp
public enum DiscoverySourceType { YouTubeChannel, YouTubePlaylist }

public class DiscoverySource
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public DiscoverySourceType SourceType { get; set; }
    public string SourceUrl { get; set; } = "";
    public string? ExternalSourceId { get; set; }
    public DateTime AddedAt { get; set; }
    public DateTime? LastScannedAt { get; set; }
    public int ImportedCount { get; set; }
}

public enum DiscoveryStatus
{
    New, Want, AlreadyHave, Ignore,
    NoMatch, VinylOnly, DigitalAvailable, PossibleMatch
}

public class DiscoveredTrack
{
    public Guid Id { get; set; }
    public Guid DiscoverySourceId { get; set; }

    public string SourceVideoId { get; set; } = "";
    public string SourceUrl { get; set; } = "";

    public string RawTitle { get; set; } = "";
    public string? Description { get; set; }
    public string? ThumbnailUrl { get; set; }

    public string? ParsedArtist { get; set; }
    public string? ParsedTitle { get; set; }
    public string? MixVersion { get; set; }
    public int? ReleaseYear { get; set; }

    public DiscoveryStatus Status { get; set; }
    public bool IsAlreadyInLibrary { get; set; }
    public Guid? MatchedLocalTrackId { get; set; }

    public DateTime ImportedAt { get; set; }
    public DateTime? LastMatchedAt { get; set; }
}

public enum MatchAvailability
{
    Unknown, StreamingOnly, DigitalPurchase, PhysicalOnly, Unavailable
}

public class DigitalMatch
{
    public Guid Id { get; set; }
    public Guid DiscoveredTrackId { get; set; }
    public string Source { get; set; } = "";   // Discogs | MusicBrainz | Traxsource | Juno | Beatport | Bandcamp | Spotify
    public string ExternalId { get; set; } = "";
    public string Url { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Version { get; set; }
    public string? Label { get; set; }
    public int? Year { get; set; }
    public MatchAvailability Availability { get; set; }
    public int ConfidenceScore { get; set; }
    public DateTime MatchedAt { get; set; }
}
```

### Architecture

```
Wisp.Infrastructure/
  ExternalCatalog/                          (shared with Phase 8)
    Spotify/SpotifyCatalogClient.cs
    MusicBrainz/MusicBrainzCatalogClient.cs
    Discogs/DiscogsCatalogClient.cs
  Discovery/
    YouTubeDiscoveryService.cs              YouTube Data API v3 client
    UrlNormalizer.cs                        Channel URL → canonical channelId
    TrackTitleParser.cs                     "Artist - Title (Mix) Year" → structured
    LocalLibraryMatcher.cs                  DiscoveredTrack ↔ Track
    DigitalAvailabilityService.cs           Orchestrator + scoring + classification

Wisp.Client/src/features/crate-digger/
    CrateDiggerPage.tsx
    DiscoverySourceList.tsx
    AddDiscoverySourceModal.tsx
    DiscoveredTrackTable.tsx
    DiscoveredTrackDetailPanel.tsx
    YouTubePreviewEmbed.tsx                 Plain iframe; no JS-API needed for v1
    DigitalMatchList.tsx
    AvailabilityBadge.tsx
    ParseCorrectionForm.tsx
    DiscoveryStatusButtons.tsx
```

### Phase 9a — Import + parse + preview (YouTube only)

- [ ] `DiscoverySource` + `DiscoveredTrack` entities + EF migration
- [ ] YouTube Data API v3 key in `Catalog:YouTube:ApiKey` (Settings UI + "Test connection")
- [ ] `UrlNormalizer`: handle `@handle`, `/channel/UCxxx`, `/c/customUrl`, `/user/legacyName`, `/playlist?list=PLxxx`. Persist canonical `ExternalSourceId` so channel renames don't break the source.
- [ ] `YouTubeDiscoveryService`:
  - [ ] `channels.list?forHandle=` / `forUsername=` to resolve handle → channel ID
  - [ ] `playlistItems.list` against the channel's "uploads" playlist (the cheap path), paged
  - [ ] Persist `videoId`, `publishedAt`, `title`, `description`, `thumbnails.high.url`
  - [ ] Skip already-imported `videoId`s on rescan (incremental)
  - [ ] Quota awareness — free tier is 10,000 units/day; `playlistItems.list` ≈ 1 unit per page of 50. Back off on `quotaExceeded`.
- [ ] `TrackTitleParser`:
  - [ ] Strip `[ ]` / `( )` content into a "version" candidate
  - [ ] Detect 4-digit year `19xx` / `20xx`
  - [ ] Recognise mix tokens: `Original Mix`, `Extended Mix`, `Dub`, `Vocal Mix`, `Club Mix`, `VIP`, `Remix`, `Bootleg`
  - [ ] Strip channel-noise tokens: `Free Download`, `[FREE DL]`, `HQ`, `320kbps`, `[FULL]`
  - [ ] Confidence flag — low when no `-` separator or no recognisable structure
- [ ] API:
  - `POST /api/discovery/sources` body `{ name, sourceType, sourceUrl }`
  - `GET  /api/discovery/sources`
  - `POST /api/discovery/sources/{id}/scan`
  - `GET  /api/discovery/sources/{id}/tracks?status=&search=&availability=&page=&size=&sort=`
  - `GET  /api/discovery/tracks/{id}`
  - `POST /api/discovery/tracks/{id}/parse` body `{ artist, title, version, year }` — manual override
  - `POST /api/discovery/tracks/{id}/status` body `{ status }`
- [ ] Frontend: `CrateDiggerPage`
  - [ ] Source list + "Add source" modal
  - [ ] `DiscoveredTrackTable` (TanStack Table + virtualization)
  - [ ] `DiscoveredTrackDetailPanel` w/ `YouTubePreviewEmbed` (`<iframe src="https://www.youtube.com/embed/{videoId}">`)
  - [ ] Graceful fallback when a video disables embedding — show "Open on YouTube" button
  - [ ] `ParseCorrectionForm` — manual fix for low-confidence parses
  - [ ] `DiscoveryStatusButtons` — Want / Already Have / Ignore

### Phase 9b — Local library matching

- [ ] `LocalLibraryMatcher`:
  - [ ] Normalize artist + title + version (strip punctuation, lowercase, fold accents, drop junk tokens)
  - [ ] Fuzzy match against `Track` (token-set ratio or Levenshtein with thresholds)
  - [ ] Set `IsAlreadyInLibrary` and `MatchedLocalTrackId`
- [ ] "In your library" badge on rows + "Open in library" link in detail panel
- [ ] Suggest status `AlreadyHave` for high-confidence matches — but require user click. Same trust principle as Phase 8: never auto-write.

### Phase 9c — Digital availability

- [ ] `DigitalAvailabilityService` orchestrator
- [ ] Reuse `DiscogsCatalogClient` + `MusicBrainzCatalogClient` from Phase 8 (or build them here if 9 ships first)
- [ ] Confidence scoring (per spec):
  - Artist exact `+40`, Title exact `+40`, Version exact `+20`, Year close `+10`, Label match `+10`, Duration close `+10`, Different version `-20`, Different artist `-40`
  - Bands: `90+` Strong, `70+` Possible, `50+` Weak, `<50` ignore unless manually reviewed
- [ ] Persist `DigitalMatch` rows with source, URL, score, availability classification
- [ ] API: `POST /api/discovery/tracks/{id}/match` (queues a match run)
- [ ] Frontend: `DigitalMatchList` with `AvailabilityBadge` per row + external link out (uses `bridge.openExternal`)
- [ ] **Search-link fallback** for stores without easy API access (Traxsource, Juno, Beatport, Bandcamp): build a deep search URL from parsed `artist + title` and surface as `Search Beatport` / `Search Juno` buttons. No API required for v1 — a clickable hand-off is genuinely useful on its own.

### Phase 9d — Catalog breadth (later)

- [ ] Traxsource API (if available — otherwise stay with search links)
- [ ] Juno Download (search links → API if reasonable)
- [ ] Beatport (deferred — same gated-API caveat as Phase 8)
- [ ] Bandcamp (no public general-search API; search-link only)
- [ ] Spotify (re-uses Phase 8 client)
- [ ] Apple Music (separate Apple Developer auth; deferred)

### Tests
- [ ] `TrackTitleParser` golden cases:
  - `"Kim English - Nite Life (Bump Classic Mix) 1994"` → all four fields populated
  - `"Classic House 1998 - Deep Garage Vinyl"` → low-confidence, needs review
  - `"Artist - Title [FREE DL] HQ 320kbps"` → strip junk, no version
  - `"Artist - Title (Original Mix) [Big Label] 2003"` → version + year + label captured
- [ ] `UrlNormalizer`: each of `/@handle`, `/channel/UCxxx`, `/c/x`, `/user/x`, `/playlist?list=x` resolves correctly
- [ ] `LocalLibraryMatcher`: `Kim English - Nite Life (Bump Classic Mix)` matches local `Kim English - Nite Life (Bump - Classic Mix)`
- [ ] Confidence scoring: each rule contributes the documented points; the spec example (`Kim English - Nite Life (Bump Classic Mix) 1994` ↔ `Kim English - Nite Life (Bump Classic Mix)`) totals 110
- [ ] YouTube quota: scanner backs off cleanly when API returns `quotaExceeded`

### Risks & guardrails
- **Positioning is product-critical and legally important.** Discovery, preview, availability check — never download/rip/extract. Settings/About copy must make this stance explicit.
- **YouTube ToS.** Public Data API + embedded iframe player is standard and ToS-compliant. Anything that touches video/audio streams (yt-dlp, audio extraction, scraping) is not — keep that line bright.
- **Channel disambiguation.** Channels can rename. Persist `ExternalSourceId` (the YouTube channel ID) so renames don't break the source.
- **Embed restrictions.** Some videos disable embedding. Detect and surface "Open on YouTube" fallback.
- **API quota.** 10k units/day is generous for casual use but a 5k-video channel rescanned often will burn it down. Cache aggressively; only fetch new uploads after first scan.
- **Confidence scoring trust.** Use to *suggest*, never to *auto-mark* — same trust principle as Phase 8.

**Done when:** the user adds a YouTube channel, sees parsed track rows imported from public metadata, can preview each in an embedded player, and can mark Want / Already Have / Ignore. At least one external catalog (Discogs or MusicBrainz) returns availability matches with confidence labels.

---

## Cross-cutting checklist

- [ ] All destructive endpoints (`apply cleanup`, `delete plan`) require an explicit confirmation header or body flag — no accidental wipes
- [ ] SQLite WAL mode on
- [ ] Backup `wisp.db` to `wisp.db.bak` on app start (rolling, keep last 3)
- [ ] All file paths normalized to absolute, case-insensitive on Windows
- [ ] No background process touches files while a scan is running (single-writer lock per folder)
- [ ] User-visible errors never leak stack traces — server returns `{ code, message, details? }`

---

## Suggested order of attack (first 4 weekends)

1. **Weekend 1:** Phase 0 + half of Phase 1 (scanner backend + dumb table)
2. **Weekend 2:** Finish Phase 1 (filters, progress, polish) + start Camelot/BPM scoring
3. **Weekend 3:** Phase 2 fully + Phase 3 backend
4. **Weekend 4:** Phase 3 frontend (drag/drop, energy curve)

After that, audio (Phase 4) is the next-biggest leap — budget more time. Cue helper and cleanup are smaller phases by comparison. **Phases 8 (Artist Refresh) and 9 (Crate Digger) are intentionally last** — they're the most exciting features and the ones most likely to derail focus, so don't start until 0–6 ship. They share an `ExternalCatalog` module (Discogs + MusicBrainz clients), so whichever you build first does the catalog plumbing for the other.

---

## Out of scope for v1 (per spec §16, §17)

- BPM/key/energy detection from raw audio
- Automatic cue detection (drop, breakdown, outro)
- Rekordbox/Serato DB writes
- Mix generation from constraints (the "build me a 30-min set" feature)
- Track usage history influencing recommendations

> External catalog lookups (MusicBrainz/Spotify/Discogs) are no longer "out of scope" — they have a dedicated home in **Phase 8 (Artist Refresh)** and **Phase 9 (Crate Digger)** (post-MVP, but tracked).
>
> Hard "no" rules from Phase 9: no YouTube audio download/rip/extract, no Web Audio playback of YouTube sources, no cue points/waveforms/crossfades on embedded YouTube previews. Embedded iframe player only.
