# Wisp implementation status

Last reviewed: 2026-09-11

## 2026-09-11: Fix direct track-row dragging to Windows apps and folders

- **Confirmed cause of the reported workflow:** Ctrl+A selected the tracks, but
  dragging their rows only created WISP's internal HTML drag payload. Explorer
  and rekordbox were not being offered a native multi-file selection. The separate
  native handle was also incorrectly gated on `/Windows/` in the user agent:
  [Photino.NET 4.0.16 identifies itself as `Photino WebView`](https://github.com/tryphotino/photino.NET/blob/v4.0.16/Photino.NET/PhotinoWindow.NET.cs).
  Reproduced the disabled handle against the previous client build with that UA;
  the earlier normal-browser mock test had missed it.
- **Implemented:** query native desktop capabilities instead of guessing from
  the user agent. On Windows, row dragging defaults to **Apps / folders** and
  hands off the full selected ID set, including non-rendered/off-page tracks.
  Ctrl+A then hold and drag any selected row; the separate handle also remains.
  **Drag rows to → Within WISP** preserves internal multi-track drags to WISP
  destinations. Removed the misleading single-file browser DownloadURL fallback.
  A trailing browser click cannot collapse the selection after native dragging.
- **Native lifecycle:** resolve files off the UI thread, return from the browser
  callback, then post the OLE drag onto the desktop STA thread through Photino.
  Direct `Invoke` from the callback previously ran inline; nested modal loops
  are unsupported by [WebView2's threading contract](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model#reentrancy).
  Catch exceptions inside native UI callbacks, prevent simultaneous drags in both
  client and host, and log file counts, early release, OLE return code and effect.
  Source paths are not added to these diagnostic messages. Copy-only CF_HDROP,
  Unicode paths, whole-selection missing-file validation and the 20,000-track
  cap remain. Audio files/library/clipboard are not modified by WISP's drag code.
- **Feedback:** distinguish early release from an unaccepted/cancelled drop,
  retain selection after errors for retry, explain destination/elevation checks,
  and hide old feedback when changing playlist/filter scope. No target import
  completion is claimed merely because Windows accepted the handoff.
- **Verification:** 197 backend tests and 28 client unit tests pass; client build
  and lint pass (13 existing lint warnings; existing NuGet advisories unchanged).
  Seven new committed Playwright browser regressions pass: Photino UA/capabilities,
  real mouse row gesture with all 1,205 IDs across pages, internal payload,
  handle/row mutual exclusion, missing-file retry, early release, unsupported host
  and capability error. Browser test code is type-checked by the client build;
  tests run in validation CI using isolated mocks, never the working music library.
  Existing resize/focus/persistence/800x600 layout checks also pass.
- **Verification boundary:** browser tests mock native destination responses;
  native file-data-object tests verify Windows COM/CF_HDROP, not a live drop into
  Explorer or rekordbox. After installing the main-branch release, manually test
  Ctrl+A → drag a selected row into an empty folder, then a rekordbox playlist.
  This is still **audio files only**, not WISP memory cues, metadata or USB sync.
  Work is delivered via develop PR; no local installer generated or running
  installation replaced. Main-only installer packaging remains unchanged.

## 2026-09-11: Adjustable library workspace and multi-file rekordbox handoff

The original external-handle/row behaviour below is superseded by the fix above.

- **Layout:** library/playlist prep is now a bounded pane with a visible drag
  divider. Its preferred height is remembered across sessions; resize also works
  with arrow keys, Home/End, and double-click reset. Bounds account for the actual
  surrounding toolbars so smaller windows retain track-list space. A fixed
  transport header remains accessible while prep contents scroll independently.
  Focus list collapses prep without stopping playback; Expand prep restores it.
  Waveform/cue bank, detail tabs, and library filters can be shown/hidden separately
  with persisted settings. Sidebar collapse remains available. Hidden active
  filters are flagged in the toolbar. Empty playlists no longer hide the player.
- **Selection:** Select all / Ctrl+A collects the full filtered library or active
  playlist across API pages, not just the initial 500 rows or rendered viewport.
  Counts, cancellation and failures are visible. Stable ID sort tie-breaking and
  consistency checks prevent silently incomplete selections. Selection survives
  page navigation but is discarded on playlist/filter/sort changes; revisiting a
  previous scope does not restore stale selection. Previous/Next controls expose
  the formerly unreachable pages. Existing Ctrl/Shift and internal WISP dragging
  continue to work, with complete cross-page row payloads retained.
- **External file drag:** the separate "Drag N files to rekordbox" handle starts
  a Windows OLE copy-only drag with a standard Unicode CF_HDROP file list. The
  desktop bridge accepts existing WISP track IDs and resolves the original files
  from the library, rather than trusting arbitrary client-supplied paths. Missing
  or removed files reject the whole request with an explanation; no silent
  partial drag. Up to 20,000 selected tracks per native drag; Escape/releasing the
  mouse cancels normally. No clipboard replacement, audio conversion, source
  movement or WISP-library write is performed. Normal row drags retain their
  internal WISP semantics; use the labelled handle for an external multi-file drag.
- **Important distinction:** this hands off existing audio files, not a rekordbox
  database, USB sync, WISP cues, or WISP-only playlist/metadata. Drop into the
  desired rekordbox playlist and let rekordbox import/analyse the tracks. The UI
  labels this as files-only and does not claim the target completed its import.
- **Verified:** 197 backend + 28 client tests pass (9 new test cases), client build
  and lint pass with 13 pre-existing warnings. A Windows native-data-object test
  verifies COM IDataObject exposure, format enumeration, Unicode multi-file reads
  via DragQueryFileW, and drag cancellation/drop feedback. Isolated Edge tests
  verify pointer/keyboard resizing, uninterrupted playback in list-focus mode,
  filters/toggle persistence, all 1,205 playlist IDs sent across multiple pages,
  page navigation, scope-reset safety, and usable list bounds at 800x600.
  Browser tests simulate the Photino bridge; no real rekordbox import was made.
  **A live WISP-to-rekordbox desktop drop remains a user smoke check**, including
  target file-format support and matching privilege level if Windows refuses a
  cross-application drop. No USB/CDJ compatibility claims are added.
- **Workflow:** feature PR into develop; no standalone executable or installer
  generated. Existing NuGet advisories are unchanged. Working library, music and
  settings were not changed during verification.
- Native protocol references: [Windows file-drop formats](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard),
  [OLE drop-source behaviour](https://learn.microsoft.com/en-us/windows/win32/api/oleidl/nn-oleidl-idropsource).

## 2026-09-11: Track-file recovery and safe library removal

- **Diagnosis:** the Olive entry still referenced the deleted filename ending
  `Remaster .aiff`; the replacement had a different filename and was not linked.
  The previous file also produced an unsupported AIFC error. That error alone
  cannot distinguish corruption from an unsupported encoding; the user reported
  that external playback failed as well. The replacement fully decodes (280.291s).
- **Relink audio file:** available from the library/playlist row context menu,
  track-prep action row, and actionable playback-error banner. Desktop Browse
  opens a native audio-file chooser; the WISP-styled modal also accepts a full
  path for browser development. Validation decodes the entire candidate before
  committing its path, fingerprint, duration and file dates. It preserves track
  identity, added date, curated metadata, notes, tags, editorial/device cues,
  playlist membership and mix-plan prep. Missing metadata is filled where possible.
  Same-path replacements are supported; duplicate links (case-insensitive), stale
  dialogs, missing/non-audio files, decode failures and busy-library changes are
  rejected with a reason and no relink. No source file is copied, moved or edited.
- **Remove from WISP:** explicit modal confirmation explains deletion of the
  library entry and its prep/playlist/mix-plan references. Audio files stay on
  disk. Wanted matches reset; cleanup history is retained, with old file-changing
  undo actions marked Superseded after removal/relink so they cannot restore the
  previous path. Archive remains the non-destructive way to hide an entry and
  retain all prep. Scans, cleanup and recovery serialize their file-link changes.
- **Recovery feedback:** Include missing files exposes retained unavailable
  tracks, with a missing-file indicator. Playback distinguishes missing files,
  unreadable/unsupported audio and connection failures, with Retry and Relink.
  Per-track audio revisions refresh all loaded decks and waveform views after a
  relink, without reusing pre-relink in-flight waveform results or failed loads.
  Relinking pauses the main player; cue timestamps are retained, not retimed.
- **AIFF handling:** existing standard PCM conversion remains. Unsupported AIFF
  variants fall back to the configured/bundled/PATH FFmpeg and a disposable 24-bit
  PCM WAV for browser playback. Float conversion is not claimed bit-perfect;
  source files and USB-export audio are unchanged. Versioned source-sensitive
  cache paths and unique temporary files prevent old/partial or competing
  player/waveform requests from corrupting the cache. Cancellation cleans up.
  Also corrected fingerprinting of files between 1 and 2 MiB, found during review.
- **Verification:** 193 backend + 23 client tests pass (19 new cases). Tests cover
  prep/identity preservation, same-path replacement, duplicate/stale/busy paths,
  invalid candidates, removal cascades without file deletion, waveform revision
  races, AIFF concurrent conversion/cancellation, and the fingerprint boundary.
  An isolated HTTP host and Edge browser exercised missing-file errors, modal
  cancellation, real invalid/valid file validation, relink, rebuilt waveform,
  actual playback, and confirmed library removal with the file still present.
  A real floating-point AIFC fixture passed the FFmpeg fallback. The user's Olive
  replacement was read/decoded only and its SHA-256 remained unchanged; the
  working WISP library/configuration were not modified. Native file-picker API
  compiled; OS chooser interaction still needs a desktop smoke check.
- **Limits:** cue/loop timing must be checked if a replacement has different
  content or duration; no automatic retiming or duplicate-entry merging. Relink
  validation requires FFmpeg and times out after three minutes. A future scan can
  import a removed file again as a new entry (the removal modal explains this).
  Original discovery/import rules and CDJ compatibility are unchanged. Existing
  13 client lint warnings and NuGet advisories remain. No standalone executable
  or installer is built for this feature branch; release remains main-push only.

## 2026-09-11: Discover Anywhere track-search reliability

- **Root cause verified live:** `Brent Laurence - Big Buds`, video
  `keTtiDqQrpc`, is categorised as 22 rather than Music (10). WISP's hard-coded
  `videoCategoryId=10` filter excluded it. The old request returned two other
  tracks; the unrestricted, normalized search returned this exact video first.
- **Implemented:** free-text search now queries all video categories in
  relevance order, with up to 25 results and no Topic-channel upload injection
  or subsequent 24-row truncation. Artist/title separators are normalized
  without removing hyphens inside names or intentional `-word` exclusions.
  Search titles/channel names are HTML-decoded before rendering.
- **Direct links:** recognised YouTube watch/short/embed/live URLs and youtu.be
  links resolve through `videos.list` using a validated, case-sensitive ID.
  Playlist/time parameters are ignored. The pasted URL is never fetched as an
  arbitrary network destination. Direct lookups avoid the local search-call
  budget, but still require API credentials and available Google quota.
- **Reliability/feedback:** one search request per uncached text lookup;
  successful results are cached with distinct text/video keys. Empty/error
  responses are not cached for the rest of the day. Concurrent source failures
  are collected safely. UI adds Retry search, direct-link guidance and a YouTube
  website fallback, and labels the quota meter as WISP's local counter instead
  of claiming it is authoritative Google-project usage.
- **Related Discover bug fixed:** Watch embeds and release fallback searches
  incorrectly targeted `www.Tv.com`; they now use tested YouTube URL helpers.
- **Verification:** 178 backend tests and 19 client tests pass, including 14 new
  backend search cases and two link regressions. Updated endpoint tested against
  live YouTube in an isolated HTTP host: exact video first for text (6 results),
  sole result for the pasted link; only one search.list request for both.
  Browser checks replaying those live responses verify Anywhere handoff, display,
  embed URL, direct-link lookup, empty results, retry and quota messages. Build
  and lint pass with existing warnings. Working library/configuration unchanged;
  no WISP standalone executable or installer packaged.
- **Limits:** this is API-ranked search (first 25 results), not a guarantee of
  parity with personalised YouTube website results. Private/deleted/unavailable
  videos can still fail direct lookup. My artists/catalogue refresh is unchanged.
  References: [search filters and query syntax](https://developers.google.com/youtube/v3/docs/search/list),
  [video lookup](https://developers.google.com/youtube/v3/docs/videos/list).

## 2026-09-11: Soulseek transfer cancellation and history cleanup

- **Implemented:** queued/downloading rows have a visible Cancel action;
  completed, failed and cancelled rows have Clear, plus a bulk Clear finished
  action. Shared controls appear in the header transfers window and search
  dialog. Buttons show pending states, prevent concurrent duplicate actions and
  retain actionable errors. The transfers window remains reachable after a
  batch finishes, and reload fetches the daemon's current transfer history.
- **Semantics:** cancellation targets the exact username/transfer ID and retains
  its cancelled history. Clearing removes finished transfer history in slskd,
  never downloaded audio or WISP library/cue records. Active rows cannot be
  cleared; bulk clearing selects only finished rows. Successful downloads remain
  listed until their WISP import scan completes successfully, with an explanation
  if a clear attempt is deferred. Partial clear failures report retained entries.
- **State correctness:** shared terminal-state parsing recognizes success,
  cancellation, timeout, rejection, abort and error flags. Failed transfers no
  longer appear as Done or keep polling forever. Search-result transfer matches
  include username as well as filename.
- **Verification:** 164 backend tests and 17 client tests pass; client lint/build
  pass with the existing warnings. Browser tests with mocked APIs cover queued
  and active cancellation, individual/bulk clear, import deferral, daemon error
  recovery, empty history access and an 800px window. No real transfers were
  cancelled/cleared during verification, and no standalone package was built.
- **Protocol reference:** checked against bundled slskd 0.25.1's
  [transfer controller](https://github.com/slskd/slskd/blob/0.25.1/src/slskd/Transfers/API/Controllers/TransfersController.cs)
  and [download service](https://github.com/slskd/slskd/blob/0.25.1/src/slskd/Transfers/Downloads/DownloadService.cs).
  The transfer DELETE operation uses `remove=false` for cancel and `remove=true`
  only for selected finished entries; the file-management API is not called.

## 2026-09-11: development and production pipeline separation

- **Implemented:** feature PRs target `develop`; the owner promotes reviewed
  changes from `develop` to `main` (production). Contributor instructions record
  this flow and avoid unsolicited local executable builds for routine work.
- **Validation only:** PRs into either branch, pushes to `develop`, and manual
  workflow runs execute backend tests and client tests/lint/build without
  installer packaging or artifact uploads.
- **Production only:** the installer job requires successful validation plus
  both a `push` event and `refs/heads/main`. This includes merges into `main`,
  but excludes promotion PR checks, development pushes and manual runs.
  Production installation/upgrade/uninstall checks and artifact retention remain.
- **Retries:** re-run an existing main-push run to retry its production package.
  The workflow file is retained so its run-number-based version sequence continues.
- **Scope:** this changes CI policy, not repository protection settings. The
  branch flow is documented; it does not technically block direct main pushes.
  No installer is built locally for this pipeline change.
- **Verified locally:** all 151 backend tests and 4 client tests pass, including
  three YAML policy checks for branch triggers, the main-push/validation gate,
  and the absence of packaging/upload steps in validation. Client build/lint
  pass with existing warnings. Actual main packaging awaits owner promotion.

## 2026-09-11: Crate Digger rescan verification and feedback

- **Fixed:** the rescan endpoint returned an empty HTTP 202 response while the
  frontend expected JSON. The background scan ran, but the resulting parse error
  prevented progress tracking. The endpoint now returns a JSON acknowledgement.
- **Implemented:** visible queued/running states and persistent, dismissible
  completion results: "No new tracks found", new-track counts, upload-date update
  counts, videos checked and completion time. Failures remain visible, connection
  interruptions show a reconnecting message, and both rescan controls report
  start-request errors. Results remain while the Crate Digger page is mounted;
  they are not a durable cross-restart scan history.
- **Reliability:** duplicate requests for a queued/running source enqueue only
  once. The progress bus retains and replays the latest result so fast scans and
  reconnecting subscribers cannot miss completion. A new run resets that result.
  Unexpected worker errors also terminate progress instead of leaving it pending.
- **Live verified:** two actual YouTube rescans of `mastercarper`, using an
  isolated copy of the user's database/configuration. Both checked 76 videos and
  found no new tracks; the first backfilled 76 upload dates and the second updated
  zero dates. Browser automation confirmed the result stayed visible until
  dismissed, another rescan worked, and a simulated quota failure displayed an
  alert. The working library/configuration were not modified by these tests.
- **Regression coverage:** JSON scan acceptance, duplicate POSTs/queue requests,
  late completed/failed/cancelled subscribers, restart after completion, scanner
  counts, date backfill and post-completion SSE replay. Full .NET suites and
  frontend tests/build pass; pre-existing lint/dependency warnings remain.
- **Local delivery:** standalone Windows build `artifacts/rescan-release/Wisp.exe`
  (0.1.7). This does not replace the installed app or update its shortcut.

## 2026-09-11: Crate Digger upload-date ordering

- **Implemented:** a persistent Sort by dropdown for newest/oldest YouTube
  uploads and newest/oldest WISP imports. Newest upload is the default. Sorting
  happens in SQLite before pagination and composes with source, search and status
  filters; stable ID tie-breaks prevent random order within a scan batch.
- **Cause addressed:** discovery scans previously assigned a single ImportedAt
  timestamp to the whole batch and the API sorted only by that timestamp. The
  video publication date was fetched but never persisted.
- **Date semantics:** nullable UTC PublishedAt comes only from YouTube's
  `contentDetails.videoPublishedAt`; `snippet.publishedAt` describes addition to
  a playlist and must not masquerade as an upload date. Rows display upload dates;
  unknown dates sort last, with a rescan hint and a visible Rescan source action.
  Reference: https://developers.google.com/youtube/v3/docs/playlistItems
- **Existing sources:** rescan once to backfill available upload dates. Rescans
  preserve imported dates, IDs, manual parse corrections, statuses and library
  matches, and deduplicate repeated videos across pages. Initial automated tests
  mocked YouTube; the later rescan verification above also checks a real source
  in an isolated profile, without changing the working library.
- **Pagination:** Previous/Next controls expose all imported records, 500 per
  page, resetting to page one when source/filter/order changes. This does not
  remove the existing scan caps (5,000 channel uploads / 1,000 playlist items); sorting applies to records
  WISP has imported, not unseen YouTube items beyond that cap.
- **Regression coverage:** both upload directions, both import directions,
  unknown dates, UTC, equal-date page boundaries, filtering and source scope,
  plus channel/playlist rescans with date backfill and preserved user preparation.

## 2026-09-11: library dates and Soulseek download destination

- **Implemented:** library and playlist-scoped views expose date-added and
  file-date-modified sorting in both directions, plus an added-within filter
  (24 hours / 7 / 30 / 90 days). Newest-added is the initial default; the selected
  sort survives navigation and relaunch. Date columns are sortable too.
- **Date semantics:** added means first imported into WISP, not filesystem creation
  or playlist membership. Rescanning does not reset it. Modified means the file's
  UTC last-write time; scans and WISP tag writes refresh it. A nullable-column
  migration and startup backfill populate dates for accessible existing files
  without changing prep data. Missing dates sort last. External edits require a
  rescan; this is not a live filesystem watcher.
- **Implemented:** Settings → Soulseek download folder remains editable after
  connection setup without re-entering or clearing credentials. It shows the
  daemon's active directory and the next-launch destination, supports a desktop
  folder picker, a detected music-folder suggestion, and restoring the default.
  Custom destinations must be existing absolute paths.
- **Safety:** saves affect future managed downloads after restarting WISP; no
  existing audio is moved, renamed or deleted. Completed downloads keep slskd's
  subfolders and are indexed in place. The importer follows the daemon's active
  directory rather than a pending preference. External slskd directories remain
  controlled by that daemon. Import scan IDs let the UI refresh on real scan
  completion instead of guessing with short delays.
- **Default location:** `%LOCALAPPDATA%\Wisp\slskd\downloads` (or the equivalent
  under `WISP_DATA_DIR`). A library can index multiple folders without physically
  combining them. Setting the destination to an existing music folder keeps
  future downloads beneath that folder; migrating older downloads is separate.
- **Regression coverage:** date sorting/filtering with playlist scope and
  pagination, UTC serialization, rescan/backfill preservation, settings persistence
  and credential preservation, invalid/external path rejection, importer path
  precedence, deduplication and retry, and preservation of same-named files.

## 2026-09-11: Wispa branding

The approved Labrador/record logo is now a scalable vector master with generated
multi-resolution Windows icons. It is used in the sidebar (expanded and collapsed),
Settings header, browser tab, executable, Photino window/taskbar and installer.
Branding source, provenance and regeneration instructions live in
`design/branding/README.md`. This change does not alter USB export behavior.

## 2026-09-09: current status and Windows packaging

This summary supersedes the contradictory historical USB entries below.

- **Hardware-confirmed:** a template-backed WISP playlist appeared and all three
  tracks played on CDJ-850. Equivalent successful CDJ-900 acceptance is not recorded.
- **Still unresolved:** exports retain the template catalogue, Memory Cue recall
  has not been confirmed, and Pioneer waveforms/beatgrids are not generated.
  A fresh USB still requires a separate player-accepted Pioneer database template.
- **Next physical test:** select two clearly separated CDJ Memory cues on each of
  the three known-working tracks, explicitly export, then browse the `WISP — …`
  playlist and test stored Memory Cue recall on CDJ-850 and CDJ-900 separately.
  Report playlist visibility, playback and cue timestamps for each player.
  Extra template tracks and absent waveforms are expected with this diagnostic build.
- **Windows installer implemented:** successful pushes to `main` build a
  self-contained per-user installer; PR/development/manual runs validate only
  (see the pipeline separation update above). It bundles the client,
  .NET, pristine slskd and FFmpeg; WebView2 is installed if missing. The existing
  `%LOCALAPPDATA%\Wisp` library survives upgrades and uninstall. CI includes an
  install/startup/reinstall/uninstall check. No automatic app updater or code
  signing is configured. Packaging does not change CDJ export compatibility.

> Current implementation status: **template-backed CDJ export is enabled for physical testing.** A removable-drive export no longer creates a DeviceSQL database from scratch. Wisp reads a separate, player-accepted `PIONEER/rekordbox/export.pdb` (for the present test setup, `F:`) as a **read-only** allocation template, appends Wisp tracks and playlists to a staged copy, validates the added rows, and installs that copy on the selected USB (for the present test setup, `H:`). The template drive is never written to.

> Current diagnostic mode: Wisp deliberately retains the template catalogue while verifying that a newly appended Wisp playlist is visible and its copied tracks load on the CDJ. Attempts to delete template rows caused CDJ-850 read failures and are paused pending a real before/after rekordbox deletion fixture. This diagnostic USB is not a release-ready library.

> Memory Cue diagnostic: the successful playlist/audio result enables the next isolated pass. Wisp now writes each selected track's `ANLZ0000.DAT` sidecar and PCOB Memory Cue records, while retaining the accepted template catalogue. The CDJ-850 must now confirm cue recall for the `WISP — …` playlist before cue support can be considered validated.

## 2026-07-28: fixture-backed Pioneer database editor

- **Implemented.** `PioneerTemplatePdbEditor` follows the established incremental DeviceSQL allocation model: it preserves table/index pages, consumes each table's existing empty-candidate page, appends rows with real row-directory masks and allocation accounting, then advances the candidate pointer.
- **Implemented.** The template's tracks and playlists are removed using DeviceSQL's delete-only transaction form: presence masks, deletion flags, present-counts, write-generation values and delete-only sentinels are updated while the accepted page accounting remains intact. `H:` uses `F:` only for accepted database structure and does not advertise `F:`-only tracks or playlists.
- **Implemented.** `PioneerDeviceLibraryWriter.WriteFromTemplate` assigns non-colliding Pioneer IDs for tracks, artists, genres, playlists and playlist entries, and maps Wisp playlist membership to those IDs.
- **Implemented.** The Mix Plan and Playlist “Export to CDJ USB” actions are re-enabled. A root-drive export requires exactly one separate Pioneer template (or an explicit `WISP_PIONEER_TEMPLATE` path); it fails safely before replacing `H:` if none is available.
- **Regression-covered.** The test suite now verifies that an existing PDB can be used as a template and that appended tracks/playlists retain valid IDs and ordering without rebuilding the database.
- **Still pending physical acceptance.** This implementation deliberately keeps generated `ANLZ` / Memory Cue data out of the first template-backed USB, because the former hand-authored sidecar was never accepted by the players. The next device test is browse + playback + playlist + metadata/BPM. Memory Cue/loop sidecars will be reintroduced only once the catalogue mounts successfully, then verified separately on CDJ-850/900.

> CDJ direct export is **under rebuild and unavailable**. Four physical CDJ-850 export attempts showed that matching selected DeviceSQL fields is insufficient; the fresh database initializer is not accepted by the player. The replacement must be a fixture-backed incremental editor that begins from a verified Pioneer PDB structure.

## Reliability and quality remediation

- **Rescan safety — implemented.** A missing file is now retained as an unavailable track instead of being deleted. Its cue points, playlists, tags and mix-plan entries remain intact and are restored when the same path returns.
- **Credentials at rest — implemented.** Spotify, Discogs, YouTube and Soulseek secrets in `%LOCALAPPDATA%\Wisp\config.json` are protected with Windows DPAPI for the current Windows user. Existing plain values are migrated on the next settings save.
- **Frontend quality — implemented.** Lint errors have been removed. Imperative Web Audio mutations and external-identity draft resets remain documented lint warnings rather than release-blocking errors.
- **Regression coverage — implemented.** The library scanner has explicit tests for both retaining a missing track and restoring it on a later scan.

## USB sync

- **Portable file sync — implemented.** A mix plan can be copied to a selected USB root from the desktop app. Wisp writes audio files beneath `Contents/`, portable M3U8 playlists beneath `WISP/playlists/`, and a Wisp-only incremental sync manifest at `WISP/sync-manifest.json`.
- **Safety guarantees.** Only `Contents/` and `WISP/` are written; copies use a temporary file and replacement to avoid partially copied playable files.
- **Current player outcome.** This is functional *folder-browse* media on players that support the copied format and filesystem. Source-file tags (artist/title/BPM/key/artwork when present) are preserved by copying.

## CDJ-850 / CDJ-900 compatibility decision

The complete implementation specification lives in **Phase 25 — CDJ-850 prepared USB export** in `WISP_IMPLEMENTATION_PLAN.md`. Its first shippable vertical slice is now implemented: Wisp can create a staged conventional `EXPORT.PDB`, ordered Pioneer playlists, and per-track `ANLZ0000.DAT` Memory Cue/loop sidecars; it validates the generated page structure, playlist links, analysis paths and Memory Cue counts before installation. The desktop export flow preflights capacity/formats, requires explicit approval to replace an existing `PIONEER` library, and moves that library to `WISP/backups` first. Editorial cues are only exported after the user marks them **CDJ cue**.

This is still **not** a claim of proven CDJ-850 compatibility. It intentionally does not invent Pioneer beat-grid or waveform data, and must pass the physical-device acceptance matrix before being relied on at a show.

The requested full experience — database browsing, playlists, BPM, metadata and stored cues without rekordbox — requires writing Pioneer’s conventional Device Library (`PIONEER/rekordbox/export.pdb`) plus associated analysis data. Wisp does **not** claim that support yet. No official supported writer is available, and an unverified writer risks a USB that appears empty or corrupt at a show.

The CDJ-850 is rekordbox-ready and supports conventional-library export, but it does **not** recall Hot Cues; its reliable prepared-cue workflow is Memory Cues. The original CDJ-900 similarly predates pad-based Hot Cues. Wisp must therefore map its cue points to supported Memory Cues and explicitly state per-player limits, rather than promise every cue type as a Hot Cue.

### Required before marking “CDJ-850/900 prepared USB” as shipped

1. Implement a versioned conventional-Device-Library writer using verified fixtures, with no mutation of an existing Pioneer directory until validation passes.
2. Persist an explicit export-cue model (Memory Cue / loop / Hot Cue) rather than inferring all Wisp editorial cue labels as interchangeable device cues.
3. Generate or deliberately omit analysis data with an honest UI capability matrix. BPM tags alone do not create a Pioneer beatgrid or waveform.
4. Test the generated USB on physical, current-firmware CDJ-850 and original CDJ-900 units: startup, playlist browse, metadata/BPM display, memory-cue recall, loops, missing/unplugged recovery, and repeated incremental sync.
5. Keep a standard rekordbox-exported backup USB until that hardware matrix has passed for a release.

## 2026-07-28 implementation update

The two historical paragraphs and checklist above are superseded in part by the current implementation: Wisp now writes a staged `PIONEER/rekordbox/EXPORT.PDB`, Pioneer playlists and per-track `ANLZ0000.DAT` Memory Cue/loop sidecars, and validates them before installation. The direct export action is visible in both the active Mix Plan header and the selected Playlist banner; the playlist route does not require a Mix Plan.

The physical CDJ-850 and original CDJ-900 acceptance tests remain outstanding. Wisp deliberately does not fabricate beat-grid or waveform data, so a standard rekordbox USB should remain the backup until mount, playback, browse, metadata, Memory Cue recall and loop tests have passed on the target players.

### Hardware-test finding: 2026-07-28

The first CDJ-850 test of the Wisp `H:` export showed an empty device. A read-only comparison with the working rekordbox `F:` USB found `F:/PIONEER/rekordbox/export.pdb` (4.7 MB, 419 analysis files), while `H:/PIONEER/rekordbox` was empty after the player test despite Wisp's export receipt. The Wisp writer also had an invalid Track-row layout: the DeviceSQL string offsets began six bytes early and overwrote the file-type fields. This was corrected and covered by a regression test. A fresh physical-device re-export and acceptance test is required before compatibility can be claimed.

The fresh re-export retained a 106 KB `H:/PIONEER/rekordbox/export.pdb`, but the CDJ-850 still displayed an empty device. Direct CDJ export is therefore disabled in both the desktop UI and API. It must be replaced by a fixture-verified DeviceSQL writer and pass the physical acceptance matrix before it can be enabled again. Wisp's portable track sync is unaffected; it does not claim Pioneer-library or Memory-Cue compatibility.

### Hardware-test finding: second export, 2026-07-28

After a fresh export to `H:`, the USB contained the expected audio files, analysis sidecars and a 106 KB `PIONEER/rekordbox/export.pdb`. On the CDJ-850, however, the player flashed red continuously while attempting to read it. A read-only PDB inspection identified the direct cause: the writer gave every empty DeviceSQL index page a self-referential `next_page` pointer and left its required empty-index allocation entries as zeroes. Wisp now writes the `0x1ffffff8` empty-entry sentinel and no longer creates that cycle.

The subsequent `H:` test no longer flashed red on either CDJ-850 or CDJ-900, but both devices reported the USB as empty. The next read-only comparison found every Wisp table's `empty_candidate` field was page zero, whereas Rekordbox seeds a blank candidate page for each table and advances the candidate pointer on each data-page allocation. Wisp now creates the same 41-page initial allocator (header, 20 index pages, 20 reserved blank candidate pages), preserves the `0x03ffffff` empty-table sentinel, and tests those invariants. This is the next narrowly scoped hardware-test build; it still does not claim production compatibility.

### Catalogue-isolation test: pending

The seeded allocator did not yet make the third `H:` export visible on a CDJ-850. The next build deliberately writes a catalogue-only PDB: track paths, metadata and playlists remain, but Wisp leaves the analysis path empty and writes no `ANLZ` sidecar or Memory Cue. This isolates whether Pioneer analysis validation is causing the player to discard otherwise-readable database rows. This diagnostic mode is temporary and explicitly does **not** implement cue export.

The catalogue-only test still appeared empty. Comparing the table headers byte-for-byte with the working fixture exposed a final initializer error: for an empty table, Wisp put `0x03ffffff` in both `next_page` fields. Rekordbox stores the table's reserved `empty_candidate` in the common page-header `next_page`, while retaining `0x03ffffff` only in the index-specific first-data-page field. The writer and regression test now enforce this distinction before the next physical test.

The fourth CDJ-850 result was still an empty USB. Direct hardware testing is now paused: the accumulated results show that Wisp's hand-built fresh initializer remains incomplete despite matching the inspected fields. The implementation is being replaced by a fixture-backed incremental editor, modelled on the verified `rekordbox-pdb` approach: start from a known-good PDB template, preserve its page allocator and table state, append Wisp rows using the format's actual allocation rules, and only then restore ANLZ / Memory Cue support. The UI and API direct-export route are disabled until that replacement has local fixture conformance and a new device test.

## Source references

- AlphaTheta’s USB-export compatibility table lists CDJ-850 under the conventional library format: https://rekordbox.com/en/support/usb-export/
- Pioneer’s CDJ-850 product page confirms USB playback and rekordbox metadata / BPM / waveform support: https://www.pioneerdj.com/en/product/dj-players-turntables/cdj-850/
- Pioneer support confirms the CDJ-850 cannot call Hot Cues: https://forums.pioneerdj.com/hc/ja/community/posts/360057765391-CDJ-850-and-2000s-Memory-Cue-points-with-wav
