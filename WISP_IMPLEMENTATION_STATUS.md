# Wisp implementation status

Last reviewed: 2026-09-13

## 2026-09-13: Phase 26e — detailed feedback and revised Mix Plans

- **Implemented for review:** Feedback & next attempt groups 1–5 satisfaction,
  overall notes, review status and timestamped comments. Point/range comments support
  categories, optional occurrence/transition associations, edit/remove and revisit/
  resolved states. Click times to seek with bounded pre-roll or loop a comment range.
  Quick bookmarks remain separate. No global track rating or recommendation changes.
- **Draft safety:** explicit Save feedback commits rating, status, notes and comments
  atomically, with optimistic checks against both feedback and quick-marker/rating
  revisions. Local unfinished drafts and errors survive navigation/reload, including
  saves that fail while away. Discarding a draft requires confirmation. Browser
  storage failure produces an explicit session-only warning; save to WISP before
  clearing browser storage or closing. Drafts are not part of the database backup.
- **Timing/history:** new live comments use captured-frame time at save, not UI time.
  If recording stops before saving a live comment, its text is retained and the user
  explicitly chooses a playback time. Deleted tracklist associations retain their
  copied label and timestamps. Capture finalisation cannot overwrite review edits.
- **New plan from a take:** choose saved blueprint or confirmed actual order, name
  the new plan, select saved feedback, and preview before creating. Draft actual
  entries require explicit exclusion; manual/deleted references require library
  matching or omission. Repeats stay separate. Valid same-track source cues/anchors
  survive; recording timestamps never become song cues. Changed next-track pairs
  do not inherit inappropriate old transition notes. Unavailable audio is warned.
- Creation is atomic and idempotent, with durable recording/parent-plan lineage and
  revalidation of preview content. Stale library/feedback/tracklist data cannot
  silently change a previewed plan. Original plans, takes, annotations and snapshots
  are never rewritten; deleting a plan preserves lineage. Downgrade guards protect
  nonempty feedback/history tables. Revision choices/previews reset on navigation.
- **Verification:** 446 tests (111 core / 66 infrastructure / 153 API / 53 client /
  63 browser), including the linked-plan/two-take loop, selected feedback, repeated/
  missing references, invalid ranges, stale saves, atomic failures and persisted
  drafts. Existing drag, playlist, loudness and recording-close regressions remain
  passing. Client build/browser-test typecheck pass; lint has zero errors and 13
  existing warnings. Existing NuGet vulnerability warnings remain. Isolated profiles
  and generated audio only; no live library/database/D:/Mixes edits or installers.
- **Next:** Phase 26f export/file lifecycle. The existing >4 GiB browser playback
  limitation remains; hardware long-session/unplug acceptance is still outstanding.
- **Owner's UI feedback is an explicit Phase 26g requirement:** the current recording
  page is not intuitive or visually organised enough. Redesign it into distinct
  functional areas for capture, mix history, playback/review and plan/tracklist work.
  This is a structural UX pass, not just colours or spacing; it remains deferred
  until functionality is complete. New review controls use the current design
  system and are grouped, but are not claimed as the final recording UI.

## 2026-09-13: Phase 26d — saved blueprints and actual recording tracklists

- **Implemented for review:** optional Mix Plan selection before recording and
  Record this plan from the plan page. Setup still requires explicit Start; no
  automatic capture or song recognition. Session and immutable blueprint snapshot
  are registered atomically before capture. Each new take saves the current plan.
- Existing/imported mixes can link a plan later, clearly labelled as a snapshot
  taken then, not historical proof of the original plan. Re-linking/unlinking keeps
  every older snapshot and the actual tracklist. Links work in both directions;
  the plan page lists takes with any historical snapshot of that plan.
- Actual entries are independent of the plan: explicit draft copy into an empty
  list, library/manual additions, repeated occurrences, removal and reordering.
  Unconfirmed, Played/Untimed and Played/Timed are distinct. Set start here uses
  playback position; optional live Track started uses backend captured frames.
  Manual time correction, clearing, seek-to-entry and waveform markers are included.
  The shared in-app text prompt now uses a labelled, focus-trapped dialog (matching
  existing confirmations), with validation feedback and focus restoration on cancel.
  Equal starts are valid; conflicting order warns and offers explicit sorting.
- Recorded starts never become song cue points. Generic review markers never
  become track entrances. No drafts are represented as confirmed performance.
  Full comparison/revised-plan feedback tools remain Phase 26e; exports remain 26f.
- Separate tables and optimistic revisions protect against stale overwrites and
  capture finalisation races. Plan/track deletion keeps historical text; recording
  removal never deletes its plan. Downgrade guards refuse nonempty history loss.
- **Verification:** 417 tests (100 core / 66 infrastructure / 143 API / 50 client /
  58 browser); client build and browser-test typecheck pass. Lint has zero errors
  and 13 pre-existing warnings; existing NuGet vulnerability warnings remain.
  Tests cover A/B/C planned versus A/X/C actual, live-plan edits between takes,
  repeated/deleted sources, import then link, stale writes, clock-based entrances,
  failed-save retry, navigation, and the existing drag/playlist/close regressions.
  Isolated test profiles only; no changes to live library data or D:/Mixes audio,
  no installer packaging and no new hardware compatibility claim.
- **User test:** open an existing take, expand Saved blueprint, link a plan and
  Copy blueprint as draft. Remove what you skipped, add what you played instead,
  then seek and Set start here. Confirmed played can also remain untimed.
- **UI direction:** the owner wants functionality first and a dedicated recording
  page design pass at the end. Current controls reuse WISP styles/modals; this is
  not the final recording layout. Existing >4 GiB browser playback limitation remains.

## 2026-09-13: Clarified Mix Plan linking before Phase 26d

- **Agreed design, not implemented:** a Mix Plan is an optional blueprint saved as
  an immutable snapshot; each recording has an independent editable actual tracklist.
  Recording remains hands-off and a spontaneous mix never requires a plan.
- Explicitly copying planned tracks creates unconfirmed, untimed draft occurrences.
  Users can remove skipped tracks, reorder, add library/manual-text tracks and assign
  entrance times at the waveform with Set start here. Repeated tracks have separate
  occurrence IDs; confirmation and timestamp presence are independent states.
- Times are recording-relative entrances, allow overlapping transitions and are
  never inferred from track length or song cues. Plan comparison, text exports and
  creation of a revised plan must distinguish confirmed performance from draft plans.
- Added acceptance cases and revision/export rules to the tracked recordings plan.
  This is documentation only; Phase 26d linking/tracklists remain unimplemented.

## 2026-09-13: Phase 26c — recordings workspace and playback

- **Implemented for review:** a lazy-loaded Recordings workspace with searchable
  history, date/title/duration/rating sorting, keyboard/pointer-resizable history,
  waveform-led playback and collapsible recording setup/file management. Reuses
  WISP's palette, typography and modal behavior; inspected at 800x600 and 1440x1000.
- **Playback:** seekable range-served audio, 10-second jumps, volume, waveform
  zoom/window navigation, section looping and configurable marker pre-roll. The
  player pauses on navigation/selection; playback position and view preferences
  are currently session-local. Capture continues independently. The global capture
  indicator now suppresses browser/mini-player playback while recording to avoid
  feedback; there is still no software monitoring.
- **Waveforms:** explicitly start Prepare waveform; a cancellable backend job reads
  the owned float master in 64 KiB buffers, producing up to 200,000 fine extrema
  buckets plus coarser levels. No whole-file browser decode. Results cache under the
  profile, keyed by recording/hash with length/mtime invalidation; missing masters
  do not return cached waveforms. Failed/cancelled jobs can be restarted.
- **Review foundations brought forward:** optional 1–5 rating (distinct unrated)
  and up to 500 labelled point markers. New live markers use server captured-frame
  time; playback markers use recording-relative seconds. RecordingReviews is a
  separate table with optimistic revision checks, so capture finalisation cannot
  overwrite edits. Failed saves remain visible and preserve the current label draft.
  Full point/range comments, categories, review status and plan revision workflows
  remain Phase 26e; the Tracklist panel explicitly identifies Phase 26d as pending.
- **Import:** WAV/MP3/FLAC/AIFF via native file selection, chosen managed destination,
  background progress and cancellation. Retains both the untouched external source
  and an exact managed source copy, then fully decodes to a 44.1 kHz stereo float
  playback master. This can resample/downmix; it does not improve original quality.
  Exact source/master hashes prevent duplicate imports of visible Ready entries.
  Capture/import share a lease; aborted imports retain partial files and are marked
  Failed, never silently promoted as complete recordings. Restart explains interrupted
  imports; retry explicitly starts a new import. File deletion confirmations now
  include managed source copies but never external originals or relinked files.
- **Verification:** 395 tests (94 core, 66 infrastructure, 134 API, 47 client unit,
  54 browser), including real FFmpeg import of all four formats, duplicate/corrupt/
  cancelled import, source preservation, cached peaks/extrema, stale-review rejection,
  live-frame markers and real browser range playback/looping. Existing drag,
  playlist, loudness and close-dialog suites remain passing. Client build passes;
  lint has zero errors / 13 existing warnings. Existing NuGet vulnerability warnings
  remain. Isolated test profiles only; no live database/music edits or installer build.
- **Known limits:** >4 GiB RF64 masters still need external audio playback, although
  backend waveforms and review markers work. Browser section loops use media events,
  not sample-accurate DAW looping. Import progress is approximate; cancel/failure
  intentionally retains managed partials for manual inspection, not automatic cleanup.
  Phase 26f will add export/compatible derived-file lifecycle. Real Xone long-session,
  sleep/unplug and actual native close acceptance remain outstanding from Phase 26b.
- **Try next:** select the existing mix in Recordings, Prepare waveform, play/seek,
  mark a transition, click it to revisit with pre-roll, and rate the take. Phase 26d
  will link these takes to immutable Mix Plan snapshots and performed tracklists.

## 2026-09-13: Phase 26b hardware check and repeat-close fix

- User reports both decks recorded correctly in a roughly ten-minute mix on
  Input 1. Read-only FFmpeg analysis of the resulting local master found 10:37.41
  of stereo 44.1 kHz float audio, successful full decoding, matching file/checkpoint
  lengths, -1.9 dBTP true peak and no per-channel silence of at least one second
  below -60 dBFS. Metadata is Ready with no issue. This is technical validation,
  not a listening critique or proof against brief glitches; audio was unchanged.
- GitHub PR #23 exposed a repeat-close race: two native close attempts between
  status polls could leave the UI's observed boolean unchanged and suppress the
  second confirmation. Recheck on every successful status poll while retaining
  the single-dialog guard. Add a deterministic regression with no intervening
  false snapshot. This prerequisite is fixed before starting Phase 26c from develop.
- Verification: all 49 browser tests and 47 client unit tests pass; client build
  passes and lint retains zero errors / 13 pre-existing warnings. No backend or
  audio-storage changes were needed for the repeat-close fix.
- Multi-hour capture, physical sleep/unplug and native close acceptance remain
  outstanding. Phase 26c is requested but awaits the owner merging Phase 26b.

## 2026-09-13: Phase 26b — durable full-length mix recording

- **Implemented for review:** full-length stereo recording from the explicitly
  chosen input, with a selected destination, levels/clipping, duration, checkpoint
  progress, disk-space estimate and a global recording/stop indicator. Navigation
  and frontend reload reconnect to the same native coordinator. Short input tests
  and full recordings cannot capture simultaneously. Close while recording offers
  Keep recording or Stop and save, using accessible WISP-themed confirmations.
- **Persistence:** isolated-tested `RecordingSessions` schema; bounded disk writer,
  flushed atomic checkpoints, WAV/RF64 promotion without copying the full master,
  explicit interrupted-take recovery and separate linked takes. Queue/disk/device
  failures stop explicitly; a stuck native stop/dispose retains its input lease.
  Masters retain shared-mode stereo float samples without gain/format processing.
- **Storage safety:** `<chosen folder>/WISP Recordings` is excluded from the music
  scanner. FAT32 is rejected; 128 MiB preflight and 64 MiB reserve protect recording
  space. Remove entry and permanent managed-audio deletion are separate confirmed
  operations. Byte-identical SHA-256 relinking never grants permission to delete
  the external file. No live profile/database, existing music or real mixer capture
  was touched during implementation; verification used disposable isolated profiles.
- **Verification:** 379 tests: 94 core, 65 infrastructure, 125 API, 47 client unit,
  48 browser. Includes a forcibly terminated child writer/recovery, >4 GiB sparse
  RF64 decode/seek with real FFmpeg, queue overflow, disk/rename/DB commit failures,
  driver loss/stall, idempotency and byte preservation. Existing internal/external
  drag, playlist and loudness suites remain passing. Client build passes, lint has
  zero errors and 13 existing warnings. Existing Microsoft.OpenApi/SQLitePCLRaw
  dependency vulnerability warnings remain; no package changes or installer build.
- **Limitations:** less than six seconds of accepted but not checkpointed audio can
  be excluded after abrupt process termination; this is not physical power-loss
  assurance or detection of every hardware dropout. Hardware long-session/sleep/
  unplug and real Photino close acceptance are still pending. Large RF64 masters
  need an external compatible player. Full waveform/history, ratings, timestamp
  comments, Mix Plan snapshots and 320 kbps MP3 export remain later phases.
- **Next:** user tests a 10–15 minute Input 1 take and both close-dialog choices;
  then Phase 26c builds the full recordings/playback workspace. Detailed decisions
  and evidence boundaries are in `WISP_RECORDINGS_IMPLEMENTATION_PLAN.md`.

## 2026-09-13: User confirms Xone:24C Input 1 recording works

- **User-tested hardware evidence:** the user recorded a short test using Input 1
  and reported that it "seems to record it perfectly". Input 1 is now the confirmed
  working capture choice for this setup; Phase 26b can build on this capture path.
- **Evidence boundary:** the agent has not inspected the recorded audio. The user
  did not separately report USB mode, individual-deck/fader testing, deliberate
  left/right mapping or this clip's exact negotiated format. Those detailed
  checks remain open in the plan. No long-recording or crash-recovery claim follows
  from this short test; those belong to later phases.
- **Change:** updated documentation only. No capture, audio modification, live
  settings/database update or new phase implementation was performed.

## 2026-09-13: Phase 26a — recording input discovery and short stereo test

- **Implemented for review:** new Recordings sidebar entry opens an explicitly
  labelled input-test workspace, not a full mix recorder. Choose an exact capture
  endpoint, capture up to 30 seconds, inspect L/R levels and latched clipping,
  stop early, listen back and save routing observations. A global indicator survives
  navigation; frontend reload reconnects without restarting capture. The design
  follows WISP's existing layout/theme with a scrollable small-window view.
- **Audio:** NAudio 2.2.1 WASAPI shared-mode capture at the endpoint's current sample
  rate, two channels, 32-bit float WAV. This is the Windows transport/file format,
  not a claim of 32-bit ADC precision. No loopback/default-device fallback, no gain,
  limiting, sample-rate up-conversion, software monitoring or automatic recording.
  Non-stereo/unsupported-rate endpoints are explained and disabled. An exhaustive
  format picker is not included; change the shared format in Windows and refresh.
- **Safety/storage:** explicit endpoint saved in existing settings, no DB migration
  or library-track creation. Test clips and per-clip JSON evidence live under the
  active WISP profile's `recording-input-tests` directory; completed prior clips are
  retained, and the latest result/observations reload after restart. Audio access
  resolves a current test GUID, not an arbitrary client path. Temp files are scoped
  to the test; collisions never delete a pre-existing temporary clip. The library
  scanner excludes the reserved test folder even when scanning a parent directory.
  Starts are retry-safe and conflicting sessions cannot change settings.
  Clips are not deleted automatically; the UI displays their location.
- **Discovery evidence, not capture acceptance:** the read-only
  `dotnet src/Wisp.Api/bin/Debug/net10.0/Wisp.dll --list-recording-inputs` command
  bypasses profile creation/DB/host and reports Input 1, 2 and 3 (Xone:24C), all
  stereo 44.1 kHz shared IEEE float. Windows driver inventory reports Allen & Heath
  5.72.0.19773. No real recording, live profile edit or installed-app modification
  was performed. The mixer USB mode and full-mix routing are still unverified.
- **Verification:** isolated fake-device/API tests cover explicit selection,
  format/sample preservation, independent channels, clipping, duration cap,
  duplicate/conflicting requests, disconnect/permission errors, empty input,
  unwritable storage and evidence reload. Browser tests cover explicit/missing
  devices, meters, float WAV decoding, stop/playback, observations, navigation,
  reload, failure states and 800x600 layout. **349 tests pass**: 94 core, 54
  infrastructure (including real FFmpeg fixtures), 111 API, 47 client unit and
  43 browser. Client build passes; lint has zero errors / 13 existing warnings.
  Internal/external drag and loudness suites are retained. Existing NuGet security
  advisories for Microsoft.OpenApi 2.0.0 and SQLitePCLRaw 2.1.11 are unchanged.
- **Remaining gate:** in the updated app, select Input 1 (Xone:24C) as a candidate,
  check STREAM routing, record deck 1 alone, deck 2 alone, then both, and exercise
  channel faders. Listen back and verify L/R with a known stereo source. Save USB
  mode, driver and observations. Only the user's physical test can close 26a.
- **Limitations:** a bounded diagnostic, not production mix capture. It buffers
  at most 30 seconds (46.1 MB at 192 kHz), writes/finalises on stop, and has no crash
  recovery. Keep WISP open through completion; a killed process can lose this test.
  Device failure with received frames preserves a labelled incomplete clip. NAudio's
  high-level capture does not expose all hardware discontinuity flags, so this is
  not proof of dropout-free long sessions. History management, durable capture,
  waveform/review/plan links and 320 kbps exports remain Phases 26b–26g. No installer
  was generated and no CDJ compatibility claim is made.

## 2026-09-13: Recordings and Mix Plan review planning

- **Documentation only:** added the tracked Phase 26
  [Recordings implementation plan](WISP_RECORDINGS_IMPLEMENTATION_PLAN.md).
  The Git-ignored legacy master plan also has a local Phase 26 pointer; it is not
  newly tracked or included in the PR.
  No capture engine, UI, schema migration or audio processing is implemented by
  this change; no live database, music, recording device or installation changed.
- **Scope:** seven gated phases cover Xone:24C input proof, durable capture and
  recovery, recording history/playback/import, immutable plan snapshots with
  editable performed tracklists, ratings/timestamped feedback and new plan
  revisions, lossless/320 kbps MP3 export, and regression/hardware acceptance.
- **Decisions:** preserve original masters and historic plans; track occurrences
  and recording-relative timestamps are distinct from library track cue positions.
  No automatic recognition, destructive plan updates or recording normalisation.
- **Unverified:** Windows `Input 1 (Xone:24C)` routing, negotiated capture format,
  long-session reliability and interruption recovery need physical tests. The
  documented STREAM vs DVS/DAW routing informs the test, not a compatibility claim.
  All implementation checkboxes remain open; first full release requires all gates.

## 2026-09-11: Reference loudness matching and boost-only review

- **Default workflow:** Loudness & versions now opens in **A reference track**
  mode, with **Only boost quieter tracks** enabled and limiting disabled. Choose
  from the selected tracks or search the whole library, measure the reference,
  then scan the selection. The reference measurement/preview explicitly uses its
  **original file**, including when a normalised version is currently active.
  It is excluded from batch scanning/creation so its analysis snapshot stays valid.
- **Planning:** tracks already at/above the target (including within 0.5 LUFS
  below it) stay unchanged. Quiet tracks with positive headroom get a constant
  gain boost. If peaks prevent any useful safe boost, WISP reports **Cannot boost
  safely without limiting**, excludes the row from creation, and never substitutes
  attenuation in boost-only mode. Partial safe boosts show their expected result
  and explain why they will not reach the target. Enabling limiting explicitly
  shows the desired loudness increase and warns about changed dynamics/noise.
- **Custom targets:** remain available by choosing **A custom LUFS target**, now
  supported from -30 to -5 LUFS (FFmpeg's upper limit). The custom field starts at
  -14 but is no longer the default workflow or presented as a DJ standard. Tracks
  are only reduced when boost-only is explicitly disabled. Out-of-range reference
  measurements are explained and blocked, not silently clamped.
- **Backend safeguards:** boost-only defaults to true even if omitted by a client.
  No-op/attenuation requests are rejected without writing an output. Reference
  track ID + analysis ID, source path/stat/full SHA-256 and target agreement are
  checked before rendering; stale references stop the UI batch for remeasurement.
  Copies persist boost-only mode and reference ID/title/source hash alongside
  measured output loudness, target, gain and limiting metadata. Existing JSON
  remains readable; no DB migration is required. A non-louder measured result
  cannot replace the current saved version in boost-only mode.
- **Rendering:** both FFmpeg passes use the same -1.2 dBTP working ceiling. A
  limited result more than 1 LUFS from target is rejected with a retry suggestion,
  in addition to existing peak/duration checks. Separate WAV copies, original
  preservation, inactive creation, preview, explicit version switching, playlist
  identity and cue timing remain unchanged. Previously saved copies with another
  target are clearly labelled; activating them does not apply newly chosen settings.
- **Verified:** regression cases use the reported -13.59 LUFS / +0.28 dBTP values:
  target -14 -> unchanged; reference -8 -> needs limiting; explicit limiting ->
  planned +5.59 dB. Real FFmpeg synthetic-audio tests reach -8 LUFS within 1 LUFS,
  satisfy true-peak/duration checks and retain source bytes. API tests cover
  explicit reduction, missing/modified/stale/mismatched references, provenance,
  idempotent retry and cleanup of an unexpectedly quieter output. Browser tests
  cover reference search outside selection, reference exclusion, opt-in limiting,
  preview/switch-back, stale-reference batch stop and unsupported reference levels.
  The matching/review UI was visually checked at 800x600 with scrollable controls.
  Final checks: **331 tests pass** (94 core, 54 infrastructure, 97 API, 47 client
  unit, 39 browser), client build passes, lint has zero errors and 13 existing
  warnings. Existing NuGet advisories are unchanged.
- **Limitations:** integrated loudness matching does not guarantee identical
  perceived level in every section or on a particular deck/mixer. Limiting may
  flatten transients and amplify vinyl noise; listen before activating copies.
  No user audio was processed/changed, no live database/installation was modified,
  and no CDJ hardware claim is made. The merged unified-drag fix is retained.

## 2026-09-11: One row drag for WISP playlists and external audio files

- **Cause of the regression:** the internal-drag repair made rows HTML-only and
  reserved Windows file dragging for a separate toolbar handle. The previous
  native payload offered only `CF_HDROP`, so switching rows back to native mode
  alone would break WISP's MIME-based playlist/mix targets again.
- **Implemented:** capable Windows hosts now start one copy-only OLE session
  from selected library/playlist rows, offering both Unicode `CF_HDROP` active
  file paths and `application/x-wisp-track-ids` in Chromium's native custom-MIME
  Pickle format. WISP reads the IDs through its existing playlist/mix handlers;
  Explorer/rekordbox can request real audio files from the same data object.
  Current and legacy Chromium clipboard format names are both offered. No
  `DownloadURL`, HTTP audio URL, fake browser File, or source-file move is used.
- **Selection and safety:** Ctrl+A spans pages; an unselected row drags only
  itself. Playlist occurrences preserve their ID order internally; repeated
  physical paths are deduplicated for external files. Track paths are resolved
  from the DB (including explicitly active normalised versions), never trusted
  from frontend file paths. Missing files still permit internal organisation,
  but suppress the entire external file list instead of silently sending a
  partial selection. Existing duplicate confirmations remain in place.
- **Compatibility:** the toolbar file handle remains available. Ordinary web
  browsers/older hosts retain internal HTML row dragging; only a host advertising
  `unifiedTrackDrag` enables dual-format rows. A rebuilt/restarted desktop app is
  needed, not just an updated frontend. External drags transfer audio files only,
  not WISP cue/playlist metadata. Dragging never updates the system clipboard.
- **Verification:** Windows native tests enumerate both formats, read every
  file through `DragQueryFile`, independently decode ID payloads up to 20,000
  entries and retrieve/release both formats repeatedly. Browser regressions use
  real mouse row starts plus Chromium CDP drag destination events carrying IDs
  and Files together, covering 1,205-track selections across pages, internal and
  external handoff paths, missing files, cancellation/retry, and all three
  duplicate choices. Browser bridge/API fixtures remain isolated mocks.
  Full verification: 229 backend + 38 client unit + 35 browser tests pass (302
  total); client build passes and lint reports zero errors / 13 existing warnings.
- **Remaining acceptance check:** the installed Photino/WebView2 OLE loop and an
  actual rekordbox import have not been exercised end-to-end here. After release,
  use the SAME selected rows to (1) drop into a WISP playlist, (2) drop into an
  Explorer test folder and (3) drop into rekordbox; verify counts and playability.
  Both apps should run at the same privilege level (normally non-administrator).
  Live music, database and installed application were not modified by these tests.
- **Separate pending work:** reference-track loudness matching/boost-only review
  was paused for this drag regression; it is not included in this fix.

## 2026-09-11: Non-destructive loudness normalisation and linked audio versions

- **Workflow:** select one or many library/playlist tracks (Ctrl+A spans pages),
  then use **Loudness & versions…** in the toolbar or **Loudness & audio versions…**
  in the row menu. Scan selected originals, review LUFS/true peaks/safe gain and
  flags, choose the main music folder, and explicitly create normalised copies.
  Creation leaves the original active. Preview either version without activating
  it, then use **Use normalised / Use original** per track or the batch controls.
  Switching pauses the loaded track and invalidates cached audio/waveforms.
- **Audio processing:** FFmpeg `loudnorm` performs full-track EBU R128 measurement
  on the stereo/44.1 kHz render format. Target is configurable from -30 to -9 LUFS
  (default -14, not claimed as a DJ standard). Default safe mode uses constant gain
  `min(target - measured LUFS, -1.2 - measured true peak)`; it preserves dynamics
  and flags tracks that cannot reach target without limiting. **Allow limiting**
  is off by default and explicitly enables measured two-pass dynamic loudnorm
  where needed. Output is re-measured, checked against a -1 dBTP ceiling (0.05 dB
  measurement tolerance) and a 0.05-second duration tolerance before linking.
  This does not denoise/declick/remaster vinyl rips; gain raises their noise too.
- **Files:** new stereo 24-bit PCM WAV, 44.1 kHz, under
  `<chosen music folder>/WISP Normalized/<track ID>/<name>-normalized-<unique ID>.wav`.
  No original overwrite, replacement or MP3 re-encoding. Curated title/artist/
  album/genre and a normalisation comment accompany copied source metadata where
  WAV supports it; WISP prep stays on the same library identity. Source audio,
  cue timestamps, tags, notes, playlist entries and mix membership are preserved.
  The chosen folder is remembered; WAV copies can be substantially larger.
- **Persistent version metadata:** nullable track fields store the original path,
  latest normalised path, analysis/source SHA-256 fingerprint and measurements,
  target, actual gain, limiting choice, output fingerprint and creation time.
  FilePath always denotes the explicitly active version, so existing playback,
  drag and export paths consume that version consistently. The library File
  column shows **Normalised** or **Original · copy saved**. Version details expose
  both paths and processing information. Regeneration never deletes older output
  files; the UI links the original and latest generated version, not a full history.
- **Safety/integration:** full source fingerprint revalidation rejects stale
  analysis; read sharing blocks source edits while processing on Windows. Native
  operations use a shared library/file gate, argument-list process invocation,
  cancellation/timeout process termination and unique no-overwrite output paths.
  Failed uncommitted outputs are removed; crashes may leave unlinked files in the
  reserved folder, which is excluded from imports. Create retries reuse a verified
  existing output for the same analysis/options. Missing/changed files block
  activation with actionable feedback. Junction/symlink output trees are rejected.
  Rescans ignore inactive originals and generated copies as new tracks, while
  checking availability of the active generated version. Cleanup requires the
  original active; source renames update the original link and invalidate analysis.
  Relink explicitly detaches version metadata (with a warning) without deleting
  either file. Version switching supersedes unsafe old cleanup undo records.
- **Migration:** `20260911161546_AddTrackAudioVersions` adds four nullable columns;
  existing library/prep rows survive. Downgrade refuses to discard original links
  while normalised copies are active; switch back first. Downgrade removes stored
  analysis/version links but never deletes music files.
- **Verified:** 222 backend + 38 client unit + 27 browser tests pass (287 total).
  Real FFmpeg fixtures verify target matching, peak-capped constant gain, explicit
  limiting, silence rejection, cancellation, output format/duration and original
  byte preservation. Isolated API tests cover switching/drag-path resolution,
  retained cues/playlists, stale/missing files, failed-render cleanup, idempotent
  retries, regeneration, persistence, scanner exclusion and downgrade protection.
  Browser tests cover the batch scan/create/switch flow, target changes, opt-in
  limiting, error/retry, cancellation across result pages and missing FFmpeg;
  the 800x600 modal screenshot was visually checked. Client build/lint pass (13
  existing warnings); EF reports no pending model changes. Existing NuGet
  advisories are unchanged. CI now prepares FFmpeg for real audio validation;
  installers remain exclusive to main pushes.
- **Boundary:** tests used generated audio, isolated databases/config and mocked
  browser responses—not the user's music, live library or installed application.
  No local installer was generated. Normalised files have not been hardware-tested
  on CDJs, and this feature makes no new USB-format/cue compatibility claim.

## 2026-09-11: Playlist duplicate scan and confirmed cleanup

- **Entry point:** open a playlist and use **Scan for duplicates…** in its toolbar.
  No selection is needed. A WISP-styled modal scans the whole playlist, independent
  of library filters or pagination, and lists repeated tracks and extra-entry
  counts. Clean/empty playlists explicitly report **No duplicates found**.
- **Confirmation:** nothing is changed by scanning or cancelling. **Remove N
  duplicates** keeps the oldest-added entry of each repeated library track (entry
  ID breaks equal-timestamp ties). It removes extra playlist memberships only;
  source audio, library tracks, cues, notes, tags, other playlists and mix plans
  remain untouched. Different library tracks with matching titles are not merged.
- **Safety:** read-only `GET /api/playlists/{id}/duplicates` returns a membership
  snapshot. `POST /api/playlists/{id}/duplicates/remove` validates that snapshot
  and deletes extras in one write transaction. Changed membership returns
  `409 playlist_scan_stale` without deleting anything; the UI requires a new scan
  and confirmation. Losing the originally kept entry cannot cause a stale scan
  to delete the final copy. Cleanup is scoped to the named playlist.
- **Resilience:** scan/loading/error/empty states, retry and fresh-scan actions,
  pending-action guards, keyboard focus restoration and a scroll-bounded modal.
  Counts refresh, selection clears and paging returns to the first page after
  removal; playback is not reset. No extra database migration is needed beyond
  the existing repeated-entry support in this PR.
- **Verified:** 210 backend + 34 client unit + 23 browser tests pass (267 total).
  Five new backend cases cover preservation, 1,003-entry scanning, same-title
  distinct files, stale/cross-playlist snapshots, safe retries and empty/missing
  playlists. Seven new browser cases cover confirmation, 1,002-entry full-playlist
  cleanup from page two, cancel, clean/empty results, failure/retry, stale scans and
  busy guards. The 800x600 confirmation screenshot was visually checked. Build
  and lint pass with 13 pre-existing lint warnings and unchanged NuGet advisories.
  Tests use isolated databases and mocked browser data; no working library/files
  or installed app were modified. Included in the existing playlist PR to develop;
  no local installer generated and production remains main-only.

## 2026-09-11: Playlist removal and explicit duplicate confirmation

- **Remove from playlist:** available in the scoped library toolbar and the row
  context menu, for one or many selected entries (including Ctrl+A across pages).
  A WISP-styled modal names the target playlist and explains that only selected
  entries are removed. Unselected copies, other playlists, library tracks, notes,
  tags, editorial/device cues, mix plans and audio files are preserved. Playing a
  removed playlist entry continues normally. Counts refresh, selection clears,
  and paging returns to page 1 after removal. Failures remain visible for retry.
- **Duplicate warning:** add-dialog and sidebar-drop paths now share the same
  confirmation flow. The server checks before writing anything and returns
  `409 playlist_duplicates` if any selected track is already present. Choose
  **Add again**, **Skip existing**, or **Cancel**. Add again adds a new occurrence
  for each unique selected track, not another audio file; Skip existing adds only
  new members; Cancel makes no changes. Unknown tracks fail the whole batch.
  Both single and bulk add APIs use this policy; successful adds return
  `{ added, skipped }`. The default duplicate policy is now `ask`, not silent skip.
- **Entry identity:** confirmed repeats have independent playlist-entry IDs and
  appear as separate selectable rows. Filtering, sorting, pagination and Select
  all operate on those entries. Playback, file dragging, tagging, archive and
  subsequent playlist additions use underlying unique library-track IDs. Thus
  removing one repeat does not remove every copy or lose the original prep data.
- **Persistence:** `AllowRepeatedPlaylistEntries` changes the playlist/track index
  from unique to non-unique without deleting or rewriting existing entries.
  Transactional membership checks serialize concurrent ordinary adds. New entry-ID
  bulk removal is scoped to its named playlist; the legacy track-ID DELETE removes
  all occurrences of that track in that playlist. Both are safe to retry. Batches
  are capped at 20,000. Downgrading the index to unique requires removing repeats
  first; rollback must not silently discard entries to satisfy the old constraint.
- **Modal resilience:** add/duplicate/remove dialogs use focus-trapping native
  HTML dialogs styled with WISP tokens (not system prompts). Busy actions prevent
  accidental resubmission/dismissal, queued global prompts no longer overwrite
  one another, and retrying a failed create-and-add reuses the already-created
  playlist instead of creating another empty one.
- **Verified with the internal-drag fix below:** 205 backend + 34 client unit +
  16 browser tests pass (255 total).
  New backend tests upgrade a seeded previous-schema database, exercise all 18
  library sorts with repeated entries, verify atomic duplicate checks, concurrent
  adds, skip/add/cancel semantics, scoped removal and preservation of prep/audio.
  Browser regressions cover toolbar/context removal, cancel/error/retry, continuing
  playback, 1,002-entry all-page removal, all duplicate choices, sidebar drops and
  an 800x600 modal layout. Real row-to-sidebar dragging also opens duplicate
  confirmation for repeated playlist selections; external-handle tests pass.
  Client build/type checks pass; lint has no errors and 13 pre-existing warnings.
  Existing NuGet advisories are unchanged. All tests use isolated data/mocks; no
  working library migration, music-file removal or live installation replacement
  was performed. No USB/CDJ compatibility claims or export-format changes added.
- **Delivery:** feature PR into develop. No local installer built; production
  packaging remains restricted to main pushes.

## 2026-09-11: Restore internal playlist dragging; separate external file transfer

- **Regression:** the earlier Windows drag change made ordinary track rows start
  native CF_HDROP transfers by default. WISP playlist targets require internal
  track IDs, so those drops could not add playlist membership. The previous tests
  checked the optional internal mode's payload, not the default end-to-end drop.
- **Implemented:** row dragging always carries only WISP track IDs again, for
  sidebar playlists and mix-plan targets. Removed the drag-destination selector
  and native row callback. Ctrl+A keeps the complete selection across pages;
  dragging an unselected row uses only that track. The separate **Drag N files to
  rekordbox** handle remains the explicit native file-transfer gesture for other
  apps/folders. No DownloadURL or file-path payload is attached to track rows.
- **Drop safety:** the app shell rejects unhandled files/URLs and prevents the
  embedded browser's default drop navigation/download. Existing child handlers
  still receive internal playlist/mix payloads; this guard does not import music.
- **Verification:** all nine committed browser regressions pass, including real
  mouse drops into sidebar playlists with 1,205 selected tracks from page one and
  page two, an unselected-row drop, and internal dragging on an unsupported native
  host. They assert membership requests and no native bridge calls/downloads.
  Separate handle coverage checks all-page payload, busy guard, missing-file retry
  and early release. Stray file/URL rejection uses synthetic browser events.
  Combined with playlist removal/duplicates: 205 backend, 34 client unit and
  16 browser tests pass. Client build and lint pass (13 pre-existing warnings).
- **Boundary:** native responses/API data are mocked in browser tests; a real
  installed WebView2/rekordbox handoff still needs user verification. No music,
  working database or installation was changed and no installer was generated.
  This section supersedes the native-row default described immediately below.

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
