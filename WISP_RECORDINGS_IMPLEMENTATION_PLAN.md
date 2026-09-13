# Recordings and Mix Plan review — implementation plan

Date: 2026-09-13

**Status: Phase 26a short capture on Xone:24C Input 1 confirmed working by the
user. Phase 26b implemented for review with synthetic/fault-injection evidence;
long hardware recording remains unverified. Phases 26c–26g remain planned.**
This is Phase 26 of the local main implementation plan (that legacy file is
Git-ignored; this tracked document is the authoritative plan for this feature).
Each phase below is a bounded
delivery slice, not a claim of completion. The first full release requires all
seven phases; intermediate development builds must clearly identify limitations.

## Product outcome

Record a stereo DJ mix, listen back, rate it, annotate specific moments and use
that feedback to prepare a better next attempt. A Mix Plan is the intended set;
a recording has its own historical tracklist, which can reflect what actually
happened. Neither should silently rewrite the other.

### Agreed scope and proposed defaults

- New **Recordings** sidebar route beside Mix Plans; also **Record this plan**
  from a Mix Plan and **Link Mix Plan** for existing/imported recordings.
- Lossless stereo master, with explicit **320 kbps MP3** export. Prefer 24-bit
  PCM when supported; expose the actual negotiated input format and sample rate.
  Never imply that up-conversion improves source quality. No automatic gain
  normalisation, limiting, effects or destructive editing during capture.
- User-selected recordings folder, separate from normal library entries. If
  located beneath a scanned music root, scanner exclusion is mandatory.
- Past mixes: title, date, duration, optional 1–5 satisfaction rating and optional
  Practice / Needs review / Ready to share label. Neither rating nor notes are
  required to save. Unrated is distinct from a low score.
- Waveform seeking/zoom, timestamp and time-range notes, section looping,
  editable performed tracklist and multiple takes linked to the same plan.
- Recordings remain usable without a plan. Deleting a plan/library track must
  not delete audio or erase the recording's historical text and ordering.
- Import existing local WAV, MP3, FLAC and AIFF mixes after decoder validation;
  copy into managed recording storage by default, preserving the source.
- First-release exclusions: multitrack editing, overdubbing, plugins, destructive
  trimming, automatic track recognition, automatic CDJ track/timestamp detection,
  cloud publishing and automatic feedback-based recommendation changes. This does
  not revive the dropped Phase 24 fingerprint/tracklister work.

## Architecture and data boundaries

Existing foundations: .NET 10 API/Photino host, NAudio 2.2.1 dependency, FFmpeg
services, React client and MixPlan/MixPlanTrack with ordering, cue positions and
transition notes. Capture, recording persistence and plan snapshots are new work.
The main plan's old Web Audio-only statement applies to preview/blending, not
this proposed native capture engine. Do not assume NAudio 3 APIs are available.

- **Core:** recording lifecycle, validation, snapshot/revision rules and note
  time-range semantics; no device/file I/O.
- **Infrastructure:** device enumeration/capture, bounded disk writer, recovery
  manifest, durable recording storage, peak generation and FFmpeg export jobs.
- **API/host:** one application-lifetime recording coordinator, command/status
  endpoints, bounded meter/progress updates and close/shutdown integration.
- **Client:** Recordings page and globally visible capture state. Route changes
  or a WebView reload reconnect to the coordinator; they do not own recording.
- Proposed entities: `Recording` (identity, state, title, rating, storage paths,
  duration/format, timestamps, optional source-plan identity); immutable
  `RecordingPlanSnapshot` and ordered snapshot entries (including copied display
  metadata, track identity, cue/transition notes and plan update token);
  `RecordingTrackEntry` (separate editable performance order, skipped/added status,
  optional actual entrance timestamp); `RecordingAnnotation` (text, optional
  category, start/end, optional track-entry or transition association);
  `RecordingExport` (job status, format and derived file identity).
- Snapshot/performance entries use occurrence IDs, not just TrackId: a song can
  legitimately occur twice. References may become null; retained snapshot text
  must remain readable. Source plan name/version is preserved after deletion.
- Audio timestamps are recording-relative seconds derived from captured frame
  counts, not wall-clock/UI timer estimates. Track cue-in/out seconds stay
  track-relative. Overlapping transitions do not require non-overlapping regions.
- Commands must be retry-safe. Concurrent start/stop requests cannot create two
  capture sessions or finalise the same file twice. Editing notes/plans uses
  version checks to avoid lost updates. Never trust client-provided delete paths.

## Phase 26a — Input discovery and capture proof

**Depends on:** nothing. **Purpose:** retire hardware uncertainty before UI polish.

- [x] Enumerate Windows recording endpoints and their current shared stereo format;
  implement WASAPI shared capture using NAudio 2.2.1. The test uses that sample rate
  with float transport, not an exhaustive format picker or hardware-bit-depth claim.
  Investigate alternative drivers only if a documented hardware limitation requires them.
- [x] Persist explicit endpoint identity, not System default; handle missing/busy
  devices and permissions with actionable errors, never silently use a microphone.
- [x] Add input-test L/R meters, clipping latches and a short isolated test recording
  with playback, a global activity indicator and persisted user observations.
- [x] User confirms a successful short recording with Input 1 (Xone:24C).
- [ ] Physically verify both decks separately and together, channel fader response
  and stereo channel mapping by listening to a captured test.
- [ ] Xone:24C baseline: STREAM mode routes MIX L/R to USB channels 1/2; DVS PRO
  and DAW route it to 5/6. Windows `Input 1 (Xone:24C)` is a candidate stereo
  endpoint, not proof of routing. Verify rather than infer from its name.
- [ ] Document chosen endpoint, mode, driver, Windows version, negotiated format
  and playback result. Keep software monitoring off by default to avoid feedback.

**2026-09-13 development evidence:** read-only enumeration sees Input 1/2/3
(Xone:24C), each stereo 44.1 kHz shared IEEE float. Windows reports Allen & Heath
driver 5.72.0.19773. No real audio was captured by the agent and the mixer mode is
not inferred from device names. Captured test reports will include the endpoint,
format and Windows version; the user records mode/driver/listening observations.
Software monitoring is absent. The diagnostic is capped at 30 seconds and buffers
only this short clip; it is explicitly not the durable Phase 26b recorder.

**Exit gate:** the user confirms a short captured file contains the intended full
stereo mix. Hardware evidence is recorded separately from automated fake-device tests.

**2026-09-13 user hardware feedback:** "ive recorded a test with input 1 and it
seems to record it perfectly". This establishes Input 1 as the working capture
choice for the user's current setup and supports proceeding to Phase 26b. The
agent has not independently inspected this recording. USB mode, separate-deck and
fader checks, deliberate L/R mapping, and the exact format of this particular
capture were not explicitly reported; retain those checklist items rather than
claiming a completed routing matrix. This short test is not long-session evidence.

## Phase 26b — Durable recording engine and storage

**Depends on:** 26a capture decision.

- [x] Add isolated-profile-tested schema migrations and application-lifetime
  coordinator: Idle -> Preparing -> Recording -> Finalising -> Ready, with
  explicit Interrupted/Recoverable/Failed paths. No record-pause in first release.
- [x] Stream capture into bounded buffers and disk; do not accumulate full mixes
  in memory. Keep callback work minimal and surface overruns/dropouts rather than
  silently discard audio. Throttle meters independently of sample writes.
- [x] Preflight writable destination, free space, device format and existing jobs;
  estimate remaining recording time and report clipping without claiming to fix it.
- [x] Write recoverable chunks/checkpoints and an atomic session manifest. Set a
  documented recovery-loss bound and test it. Finalise via temporary files and
  atomic promotion; retain recoverable audio if finalisation or DB commit fails.
- [x] Explicitly solve classic WAV's size ceiling: choose/test RF64 or a compatible
  chunked-master strategy before supporting long sessions. No silent truncation at
  4 GiB; select interoperable export behaviour and display any format limitations.
- [x] Handle disk-full/unplug, input disconnect, sleep/session interruption,
  process termination and restart recovery. Close while recording offers
  **Keep recording** or **Stop and save**; route navigation stays safe. Do not
  promise capture while the application is closed or the computer sleeps.
- [x] Stop safely on capture loss; do not silently switch devices or stitch a
  resumed recording across an unmarked gap. Offer a new linked take after recovery.
- [x] Keep masters separate from library tracks, scanner imports and normalised
  versions. Remove-from-history and delete-managed-audio are distinct, confirmed
  actions; never remove an imported source file. Missing files support relinking.

**Exit gate:** synthetic fixtures and fault injection prove retry-safe lifecycle,
bounded memory, restart recovery, large-file strategy and preservation of originals.

### 2026-09-13 implementation and evidence boundary

- `RecordingSessions` migration and application-lifetime `MixRecorder` own full
  captures independently of the page. The short diagnostic and full recorder share
  a single native-input lease. Essential start/stop, duration, meters, destination,
  cross-page indicator and saved-take/recovery controls are included now; this is
  not the full Phase 26c workspace. Confirmations use WISP-themed, keyboard-contained
  native HTML dialogs, not operating-system prompts.
- Each take is a GUID directory under `<chosen folder>/WISP Recordings`, excluded
  from library scanning. Capture writes a stereo 32-bit IEEE float master at the
  selected Windows shared sample rate, unchanged. Float describes transport/storage,
  not ADC precision; the earlier 24-bit preference is superseded for this capture
  path to avoid an unnecessary conversion. No automatic processing or monitoring.
- Eight queued packets, each at most half a second, bound audio memory independently
  of duration. Durable checkpoints flush the audio before replacing `session.json`;
  checkpoint interval is one second plus at most one packet. A killed process can
  lose **less than six seconds of already accepted audio** (queued/in-flight/uncommitted
  frames), while every committed checkpoint frame is retained. This is not a guarantee
  against controller/power-loss failures or audio the driver never delivered. Recovery
  trims only the owned uncommitted tail; it never guesses a length from damaged data.
- RIFF WAV reserves a header slot for [RF64 ds64](https://tech.ebu.ch/publications/tech3306),
  switching before the 4 GiB boundary without a full-file copy. Tests cover exact size
  boundaries and FFmpeg decoding/seeking a sparse >4 GiB fixture. FAT32 destinations
  are rejected. Large RF64 masters are not offered in the basic browser audio player;
  use a compatible external player. 320 kbps MP3 remains Phase 26f, not implemented.
- No-input gaps over three seconds, device errors, oversized packets, queue overflow
  and disk errors stop the take explicitly. A hung driver stop/dispose retains the
  native lease; no second capture can race it. Native WASAPI's high-level wrapper does
  not expose every hardware discontinuity flag, so detection of all dropouts is NOT
  claimed. Sleep/device-removal behavior still requires physical acceptance testing.
- Startup flags interrupted sessions for explicit recovery. Finalisation failures,
  including failed database commits after promotion, retain recoverable files. A new
  linked take is a separate file/identity, never an automatic append across a gap.
  SHA-256 allows only byte-identical master relinking. Removing an entry keeps audio;
  separately confirmed permanent deletion targets managed audio only, never relinked
  external files. Session metadata remains on disk for diagnosis.
- Automated evidence includes a forcibly killed child writer, checkpoint/rename/DB
  failures, disk reserve exhaustion, input loss, queue overflow, stalled driver stop,
  byte preservation, scanner exclusion and isolated SQLite migration. Browser tests
  cover recording/navigation/reload, input-test exclusion, recovery, confirmation and
  800x600 layout. Physical multi-hour Xone capture, actual Photino close handling and
  power/sleep/unplug tests remain open; this is not yet a production reliability claim.

**Next hardware check:** choose Input 1, select an NTFS/exFAT recordings folder,
record a 10–15 minute practice take, navigate away/back, then Stop and save. Listen
to the beginning/middle/end and verify both decks and stereo. In a separate short
test, try closing while recording and exercise both close-dialog choices. Do not
use an irreplaceable mix for the first long-session test.

**Hardware follow-up:** user completed a 10:37 mix on Input 1 and reports both
decks recorded correctly. Read-only analysis confirms a valid stereo 44.1 kHz
float master, matching checkpoint length, -1.9 dBTP true peak and no >=1-second
silence below -60 dBFS on either channel. This supports advancing to Phase 26c;
it does not close the multi-hour, native-close, sleep or unplug acceptance checks.

## Phase 26c — Recordings workspace and playback

**Depends on:** 26b; UX prototype can precede engine completion.

- [ ] Sidebar route; resizable mix list, prominent waveform/player and collapsible
  Tracklist / Review notes panel. Reuse WISP styles, not a separate DAW theme.
- [ ] Input test/selector, levels, clipping indicators, timer, Record/Stop and
  **Mark this moment**. Save immediately on stop; naming/rating is not a save gate.
- [ ] Persistent cross-page recording indicator and reconnectable status after
  frontend reload. Keyboard actions must not fire while typing comments.
- [ ] History search/sort by date/title/duration/rating; clear empty, recording,
  finalising, missing-file, recovery and failed-export states.
- [ ] Stream seekable audio through validated recording IDs/range requests. Build
  multi-resolution waveform peaks in the background with cancellation and caching;
  do not decode an hours-long recording into browser memory.
- [ ] Playback, seek, zoom, volume, section loop and configurable note pre-roll.
  Coordinate with WISP's existing player: avoid competing playback and accidental
  feedback into the recording input; show explicit warnings for risky routing.
- [ ] Import supported local mixes with progress, duplicate-file handling and
  source preservation. Peaks can be pending without preventing basic playback.

**Exit gate:** browser tests cover navigation, reload, accessible controls and
keyboard operation; inspect at 800x600 and larger sizes with long track/note text.

## Phase 26d — Plan snapshots and performed tracklists

**Depends on:** 26b persistence and 26c entry points.

- [ ] **Record this plan** atomically captures plan order/notes/display metadata
  at session creation. Standalone/imported recordings can link later with clear
  wording that this snapshots the plan now, not its unknown historical state.
- [ ] Preserve immutable planned snapshot plus editable performed tracklist;
  skip/reorder/add tracks without mutating that snapshot or the live plan.
- [ ] Mark track entrances live or after recording; show untimed entries as
  untimed. Link waveform markers to individual occurrences. Do not manufacture
  timestamps from track lengths or cue positions.
- [ ] Plan detail lists linked takes; recording links back to its source plan.
  Deleting/relinking a plan must not silently discard the original snapshot.
- [ ] Test repeated tracks, missing/deleted source entities, plan edits during
  recording, post-import linkage and recording deletion without plan deletion.

**Exit gate:** edit the live plan after Take 1; Take 1 remains historically intact,
while Take 2 snapshots the edited order. Deviations can be recorded independently.

## Phase 26e — Review and next-attempt workflow

**Depends on:** 26c playback and 26d occurrence identities.

- [ ] Optional overall 1–5 rating, overall notes and review status; persist edits
  with visible save/error feedback, including failures during navigation.
- [ ] Point/range comments, optional categories (Transition, Phrasing, Levels,
  Track choice, Keep this), edit/delete and optional revisit/resolved state.
  Validate finite timestamps within duration; live markers use captured frames.
- [ ] Notes may target a transition or track occurrence; don't automatically add
  negative global track ratings or recommendation block-pair rules.
- [ ] Click a note to seek with bounded pre-roll; loop selected sections. Handle
  zero/end-of-file times and tracklist edits that remove a note association.
- [ ] **Revise plan from this mix** previews a new named plan, chosen planned or
  performed order and selected feedback. Preserve valid anchors/cues where relevant;
  keep recording timestamps labelled as review context, never as track cue values.
- [ ] Create revision with lineage to recording/parent plan; retain previous plan
  and take. No automatic destructive updates to the original plan. Multiple takes
  remain browsable so the user can compare ratings and revisit feedback.

**Exit gate:** complete Plan -> Take 1 -> timestamped feedback -> revised Plan ->
Take 2 in browser/API tests without changing Take 1 or losing selected feedback.

## Phase 26f — Exports and file lifecycle

**Depends on:** 26b durable masters; 26c/26d for UI and tracklist exports.

- [ ] Export original lossless master/compatible WAV and explicit 320 kbps CBR MP3
  using verified FFmpeg capabilities; title/date and optional textual tracklist.
  Keep annotations in WISP; don't promise players will read timestamp comments.
- [ ] Optional timestamped text tracklist uses only confirmed entrance markers;
  untimed entries are labelled, never given invented times.
- [ ] Export jobs show progress/cancellation/errors; retries cannot overwrite
  originals or existing exports without explicit choice. Encode once from master,
  validate decode/duration/codec/bitrate and atomically publish the finished file.
- [ ] Reserve/check space for simultaneous master, temporary conversion and output;
  cancelled exports remove only owned temporary files. Missing FFmpeg leaves the
  master playable and gives a clear repair path.
- [ ] Local recording folders/backups/chunks/peaks/exports stay out of Git. Explain
  that audio and WISP database metadata both need backup to preserve review history.

**Exit gate:** long and short fixtures export/play successfully, verified as stereo
320 kbps MP3 where selected; master bytes and review data stay unchanged.

## Phase 26g — Full acceptance and controlled release

**Depends on:** 26a–26f. No claim of readiness before these checks pass.

- [ ] Run core, infrastructure and API tests; client unit/browser tests, lint and
  client build. Protect both internal playlist dragging and external file dragging,
  existing playback, scanning, cues, plans and loudness/version behaviour.
- [ ] All automated DB/audio tests use isolated profiles and generated fixtures.
  Simulate invalid/busy devices, overrun, duplicate commands, disk failures,
  interrupted writes, restart, stale edits, missing sources and cancelled exports.
- [ ] Xone:24C hardware acceptance: verify input as in 26a, then record a minimum
  two-hour stereo set while navigating the app. Check memory growth, reported
  dropouts, continuity, L/R mapping, duration and beginning/middle/end playback.
- [ ] Use disposable sessions to exercise unplug/reconnect and recovery; verify
  the documented recovery-loss bound. Test the chosen large-file path beyond
  4 GiB separately; do not fill or disrupt the user's live music drive.
- [ ] User completes the linked-plan review/revision loop, exports 320 kbps MP3
  and listens in an independent player. Record evidence, remaining limitations,
  device/driver/mode and capture format in WISP_IMPLEMENTATION_STATUS.md.
- [ ] Deliver bounded feature PRs into develop, validation only. Owner decides
  promotion/merge to main; installer pipeline runs only on successful main push.
  No routine local package/publish. Hardware-blocked phases remain incomplete.

**Done when:** reliable capture and recovery are evidenced on the Xone:24C, the
full practice/revision loop works, historical data and masters remain intact,
and verified exports plus regression checks pass. Automated tests alone do not
prove physical audio routing, uninterrupted hardware capture or CDJ compatibility.

## Delivery checkpoints and evidence

Suggested PR boundaries follow 26a–26g; split 26b into storage/recovery and capture
integration if review size demands it. Update this checklist and the status log in
each PR with actual checks and limitations. Avoid calendar estimates until 26a
resolves driver/routing and 26b resolves long-file/recovery choices.

Hardware reference: [Allen & Heath Xone:24C user guide — USB modes and routing](https://support.allen-heath.com/hc/en-gb/articles/39821017822865-Xone-24C-User-Guide).
The screenshot confirms endpoint names only; no live capture test has yet run.
