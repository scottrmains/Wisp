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

## Phase 0 — Bootstrap

**Goal:** Empty shell that runs the API, serves the React UI, and migrates an empty SQLite DB.

- [ ] Create solution layout:
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
- [ ] `Wisp.Api`: minimal API, OpenAPI on, CORS for `localhost:5173` in Development only
- [ ] Add `Photino.NET` package to `Wisp.Api`; wire `PhotinoWindow` startup after Kestrel binds a free port
- [ ] JS↔.NET bridge: `window.wisp.invoke(method, args)` mapped to a `PhotinoWindow.RegisterWebMessageReceivedHandler`. First method: `pickFolder` (uses `System.Windows.Forms.FolderBrowserDialog` or `Windows.Storage.Pickers` via WinRT)
- [ ] `Wisp.Client`: Vite + React + TS + Tailwind + ESLint + Prettier
- [ ] Vite dev proxy `/api → http://localhost:5125`
- [ ] EF Core: `WispDbContext`, initial empty migration, SQLite at `%LOCALAPPDATA%\Wisp\wisp.db`
- [ ] Settings file at `%LOCALAPPDATA%\Wisp\config.json` (last folder, window size, etc.)
- [ ] Serilog: console in Dev, rolling file `%LOCALAPPDATA%\Wisp\logs\wisp-.log`
- [ ] Health endpoint `GET /api/health`
- [ ] Dev workflow: `dotnet watch run` on the API + `npm run dev` on the client (or a single root script that launches both with `concurrently`). Photino window only spawns in Release / when launched via `dotnet run --launch-profile Shell`.
- [ ] Production build: `npm run build` → `dotnet publish` copies `dist/` into `wwwroot/`; Kestrel serves with `UseStaticFiles` + SPA fallback; Photino opens `http://localhost:{port}`
- [ ] WebView2 runtime check on first run; surface a friendly download link if missing (Win10 only — Win11 has it built in)
- [ ] Commit baseline, tag `v0.0.0`

**Done when:** running `Wisp.Api` (Release) opens a Photino window showing the React shell, which calls `/api/health` and gets 200.

---

## Phase 1 — Library scanner

**Goal:** Pick a folder → see a table of tracks with BPM/key/energy from Mixed in Key tags.

### Backend
- [ ] `Track` entity (per spec §10.1) + EF migration
- [ ] `ScanJob` entity (id, folder, status, counts, started/finished)
- [ ] `IFileScanner`: recursive enumerate `.mp3 .flac .wav .aiff .m4a .ogg .opus`
- [ ] File fingerprint: SHA-256 of first 1 MiB + last 1 MiB + size (fast, stable for renames)
- [ ] `IMetadataReader` (TagLibSharp2):
  - Standard tags: artist, title, album, genre, duration
  - **Mixed in Key compatibility**: read `TKEY` / `INITIALKEY` (Camelot like `8A`), `TBPM`, custom `EnergyLevel` frame (MiK writes to comment or custom TXXX; handle both)
  - Fallback to filename parsing when tags absent
- [ ] Scan pipeline as a `BackgroundService` consuming a `Channel<ScanRequest>`
- [ ] Diff existing rows by hash → insert new / update changed / mark removed
- [ ] API:
  - `POST /api/library/scan` body `{ folderPath }` → returns `scanJobId`
  - `GET  /api/library/scan/{id}` → progress (`scanned/total/added/updated/removed`)
  - `GET  /api/tracks?search=&key=&bpmMin=&bpmMax=&energy=&missing=&page=&size=&sort=`
  - `GET  /api/tracks/{id}`
- [ ] Progress stream: SignalR hub `/hubs/scan` (or SSE if you want one less dep)

### Frontend
- [ ] Folder picker — call `window.wisp.invoke('pickFolder')` (bridge wired in Phase 0)
- [ ] `LibraryTable` with TanStack Table + virtualization
- [ ] Columns: Artist, Title, Version, BPM, Key, Energy, Genre, Duration, Path
- [ ] Filters: search box, BPM range, key, energy, missing-metadata toggle
- [ ] Status row showing `last scanned · n tracks`
- [ ] Scan progress toast subscribing to the hub
- [ ] Empty state w/ "Pick a folder" CTA

### Tests
- [ ] Filename parser unit tests (cover `Artist - Title (Extended Mix) [Label] 320kbps.mp3` and friends)
- [ ] Hash function: same file at two paths → same hash
- [ ] Scan against a `tests/fixtures/audio/` folder of 5–10 sample files

**Done when:** spec acceptance criterion 1 — pick folder, see tracks with BPM/key/energy.

---

## Phase 2 — Recommendation engine

**Goal:** Select a track → ranked list of compatible tracks with reasons.

- [ ] `Camelot` value type: parse `8A`/`12B`, expose `.Adjacent`, `.RelativeMajorMinor`, `.PerfectFifthUp/Down`
- [ ] `BpmCompatibility`: handle half/double-time (`126` ↔ `63` or `252` should rank reasonably)
- [ ] `EnergyMode` enum: Safe, Up, Down, SameVibe, Creative, Wildcard (per spec §7.2)
- [ ] `RecommendationService.Score(seed, candidate, mode)` returns `Score { Total, KeyScore, BpmScore, EnergyScore, GenreScore, Penalties, Reasons[] }`
  - Reasons are human-readable strings: `"Adjacent key (8A → 9A)"`, `"+1 energy lift"`, etc.
- [ ] Genre similarity: token overlap on a normalized genre string
- [ ] Penalty rules:
  - Same artist back-to-back (configurable weight)
  - Recently used in any mix plan (later, requires usage history)
- [ ] API: `GET /api/tracks/{id}/recommendations?mode=safe&limit=50`
- [ ] Frontend: `RecommendationPanel`
  - Score badge per row, expandable to show breakdown
  - Mode selector pill group
  - "Add to chain" button (disabled until a chain exists)
- [ ] Settings: weights overridable in `config.json` for power users

### Tests
- [ ] Camelot adjacency table: known matrix from Mixed in Key
- [ ] BPM scoring: edge cases at boundaries (1.0, 1.01, 2.0, 4.0, 4.01)
- [ ] Mode behaviour: Energy Up never ranks `-2` energy at the top

**Done when:** spec acceptance criterion 2 — open recommendations, ranked list with reasons.

---

## Phase 3 — Mix chain builder

**Goal:** Drag tracks into an ordered plan; see key/BPM/energy flow.

- [ ] `MixPlan` + `MixPlanTrack` entities (spec §10.3) + migration
- [ ] Use **fractional ordering** (`Order` as `double`, midpoint inserts) — avoids reindexing on every drag
- [ ] API:
  - `GET    /api/mix-plans` (list)
  - `POST   /api/mix-plans` (create)
  - `GET    /api/mix-plans/{id}`
  - `PATCH  /api/mix-plans/{id}` (rename/notes)
  - `DELETE /api/mix-plans/{id}`
  - `POST   /api/mix-plans/{id}/tracks` body `{ trackId, afterTrackId? }`
  - `PATCH  /api/mix-plans/{id}/tracks/{mptId}` (move, transition notes)
  - `DELETE /api/mix-plans/{id}/tracks/{mptId}`
- [ ] Frontend:
  - [ ] `MixChainBuilder` — vertical list of `TrackCard`s, dnd-kit sortable
  - [ ] Drag from `RecommendationPanel` and `LibraryTable` into chain
  - [ ] `EnergyCurve` — SVG line across the chain
  - [ ] `KeyPathView` — pill row showing each step + a warning marker on bad transitions
  - [ ] BPM delta strip between adjacent cards
  - [ ] Inline `TransitionNotes` text on each card
  - [ ] Sidebar: list of saved plans, create/rename/delete

### Tests
- [ ] Reorder via fractional indexing converges (no precision blowups in 1000 inserts)
- [ ] Concurrent edits: last-write-wins is acceptable (single-user app)

**Done when:** spec acceptance criterion 3 — drag a recommendation into the chain, order persists.

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

After that, audio (Phase 4) is the next-biggest leap — budget more time. Cue helper and cleanup are smaller phases by comparison.

---

## Out of scope for v1 (per spec §16, §17)

- BPM/key/energy detection from raw audio
- Automatic cue detection (drop, breakdown, outro)
- MusicBrainz lookups
- Rekordbox/Serato DB writes
- Mix generation from constraints (the "build me a 30-min set" feature)
- Track usage history influencing recommendations
