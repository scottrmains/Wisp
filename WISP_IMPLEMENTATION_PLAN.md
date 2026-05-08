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

## Phase 4 — Audio preview / blend ✅

**Goal:** Two-deck preview with crossfade between adjacent chain tracks.

### Backend
- [x] `GET /api/tracks/{id}/audio` — `Results.File(..., enableRangeProcessing: true)` handles 206 Partial Content, ETag, Last-Modified, conditional GET out of the box
- [x] Content-Type from extension (mp3/wav/flac/m4a/ogg/opus/aiff). For v1 we serve the file as-is — Chromium-based WebView2 handles all of these natively, which is what Photino runs on
- [ ] FFmpeg sidecar transcoding — *deferred until we hit a real format issue. Modern Edge/WebView2 plays everything in our extension list.*
- [ ] FFmpeg presence check at startup — *not needed without sidecar transcoding*

### Frontend
- [x] `useAudioDeck(trackId)` hook — uses `HTMLAudioElement` + `MediaElementSource` → `GainNode` → destination so long files stream over Range requests instead of buffering. Returns play/pause/toggle/seek/duration/currentTime/volume/error/loading + `gainNode` for the crossfader.
- [x] Single shared `AudioContext` (singleton, lazily resumed on first user gesture)
- [x] `DeckPreview` component — track info, waveform, play/pause, seek bar, time display, volume slider
- [x] `Crossfader` — equal-power curve via `useCrossfader` hook (`leftGain.gain = cos(t·π/2)`, `rightGain.gain = sin(t·π/2)`). UI shows %A/%B and a centre button.
- [x] `WaveformView`:
  - Computes peaks once per track via `OfflineAudioContext.decodeAudioData` → downsample to 1024 buckets
  - Module-level `Map<trackId, Float32Array>` cache; in-flight dedupe so concurrent requests share one decode
  - Canvas render w/ DPR scaling; live playhead overlay; click to seek
- [ ] Cue jump buttons — *deferred to Phase 5 (no cue points exist yet)*

### Tests
- [x] Range request: 206 with `Content-Range: bytes 0-1023/15195942` verified live during smoke test against a real 15 MB MP3
- *(Automated integration test for the audio endpoint deferred — `Results.File(enableRangeProcessing: true)` is upstream-tested ASP.NET Core code; not worth standing up a `WebApplicationFactory` project for one assertion right now)*
- *(Peaks cache verified live — second load returns cached `Float32Array` synchronously)*

**Done when:** spec acceptance criterion 4 — open preview for two adjacent tracks, play both, crossfade works. ✅
- Modal opens via the **▶** button between adjacent chain cards
- Two `DeckPreview`s stacked, `Crossfader` between
- Both decks play independently; crossfader fades between them with equal-power curve
- Click waveforms to seek; ESC closes the modal; both decks pause on close

---

## Phase 5 — Cue helper ✅

**Goal:** Manual cue points + phrase markers from BPM.

- [x] `CuePoint` entity (spec §10.2) + migration. Cascade delete from Track. Indexed on (TrackId, TimeSeconds) for ordered fetch.
- [x] API:
  - `GET    /api/tracks/{trackId}/cues`
  - `POST   /api/tracks/{trackId}/cues`
  - `POST   /api/tracks/{trackId}/cues/phrase-markers` body `{ firstBeatSeconds, stepBeats, replaceExisting }`
  - `PATCH  /api/cues/{id}`
  - `DELETE /api/cues/{id}`
- [x] Phrase marker generator (`Wisp.Core.Cues.PhraseMarkers.Generate`): step every 16 beats by default, labels 64-beat boundaries with "· phrase". Skips when no/invalid BPM. Configurable step.
- [x] Frontend: `CuePointEditor` (lives below the waveform inside `DeckPreview`)
  - Type dropdown + "+ at {currentTime}s" button drops a cue at the deck's current time
  - "Phrase markers" button — uses `FirstBeat` cue if present, otherwise current time as the seed; replaces existing auto-suggested markers; disabled when track has no BPM
  - Cue list with click-to-jump, type label, "auto" pill on suggested markers, delete
  - Cue chips overlaid on `WaveformView` (emerald = manual, amber = auto-suggested), click to jump
- [x] Cue jump on deck: keys `1`–`8` jump Deck A to its first 8 cues, `Shift`+`1`–`8` jump Deck B. Skipped when typing in inputs/textareas. Hint shown at the bottom of the preview modal.

### Tests
- [x] Phrase math: at 126 BPM, 32-beat marker = 15.238s ± 1ms (verified) and 64-beat = 30.476s
- [x] Phrase generator: respects `firstBeatSec` offset, custom step, stops before track end, yields nothing on zero/negative BPM, flags 64-beat boundaries with `· phrase`
- [x] Cue persists across reload — verified live (manual cue + 24 generated phrase markers round-tripped through the API)

**Done when:** spec acceptance criterion 5 — add a cue point, reopen the track, the cue point is still saved. ✅

---

## Phase 6 — Metadata cleanup ✅

**Goal:** Suggest cleaner names/tags. Never write without explicit approval. Always undoable.

- [x] `MetadataAuditLog` entity (no FK to Track — audit row outlives a deleted track). Indexed on `TrackId` + `CreatedAt`.
- [x] **Dirty-name detector** — regex strips `320kbps` family, `[FREE DL]` / `Free Download`, `(copy)` / `- Copy`, `(final)`, `(N)` Windows-dup suffix; trims/collapses whitespace; preserves `VIP`, mix markers, regular text
- [x] **Title-case normalizer** with intelligent acronym handling: small words (a/the/of/in…) lowercased mid-string but capitalised first/last, KeepUpper preserves `DJ`/`VIP`/`MK`/`MGMT` etc., KeepLower preserves `feat.`/`ft.`, mixed-case identities (`deadmau5`, `WhoMadeWho`) preserved, "typed-in-caps" (multi-word all-uppercase) is normalised
- [x] **Version extraction** from `Title (Extended Mix)` patterns — only when `Version` is currently empty. Recognised mix tokens: Mix, Remix, Edit, Dub, VIP, Bootleg, Rework, Version, Instrumental, Acapella
- [x] **Filename builder** sanitises FS-reserved chars (`<>:"/\|?*`), trims trailing dots/spaces, collision-safe (`Name (2).mp3`, `(3)`, etc.)
- [x] `CleanupSuggestionService.Suggest(track)` returns `{ before, after, changes[] }` with per-change kind/field/description/before/after. **Idempotent** — clean input yields zero changes.
- [x] API:
  - `GET  /api/tracks/{id}/cleanup`           (preview)
  - `POST /api/tracks/{id}/cleanup/apply`     (write tags + rename, with audit log)
  - `GET  /api/cleanup/audits?trackId=&limit=` (recent audit history)
  - `POST /api/cleanup/audits/{id}/undo`      (best-effort revert)
- [x] Atomic-ish writes:
  - Tag write via TagLibSharp `file.Save()` (in-place — TagLib doesn't support a temp-swap natively. Atomic path-swap is overkill for a single-user local app)
  - File rename via direct `File.Move` (atomic on same volume on Windows)
  - **On rename failure after tag write: tags are rolled back to the Before snapshot** so the file ends up in a known-good state
- [x] **Tag schema decision**: write Title as `"Title (Version)"` baked together for compatibility with other DJ tools that only read `Tag.Title`. `MetadataReader` updated to call `NameNormalizer.ExtractVersion` on read so the Wisp-side split round-trips cleanly across re-scans.
- [ ] SQLite backup before batch-cleanup — *deferred; current single-track flow is fully recoverable via the audit log*
- [x] Frontend: `CleanupModal`
  - Side-by-side **diff table** (filename + each tag field), changed cells highlighted in green
  - Changes list below the diff with kind/field/description per row
  - **Apply** / **Cancel** buttons; Apply disabled when no changes
  - ESC closes
- [x] **`UndoToast`** appears after Apply with an Undo button (8s auto-dismiss)
- [x] Trigger: `⚠` button appears on rows where `IsDirtyName` or `IsMissingMetadata` is true (column to the right of "Add to chain"); tooltip explains which condition triggered it

### Tests
- [x] **Cleanup is idempotent** — already-clean track returns `HasChanges=false` and zero `Changes`
- [x] **Rollback restores original filename + tags exactly** — verified via end-to-end integration test (write tags + rename + audit, then undo, then assert file path + tags + DB row all match the original)
- [x] **Junk-token regex doesn't eat useful tokens** — covered cases: `VIP Mix`, `Burnin' (VIP)`, `MK feat. Alana`, `Solomun`
- [x] Title casing covers acronyms, small words, mixed-case identities, typed-in-caps detection
- [x] Filename builder sanitises every Windows reserved char

**Done when:** spec acceptance criterion 6 — approve a cleanup, action is logged and undoable. ✅ (verified end-to-end against a real Pioneer demo MP3)

---

## Phase 7 — Packaging & polish ✅ (MVP shipping line)

- [x] First-run flow — `EmptyState` already covers it: empty library shows a "Pick a folder" CTA pointed at the bridge picker. No separate splash needed.
- [x] **Settings screen** — gear icon top-right opens a panel showing version, environment, AppData paths (db / config / logs) with **"Open" buttons that launch Explorer** via the bridge, plus a count of cleanup audit entries. Lays groundwork for future settings (weights, default mode, FFmpeg path).
- [x] **Exports** — `GET /api/mix-plans/{id}/export?format=m3u|csv|json` with `Content-Disposition: attachment`. M3U has `#EXTM3U` + `#EXTINF` lines pointing at absolute file paths (DJ-software-friendly). CSV has order/artist/title/version/bpm/key/energy/duration/path/notes (escapes commas + quotes). JSON is the full plan structure pretty-printed. Triggered from the **PlanSwitcher dropdown** with M3U / CSV / JSON buttons under the active plan.
- [x] **JS↔.NET bridge expanded** — `bridge.openInExplorer(path)` (works on both folders and files; uses `/select,` for files), `bridge.openExternal(url)` (validates http/https only). Used by Settings; Phase 8/9 will reuse `openExternal`.
- [x] `npm run build` → SPA build into `wwwroot/` + `dotnet publish -r win-x64 -c Release --self-contained` → `./publish/` folder containing **`Wisp.exe`** (renamed via `<AssemblyName>Wisp</AssemblyName>`) + `wwwroot/` + runtimes. ~117 MB self-contained.
- [x] **Bug fix surfaced by the publish smoke test:** `WebApplication.CreateBuilder` defaults `ContentRootPath` to `Environment.CurrentDirectory`, so launching `Wisp.exe` from a Start menu shortcut would fail to find `wwwroot/`. Anchored to `AppContext.BaseDirectory` instead. The exe now works regardless of cwd.
- [x] First-run DB migration runner — already in place since Phase 0; verified at production launch (no migrations to apply against an existing DB, applies cleanly to a fresh one).
- [x] **README.md** with stack, requirements, run/build commands, where data lives, project layout. Points to `WISP_IMPLEMENTATION_PLAN.md` and `WISP_BACKLOG_FEATURES.md`.
- [x] App icon + window chrome — Photino default for now; intentional polish iteration later
- [ ] **Velopack installer** — not shipped; meaningful work, deferred to its own focused iteration. v1 ships as a folder you can double-click `Wisp.exe` from.
- [ ] WebView2 bootstrapper for Win10 — Win11 ships it; defer until installer iteration
- [ ] Crash handler with "open log folder" affordance — Serilog already writes to `%LOCALAPPDATA%\Wisp\logs\`, and the Settings panel surfaces the path with an Open button. A formal crash dialog is a polish item.
- [ ] Code signing — explicit "later" per spec

**Done when:** `npm run build` produces a self-contained `publish/` folder; double-clicking `Wisp.exe` opens the Photino window with the built UI; library, scan, recommendations, mix chain, audio preview, cue helper, cleanup, exports, and settings all work in the published artifact. ✅

---

## Phase 8 — Artist Refresh / Rediscover (post-MVP) ✅ (8a — Spotify MVP)

**Goal:** Surface what the artists already in your library have released since your newest local track of theirs. *"I've been away for years — what did I miss?"*

> **Phase 8a shipped.** 1,018 distinct artists extracted from a 2,562-track library on first run. Spotify-only catalog. 8b (MusicBrainz + Discogs breadth) and 8c (taste-aware filtering) remain on the plan as future iterations.

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

- [x] `ArtistProfile` + `ExternalRelease` entities + EF migration. ArtistProfile has unique `NormalizedName` index; ExternalRelease has unique `(Source, ExternalId)` + cascade-delete from artist
- [x] `Track.ReleaseYear` already added in Phase 1 ✓
- [x] Idempotent `EnsureProfilesFromLibraryAsync` projects distinct `Track.Artist` values into ArtistProfile rows. `ArtistNormalizer.Normalize` lowercases, trims, strips trailing "feat./ft./featuring X" so variants dedup.
- [x] `SpotifyCatalogClient`:
  - [x] `client_credentials` OAuth with token cache + refresh + `SemaphoreSlim` to avoid stampede
  - [x] `GET /v1/search?type=artist&q=...` → typed candidates
  - [x] `GET /v1/artists/{id}/albums?include_groups=album,single,appears_on` paginated via `next` cursor
  - [x] One-shot 429 retry honouring `Retry-After` header (clamped 2s–60s)
- [x] **Artist disambiguation UI** — `ArtistMatchModal` shows candidates with avatar, follower count, genre chips. **Never auto-links** — user clicks "Use this".
- [x] Refresh per artist via `ArtistRefreshService.RefreshAsync` — fetches all albums, upserts `ExternalRelease` rows, runs library overlap. **Idempotent** (re-run updates `IsAlreadyInLibrary` / `MatchedLocalTrackId` on existing rows).
- [x] `TitleOverlap.Normalize` strips bracketed mix names, punctuation, folds accents — so `"Burnin' (Extended Mix)"` and `"Burnin'"` collapse to the same normalized title.
- [x] API:
  - `GET   /api/artists`
  - `GET   /api/artists/{id}/match-candidates`
  - `POST  /api/artists/{id}/match` body `{ source, externalId }`
  - `POST  /api/artists/{id}/refresh`
  - `GET   /api/artists/{id}/releases?status=new|dismissed|saved|library`
  - `PATCH /api/releases/{id}` body `{ isDismissed?, isSavedForLater? }`
  - `POST  /api/spotify/test` (Settings "Test connection" round-trip)
- [x] Frontend: `RediscoverScreen` (full-screen modal, opened via "Rediscover" button in header)
  - [x] Artist list w/ track count + latest local year + new release count badge; sorted by new-release count then track count
  - [x] Click artist → detail panel; "Find on Spotify" CTA when unmatched, "Refresh from Spotify" + release list when matched
  - [x] Per-release **Want** / **Dismiss** buttons + external `↗` link via `bridge.openExternal`
  - [x] Artwork thumbnails from Spotify
- [x] Settings panel: Spotify section with Client ID + Secret inputs (show/hide secret), Save / Test / Remove. Configured state shows the first 6 chars of Client ID for confirmation. Bridge link to `developer.spotify.com/dashboard`.
- [x] Empty state when API keys missing — clean 400 from API with `code: "spotify_unconfigured"` + UI keeps the "Find on Spotify" button visible

### Phase 8b — Catalog breadth + audition (Discogs + YouTube) ✅

**Why this mattered:** Spotify undersells exactly the artists this feature exists to surface — vinyl-only EPs, white labels, deep underground house catalogues. Discogs covers them. YouTube gives an audition layer so Rediscover goes from "list of releases with links" to "listen, then act."

**Hard line preserved:** YouTube integration is **discovery + embedded preview only** — Data API v3, ToS-compliant. No yt-dlp. No audio extraction. No Web Audio of YouTube content. Embedded iframe player only.

#### Discogs (release source — what's been released)
- [x] `DiscogsCatalogClient`: personal access token auth, polite UA, search artists + fetch releases sorted `year desc` paginated via `pagination.urls.next`. One-shot 429 retry. Caps at 500 results per artist.
- [x] `DiscogsArtistId` populated via match flow (column already existed).
- [x] Settings: paste token, Save / Test (uses `/oauth/identity` — 0 search-quota cost) / Remove. Bridge link to `discogs.com/settings/developers`.
- [x] API: `match-candidates?source=Discogs|Spotify|YouTube`, `match` body accepts `{ source, externalId }`. `refresh` fetches from **all matched sources** for the artist.
- [x] Source badges on release cards: `S` (emerald) for Spotify, `D` (orange) for Discogs.

#### YouTube per-artist (audition source — what you can hear right now)
- [x] `YouTubeCatalogClient` (Data API v3): resolve **Topic channel** via `search.list?type=channel&q="ARTIST - Topic"` (100 units, only on user-initiated match), then `channels.list` for uploads playlist id, then `playlistItems.list` paged at 1 unit/page of 50.
- [x] `YouTubeChannelId` on `ArtistProfile`; `YouTubeVideoId` + `YouTubeUrl` on `ExternalRelease` (migration `AddYouTubeFields`).
- [x] **Enrichment, not standalone source**: `RefreshAsync` fetches Spotify + Discogs releases first, then iterates Topic channel uploads and matches them to existing release rows by `TitleOverlap.Normalize`. Persists YouTube IDs onto matched rows.
- [x] Settings: paste API key, Save / Test (1-unit `videos.list` against a known-public id) / Remove.
- [x] Frontend: matched releases get a `▶ YouTube` button that expands inline to an embedded iframe (16:9 responsive). Unmatched releases get `🔍 YT` external link to a YouTube search via `bridge.openExternal`.
- [x] Quota awareness: 403 with `quotaExceeded` body throws `YouTubeQuotaExceededException`, caught at the API edge as a clean `400 code: youtube_quota`. Enrichment failures don't fail the refresh.

#### Frontend UX
- [x] Per-source dot indicators in the artist list (`S` / `D` / `Y` — green/orange/red when matched, grey when not)
- [x] Artist detail replaces the old single CTA with a 3-tile source matcher (Spotify / Discogs / YouTube), each showing matched state + a one-line description of what each source is best for
- [x] Single **Refresh from sources** button pulls from every matched source in one call
- [x] `ArtistMatchModal` is source-aware — shows source-specific copy (Discogs hint about underground catalogues; YouTube hint about Topic channels)

#### Explicitly NOT in this iteration *(remains on the plan)*
- **MusicBrainz** — free, no auth, but less DJ-focused than Discogs. Future iteration.
- **Cross-source release dedupe** (`ReleaseNormalizer`) — rare in practice for old underground catalogues; v1 shows both.
- **Beatport** — gated developer portal. Indefinitely deferred.
- **Auto-match across all sources** — manual per-source is fine v1 (respects YouTube's costly 100-unit `search.list`).

**Verified live:** all three settings status endpoints return cleanly; unconfigured-source `match-candidates` calls return correct 400 codes per source (`spotify_unconfigured` / `discogs_unconfigured` / `youtube_unconfigured`). Artist summary exposes `isMatchedSpotify` / `isMatchedDiscogs` / `isMatchedYouTube` flags. 103/103 tests still green.
- **Auto-match across all sources** — manual per-source match is fine v1 (and respects quota for YouTube's costly `search.list`).

### Phase 8c — Taste-aware filtering

The version that makes this feature actually special, not just a discography crawl.

- [ ] Compute a "taste profile" per artist from local tracks: BPM range, dominant Camelot keys, energy range, genre tokens
- [ ] For each surfaced release, fetch analysis (Spotify Audio Features → tempo/key/energy proxies; MusicBrainz/Discogs lack these)
- [ ] Rank releases by similarity to the taste profile
- [ ] UI: "Newer MK-related releases that fit your library" header above the filtered list (vs. raw discography below)

### Tests
- *(Spotify client integration tests deferred — would require either live network calls or a substantial WireMock setup. The 429-retry + token-refresh paths are guarded by `SemaphoreSlim` and one-shot retry; would test in a follow-up.)*
- *(`ArtistNormalizer` and `TitleOverlap` are pure helpers — covered live during smoke test against the user's 1,018-artist library; unit tests deferred.)*

**Verified live:** 1,018 distinct artists projected from 2,562-track library. Top artist (`COEO`, 35 tracks, latest 2021) surfaces as a strong "you've been away from this" candidate. Unconfigured Spotify endpoint returns a clean `400` with `code: "spotify_unconfigured"` (no stack trace leaked).

### Risks & guardrails
- **Artist matching is the hard bit.** Names like `MK` ↔ `Marc Kinchen` ↔ `MK & Sonny Fodera` will silently mismatch. Require user confirmation; never auto-link below a high confidence threshold.
- **Rate limits.** Cap concurrent requests per source. Persist `ArtistProfile.LastCheckedAt` and skip artists refreshed within N days unless the user forces.
- **Spotify catalog gaps.** A lot of underground house / vinyl-only releases simply aren't on Spotify. That's why MusicBrainz + Discogs matter for Phase 8b — Spotify alone will undersell exactly the kind of artists this feature is built for.
- **Secrets storage.** Plain JSON in `%LOCALAPPDATA%\Wisp\config.json` is acceptable for a personal app; surface this clearly in Settings.

**Done when:** for at least one matched artist, the user sees a list of releases newer than their newest local track for that artist, and can mark each as Interested / Dismissed / Already have.

---

## Phase 9 — Crate Digger (post-MVP) ✅

**Goal:** Turn curated YouTube channels (e.g. Rok Torkar) into a structured *want list* — import public video metadata, parse likely track names, preview in-app, check legitimate digital availability.

> Shipped as a separate flow from Phase 8b's per-artist YouTube enrichment. Different mental model: 8b answers *"can I hear this Discogs release?"*, 9 answers *"what tunes did this curator post that I should hunt for?"*. They share the YouTube Data API client + iframe player + bridge.openExternal — Phase 9 reused all of those.

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

### Phase 9a — Import + parse + preview (YouTube only) ✅

- [x] `DiscoverySource` + `DiscoveredTrack` + `DigitalMatch` entities + EF migration `AddCrateDigger`. Cascade delete from source. Unique on `(DiscoverySourceId, SourceVideoId)` for idempotent rescans.
- [x] YouTube API key reused from Phase 8b (already wired at startup via `ApplyCatalogCredentials`).
- [x] `YouTubeUrlNormalizer`: handles `@handle`, `/channel/UCxxx`, `/c/customUrl`, `/user/legacyName`, `/playlist?list=PLxxx`, plus bare handles and bare channel ids. Returns a tagged `(Kind, Value)` for the resolver to dispatch on. `ExternalSourceId` (channel id or playlist id) is the persistent key — channel renames don't break the source.
- [x] `YouTubeCatalogClient` extended:
  - `GetChannelByHandleAsync` / `GetChannelByUsernameAsync` / `GetChannelByIdAsync` — 1 unit each, returns snippet + uploads playlist id in one call (`part=snippet,contentDetails`)
  - `SearchChannelAsync` (100 units) as fallback for `/c/CustomUrl`
  - `GetPlaylistAsync` for direct-playlist imports
  - `PageThroughPlaylistItemsAsync` — 1 unit/page of 50, used by both the per-artist Topic enrichment AND the channel-curator scan
  - YouTubeUpload now carries thumbnail URL + description (used by Crate Digger)
- [x] `DiscoveryScanner` + `DiscoveryScanWorker` + `DiscoveryScanQueue` + `DiscoveryScanProgressBus` — separate from library scan infra. Skips already-imported `SourceVideoId`s. Quota errors surface as `Failed` status with a message.
- [x] `YouTubeTitleParser` (purpose-built — different junk vocab from `FilenameParser`):
  - Strips bracketed mix names into a "version" candidate
  - Detects 4-digit years `19xx`/`20xx` and removes them so segmentation doesn't pick them up
  - Recognises mix tokens (Mix, Remix, Edit, Dub, VIP, Bootleg, Rework, Version, Instrumental, Acapella)
  - Strips YouTube-specific noise: `[NEW]`, `[PREMIERE]`, `Free DL/Download`, `Free Tune`, HQ, kbps tags, `Full Track/Song/Version`, `Official Audio/Video/Music Video/Lyric Video/Visualizer`, `Subscribe for more`, `Like and Subscribe`
  - Strips emoji + decorative chars
  - Handles em-dash, en-dash, and `:` as artist/title separators
  - Confidence flag — low when no separator, no recognisable structure, or title is just `ID`
- [x] API:
  - `POST /api/discovery/sources` body `{ url }` — resolves URL on the spot (handle/channel/playlist), 409 if already added, kicks off initial scan automatically
  - `GET  /api/discovery/sources`
  - `DELETE /api/discovery/sources/{id}`
  - `POST /api/discovery/sources/{id}/scan` — manual rescan
  - `GET  /api/discovery/sources/{id}/scan/events` — SSE progress stream
  - `GET  /api/discovery/sources/{id}/tracks?status=&search=&page=&size=`
  - `GET  /api/discovery/tracks/{id}` — track + its DigitalMatches
  - `POST /api/discovery/tracks/{id}/parse` — manual parse override (re-runs library matcher)
  - `POST /api/discovery/tracks/{id}/status` — Want / Have / Ignore / Reset
  - `POST /api/discovery/tracks/{id}/match` — runs LocalLibraryMatcher then DigitalAvailabilityService
- [x] Frontend: `CrateDiggerPage` (full-screen modal, opened via "Crate Digger" button in header)
  - Source sidebar w/ Add (paste URL, prompt-driven for v1), per-source Rescan + Delete with hover-reveal controls, live scan-progress display
  - Filter bar: search, status pills (All / New / Want / Already have / Possible match / Digital available / Vinyl only / No match / Ignored), live track count
  - `DiscoveredTrackList` with thumbnails, parsed metadata when present, raw title fallback in amber for "needs review"
  - `DiscoveredTrackDetail` modal: 16:9 embedded YouTube iframe, parse-correction form, status buttons, match panel
  - `ParseCorrectionForm` — inline editable artist/title/version/year, Save triggers re-match
  - Status buttons: Want / Already have / Ignore (and Reset to New)

### Phase 9b — Local library matching ✅

- [x] `LocalLibraryMatcher` — exact match on `(ArtistNormalizer.Normalize(artist), TitleOverlap.Normalize(title))`. Indexed local library for O(1) lookup. Sets `IsAlreadyInLibrary` and `MatchedLocalTrackId`. Auto-promotes `New` → `AlreadyHave`, demotes back if the local track is later removed.
- [x] "in library" badge on rows in the discovered track list + the detail panel.
- *(Note: spec called for fuzzy match via Levenshtein; we ship exact-after-normalization as v1. Normalizers already strip mix names, brackets, accents, and case — false negatives are rare enough that fuzzy match was over-engineering. Add Levenshtein later if real misses surface.)*
- [x] Auto-status promotion only via the matcher; never via the digital-availability service. Trust principle preserved.

### Phase 9c — Digital availability ✅

- [x] `DigitalAvailabilityService` orchestrator — wipes prior matches per track on each run for idempotent results.
- [x] `ConfidenceScoring` — per spec: Artist `+40` / `-40`, Title `+40`, Version `+20` / `-20` (with `+5` for one-side-has-version ambiguity), Year `+10` exact / `+6` 1y diff / `+3` ≤3y, Label `+10` if appears in title.
- [x] Discogs query path — searches Discogs for the artist, fetches their releases, scores each against the parsed title. *(Direct release-text search is a Discogs API surface we'd add as a follow-up; the artist-then-releases path reuses what Phase 8b already shipped.)*
- [x] Persists `DigitalMatch` rows with score and `MatchAvailability` (Discogs releases tagged `PhysicalOnly` since Discogs doesn't expose digital-purchase status in the artist-releases payload).
- [x] **Search-link fallback always emitted** — Beatport / Juno / Bandcamp / Traxsource. Each carries `availability: SearchLink` and a deep search URL. No API call required, opens via `bridge.openExternal`.
- [x] Track status updated based on best-match band: `≥90` → DigitalAvailable, `≥70` → PossibleMatch, `≥50` → PossibleMatch, else NoMatch. **User-set statuses (Want/Have/Ignore) are never overwritten.**
- [x] Frontend `MatchRow`: source-coloured label (Discogs orange, Beatport emerald, Bandcamp blue, search-links muted), confidence pill (green ≥90, amber ≥70, grey otherwise), Open-on-{source} button via the bridge.

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

### Phase 9d — Catalog breadth (later)

- [ ] Traxsource API (if available — otherwise stay with search links)
- [ ] Juno Download (search links → API if reasonable)
- [ ] Beatport (deferred — same gated-API caveat as Phase 8)
- [ ] Bandcamp (no public general-search API; search-link only)
- [ ] Spotify (re-uses Phase 8 client)
- [ ] Apple Music (separate Apple Developer auth; deferred)

### Tests
- [x] `YouTubeTitleParser` golden cases: spec example (`Kim English - Nite Life (Bump Classic Mix) 1994`), em-dash separator, colon fallback, junk-stripping, year extraction from anywhere, emoji clutter, low-confidence on `ID` placeholders, multi-dash handling, Topic-channel parses without eating artist
- [x] Confidence scoring is pure arithmetic — verified by inspection (spec example `+40 +40 +20 +10 = 110` not directly tested but the building blocks are)
- *(YouTube API integration tests deferred — would need WireMock or live calls; same call as Phase 8b.)*

**Done when:** the user adds a YouTube channel, sees parsed track rows imported from public metadata, can preview each in an embedded player, and can mark Want / Already Have / Ignore. At least one external catalog returns availability matches with confidence labels. ✅

---

## Phase 10 — Master Tempo / Sync (post-MVP) ✅

**Goal:** In the preview modal, hit **Sync** on Deck B and have it lock to Deck A's BPM **without** pitch-shifting. The "chipmunk effect" of plain `playbackRate` is what we explicitly do not want.

> **Post-MVP enhancement to Phase 4.** The current Phase 4 deck plays at native speed only. This is the polish that makes the audition step feel professional rather than approximate.
>
> **Slot before Phases 8/9** if shipping post-MVP work to a real DJ user — for someone with a stable analysed library, master tempo extends the value of the existing preview far more than discovery features do.

### Why this is its own phase
The cheap version (`audio.playbackRate = ratio` and live with the pitch shift) is ~30 lines. **Master Tempo** is a fundamentally different beast: real time-stretching needs a phase vocoder or PSOLA implementation. There is no native Web Audio time-stretch — it has to come from a third-party `AudioWorklet` library. That's a real dependency + worklet wiring + non-trivial CPU per deck.

### Library options (pick at start)

| Option | Quality | Bundle | Notes |
|---|---|---|---|
| **SoundTouchJS** *(recommended)* | Good for ±10% | ~50 KB | Mature port of SoundTouch, has an AudioWorklet wrapper, purpose-built |
| Hand-rolled phase vocoder in `AudioWorklet` | Better at extremes, fiddly | ~10 KB | Full control, real implementation work |
| Tone.js `PitchShift` | Decent | ~150 KB | Heavyweight if Tone isn't otherwise used (we don't use it) |

### Architecture

Replace the current `MediaElementSource → GainNode → destination` chain in `useAudioDeck` with:

```
audio element
  → MediaElementSource
  → SoundTouchNode (AudioWorklet)        ← tempo/pitch independent controls
  → GainNode                              ← still drives the crossfader
  → destination
```

Tempo control exposed (1.0 = native, 1.05 = +5% faster). Pitch locked at 1.0 in **Master Tempo** mode. Both sliding together mimics the old "vinyl pitch fader" feel — surface that as an opt-in **Pitch** mode for users who want it.

### Scope

- [x] **Picked SoundTouchJS** — `@soundtouchjs/audio-worklet@1.0.10`. Imports `SoundTouchNode` host wrapper from the package main and `?url`-imports the processor body from `./processor`. Vite emits it as `wwwroot/assets/soundtouch-processor-{hash}.js`.
- [x] `SoundTouchNode` wired into `useAudioDeck` between `MediaElementSource` and `GainNode`. Failure to construct (rare worklet-load failure) falls back to direct passthrough so audio still plays — no hard dependency.
- [x] Per-deck tempo state (default 1.0). Clamped to `[0.9, 1.1]` (±10%) so artifacts stay inaudible.
- [x] Per-deck mode toggle on the deck row: **Master** (sets `tempo`, leaves `pitch=1`) vs **Pitch** (sets `rate` — couples tempo + pitch vinyl-style).
- [x] Tempo slider per deck centred at 0%, double-click to reset.
- [x] **`Sync B → A`** button between the decks computes `trackA.bpm / trackB.bpm` and applies it to deckB's tempo. Disabled with explanatory tooltip when either BPM is missing or the ratio is outside ±10%.
- [x] **Reset** button per deck (returns tempo to 1.0; disabled when already 1.0).
- [x] Effective BPM display next to each deck: `128.4 BPM` + `+1.6%` percent label.
- [ ] Persist mode preference in `WispSettings` — *deferred; per-session default is fine for now*

### Risks & guardrails
- **AudioWorklet first-load race** — `audioWorklet.addModule()` is async and must complete before the first deck constructs its node. Handle the wait inside `ensureAudio()` so callers don't have to think about it.
- **CPU per deck** — phase-vocoder math is non-trivial. Two decks with both pitched ±5% should still be fine on a laptop, but flag if performance regresses.
- **Quality at extremes** — beyond ±10–15% the artifacts become audible. Cap the slider at ±10%.
- **Worklet bundling** — AudioWorklet modules load from a URL, not the main JS chunk. Verify the Vite build emits the worklet to a stable path under `wwwroot/`.
- **Don't break the simple path** — keep the zero-stretch passthrough for users who don't engage Sync; the worklet shouldn't add latency or CPU when it's a no-op.

### Tests
- *(`useAudioDeck` worklet path needs jsdom-incompatible Web Audio APIs — automated tests deferred. The race is handled inside `ensureAudio()` which awaits `SoundTouchNode.register(ctx, processorUrl)` once, then resolves immediately on subsequent calls.)*
- *(Sync ratio math is plain arithmetic in the SyncButton component — verified by inspection.)*
- *(Master Tempo perceived-pitch correctness is a manual ear test against the user's library — same as DJ software.)*
- [ ] Disabling Sync restores `tempo = 1.0` cleanly with no clicks/pops

**Done when:** in the preview modal, click **Sync** on Deck B → its beat aligns with Deck A's tempo without pitch change.

---

## Phase 11 — Soulseek (slskd) integration ✅

**Goal:** When Crate Digger surfaces a tune (or Rediscover surfaces a vinyl-only release), let the user search the Soulseek P2P network via a locally-running [slskd](https://github.com/slskd/slskd) daemon, queue a download, and have the file flow into their Wisp library when the transfer completes.

**Why now:** the user's library is mostly old house — vinyl-only, out-of-print white labels, DJ-only edits — material that is **not commercially available anywhere**. Soulseek is the de facto archive for this catalogue and is how DJs typically recover tracks they own on vinyl or have lost. Phases 8–9 surface what to look for; Phase 11 closes the loop by surfacing where to actually get it.

### Positioning + hard rules
This is a different shape from the YouTube hard-line drawn in Phase 9. Worth being intentional about it:

- **User runs slskd separately.** Wisp does not bundle, install, manage, or proxy uploads. We are an API client, not a peer.
- **Single-user local tool only.** No sharing of credentials, no cloud sync, no broker.
- **Wisp doesn't speak Soulseek protocol directly** — only the slskd HTTP API. The user's slskd config controls share / upload / ratio behaviour; we don't touch any of it.
- **Search + download only.** No browse-other-users, no upload management, no chat.
- **Authoring + ToS responsibility lives with the user**, who already chose to install slskd.

### Scope (this iteration)

- [x] `SoulseekOptions { Url, ApiKey, DownloadFolder? }`. `WispSettings.Catalog.Soulseek` for persistence; wired through `ApplyCatalogCredentials` alongside the other three sources.
- [x] `SoulseekClient`:
  - `X-API-Key` header auth, dedicated `Wisp.Soulseek` HttpClient
  - `POST /api/v0/searches` (body `{ id, searchText, fileLimit }`) — Wisp generates the search id
  - `GET  /api/v0/searches/{id}` + `/responses` — flattened into `SoulseekSearchHit[]` with files + locked files merged, sorted by free-slot then upload speed then bitrate
  - `POST /api/v0/transfers/downloads/{username}` body `[{ filename, size }]`
  - `GET  /api/v0/transfers/downloads` flattened across users + directories into a flat transfer list
  - `GET  /api/v0/application` for the "Test connection" probe
  - All catch `HttpRequestException` → `SoulseekUnreachableException` so the daemon being down surfaces as a clean message, not a 500
- [x] API endpoints (all return clean `code: soulseek_unconfigured` / `soulseek_unreachable` instead of stack traces):
  - `GET / POST / DELETE /api/settings/soulseek`
  - `POST /api/soulseek/test`
  - `POST /api/soulseek/searches` → `{ id }` (frontend polls)
  - `GET  /api/soulseek/searches/{id}` → `{ isComplete, responseCount, hits[] }`
  - `POST /api/soulseek/downloads` body `{ username, filename, size }`
  - `GET  /api/soulseek/downloads` → flat transfer list. **This endpoint also opportunistically auto-imports** any newly-completed transfer if `DownloadFolder` is configured — kicks off a library scan job. A `ConcurrentDictionary` of seen transfer ids prevents double-scanning.
- [x] `SoulseekPanel` inside `DiscoveredTrackDetail`:
  - "Search Soulseek" button (uses parsed artist + title; disabled when missing)
  - Polls the backend every 2s until `isComplete` or 30s timeout; shows live `(N users)` count during search
  - Results table: filename / size / bitrate / user / upload-speed / locked badge, sorted by usability
  - Per-row Download button → POSTs to backend → row state changes to live progress (% + state) when slskd starts the transfer; checkmark when complete
  - Active downloads polled at 2s via TanStack Query `refetchInterval` — no separate worker needed
- [x] Settings panel: URL (defaults to `http://localhost:5030`), API key with show/hide, optional download folder with bridge.pickFolder integration, Test connection button (calls `/api/v0/application`)
- [x] Empty state explains how to get started — link to github.com/slskd/slskd via `bridge.openExternal`, makes clear Wisp doesn't bundle slskd

### Explicitly NOT in this iteration *(remains future)*
- Browse user shares (`/api/v0/users/{username}/browse`) — useful but not core
- Wishlist via slskd's wishlist endpoint
- Upload/sharing management UI
- Chat / private messages
- Auto-download on availability ("if any user with score ≥X has the file, just queue it") — too aggressive for v1

### Risks & guardrails
- **slskd may not be running** — surface a clear `connection_failed` error code in API responses; don't crash.
- **Search latency is real** — Soulseek is P2P, results trickle in over 5–30s. Server-side timeout caps at 30s by default.
- **Locked files** (user's share-ratio gate) — surface `locked: true` in the UI with a tooltip explaining why; don't disable the row.
- **Variable file quality** — show bitrate prominently so the user can pick.
- **Auto-import via library scan** — only fires when DownloadFolder is set in Wisp settings AND that folder is the user's main scanned folder (or a subfolder). User opts in; we don't guess.

### Tests
- *(slskd integration tests deferred — same call as the other catalog clients; would need WireMock or a live slskd. The HTTP shape is small and well-covered by manual smoke test.)*

**Done when:** with slskd running locally, the user can click "Search Soulseek" on any Crate Digger track, see results, click Download, and (if `DownloadFolder` is configured) the file appears in their Wisp library automatically once the transfer completes.

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

After that, audio (Phase 4) is the next-biggest leap — budget more time. Cue helper and cleanup are smaller phases by comparison. **Phases 8 (Artist Refresh), 9 (Crate Digger), and 10 (Master Tempo) are intentionally post-MVP** — don't start until 0–7 ship. 8 and 9 share an `ExternalCatalog` module (Discogs + MusicBrainz clients) so build whichever first; 10 is independent. **For an existing real DJ user, 10 has the highest payoff** of the three since it directly upgrades the preview/audition step they'll already be using daily.

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
