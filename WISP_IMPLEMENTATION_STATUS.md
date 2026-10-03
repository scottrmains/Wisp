# Wisp implementation status

Last reviewed: 2026-10-03

## 2026-10-03: BPM/key analysis recovers isolated decoder errors

- Reproduced the reported Pianoman "Pasion (Alex Kassian's Mandarine Dance
  Mix)" failure with the installed FFmpeg 8.0.1. `-xerror` aborted on an
  invalid MP3 packet after decoding approximately 465 seconds; tag-reader
  BOM/GEOB diagnostics were also present. This does not establish which
  application introduced the invalid data, or mean the source file is pristine.
- Removed fatal-on-first-error **only from music analysis**. Decoding remains
  read-only and streaming; cancellation, timeouts, invalid samples, incomplete
  PCM, nonzero exit codes and short/silent input still reject analysis.
- Added a conservative maximum of eight reported packet/frame decoding
  failures per track, with repeat-suppression disabled and bounded stderr
  parsing. A generated 100-failed-packet sample demonstrated that bundled
  FFmpeg returned success despite `-max_error_rate 0.01`; WISP therefore
  enforces its own guard rather than relying solely on that option. This is
  a safety policy for tested decoder diagnostics, not audio repair or a
  guarantee that every damaged format can be detected.
- Successful decoding with error-level diagnostics now carries a persistent
  review warning, including when suggestions are loaded from the cache.
  Requested BPM/key suggestions start unchecked and are marked uncertain.
  File paths/raw decoder output are not exposed in the review screen. Existing
  BPM/key values, source tags, music files, library links and cues are preserved.
- Read-only verification on the reported track completed at **128.11 BPM**,
  **4A**, with 465.032 seconds decoded and a review warning. The source's
  SHA-256 remained identical. The neighbouring Trip remix also completed;
  its estimated key disagreed with its existing tag, reinforcing that key
  detection remains experimental and must not replace existing values.
- Verification: 535 Release backend cases (115 Core, 205 Infrastructure,
  215 API); 70 client unit tests; all eight audio-analysis browser cases;
  client TypeScript/Vite build; lint with zero errors and 12 existing warnings.
  Decoder regressions cover clean WAV/AIFF/FLAC/MP3, isolated bad trailing
  data, eight/nine/100 failed-packet boundaries, unreadable input and unchanged
  source hashes. API/browser regressions verify cached warnings and explicit
  selection before applying a recovered suggestion. Existing build chunk-size
  warnings remain. No installer, production deployment or user database repair
  was performed; the installed release needs updating after owner promotion.

## 2026-10-02: File-date backfill CI test reliability

- Develop run `36956377808` failed in the existing file-date backfill integration
  test at its ten-second completion guard, before data assertions. The other
  529 backend cases and marketing validation passed. This was not an Azure
  deployment failure; no production release ran.
- Isolated that test in an xUnit nonparallel collection so it does not compete
  with parallel audio-analysis/FFmpeg tests. The rest of the suite remains
  parallel. The guard is now a bounded 60 seconds rather than a performance
  assertion; actual file-date, notes and import-date assertions are unchanged.
- Added bounded worker stop/join in `finally` before the test disposes the
  isolated provider/database. No production service, library data, workflow,
  installer or website behaviour changed; no automatic test retries or skipped
  assertions were added.
- Verification: the targeted test passed five consecutive Release runs. The
  first full-suite attempt encountered a separate transient temporary-directory
  access error in the waveform USB-export test, which passed when rerun alone.
  The second full Release solution run passed all 530 backend cases (115 Core,
  201 Infrastructure, 214 API), including the previously failing backfill test
  and waveform-export test. `git diff --check` passed. Original develop
  validation was rerun; the fix PR also runs normal GitHub validation.

## 2026-10-02: Marketing site custom domain

- The owner added the `wisp` CNAME under `physiqo.app` in Porkbun, pointing to
  `zealous-smoke-0124a0503.4.azurestaticapps.net`. DNS resolution was verified.
- Registered `wisp.physiqo.app` on the existing Free-tier `wisp-web-prod` Azure
  Static Web App in `rg-wisp-prod`, using CNAME validation. Azure reports
  **Ready**. Verified normal certificate-validated HTTPS 200 responses for
  `https://wisp.physiqo.app/` and `/release.json`; homepage content matches the
  original Azure origin. The release manifest currently identifies `0.1.121`.
- Initial certificate-name mismatches cleared after provisioning propagated.
  Other DNS caches/edge locations can still take time to pick up the new binding.
- The original Azure hostname remains available. No root-domain, email,
  Physiqo application, hosting tier, release workflow or deployment identity
  changes were made. The pipeline continues verifying the Azure origin URL.


## 2026-10-01: Optional local BPM/key analysis — experimental first phase

- **Entry points:** select Library/playlist tracks, right-click → **Analyse audio
  (BPM / key)…**, or use Library actions. Selected playlist occurrences are
  deduplicated by track ID. BPM is enabled initially; key is an explicitly
  experimental, initially disabled option. Nothing runs automatically on import.
- **Missing fields only:** existing positive BPM and any nonblank key are skipped
  independently, including non-Camelot keys. Fresh embedded tags are inspected
  when a DB field is missing, so recent Mixed In Key edits are not overwritten.
  Tag-only values explain that a rescan imports them; analysis does not rewrite
  or silently import them. Optional **Compare existing values too** computes
  suggestions alongside existing values, but still cannot replace them.
- **Local background batch:** one bounded batch (up to 20,000 distinct tracks) at
  a time, progress across navigation, cancellation of the current decoder and
  remaining tracks, individual failures, and a global progress/review strip.
  Decoder PCM is streamed; input is limited to two hours, with a ten-minute
  processing timeout and bounded diagnostic memory. Library file operations are
  serialised per track; browsing/playback remain available. No upload, rename,
  audio conversion output, tag write, cue edit or USB operation occurs.
- **Review and apply:** BPM can be edited or halved/doubled; key is shown as
  Camelot. Uncertain suggestions are unchecked. BPM and key can be applied
  independently, including a later second field. Apply fills missing WISP DB
  fields only, rechecks current tags, linked path and SHA-256, and uses conditional
  DB updates to protect concurrent edits. All track IDs, memberships, notes,
  versions and existing FirstBeat/memory/hot cues remain intact. Accepted values
  use the existing Library, recommendation, Mix Plan and USB metadata paths;
  this adds **no new hardware-compatibility claim** or beatgrid alignment.
- **Cache/provenance:** nullable `MusicAnalysisJson` migration stores suggestions,
  source-byte hash, analyser version, timestamps and accepted values separately
  from track metadata. Unchanged successfully detected fields are reused; changed
  tags/audio invalidate cache conservatively. Suggestions survive WISP restart,
  but in-flight jobs do not resume automatically. Re-analyse to recover saved
  suggestions. Eight recent jobs are retained in memory; Clear results recovers
  from expired/restarted job IDs without deleting stored suggestions or metadata.
- **Engine choice:** `wisp-onset-chroma-v1` is WISP's experimental onset spectral
  flux/autocorrelation baseline, whole-track phase refinement, and pitch-class
  correlation against Krumhansl major/minor profiles, using existing FFmpeg/NAudio
  primitives. Tempo octave preference is explicitly 90–180 BPM. Fixed A=440 Hz,
  global major/minor key only; no tuning correction, variable-tempo grid or
  calibrated confidence percentages. Essentia/libkeyfinder are **not bundled**;
  their distribution/licensing decisions remain unresolved. Synthetic-test success
  is not evidence of commercial analyser parity.
- **Read-only real-music comparison:** 20 alphabetically selected tagged files
  under the owner's music folder were examined (not a random/held-out benchmark;
  includes two containers of the same audio). One decoder failure was reported,
  not imported or changed. Of 12 BPM-comparable files, **10 agreed within 1 BPM**
  and **7 within 0.1 BPM** with integer file tags. Of 18 Camelot-comparable files,
  **5 had an exact key match**. Tags are comparison references, not verified
  ground truth. These results do **not** establish rekordbox/Mixed In Key parity.
  Key is not ready to replace a trusted analyser: off by default, warning shown,
  and **all key suggestions require explicit selection**, irrespective of strength.
  Broadening/whitening the baseline pitch extraction did not improve this sample
  consistently; those experiments were not shipped. No owner's file/tag/DB was
  changed during this comparison.
- **Benchmark helper:** `tools/Wisp.MusicAnalysisBenchmark` reads music and emits
  JSON-line tag comparisons to stdout; no DB/profile/tag writes or downloads.
  Example (use your actual paths):

  ```powershell
  dotnet run --project tools/Wisp.MusicAnalysisBenchmark -- --ffmpeg tools/ffmpeg/ffmpeg.exe --folder "D:/Music" --limit 20
  ```

- **Verified:** 530 backend cases (115 Core / 201 Infrastructure / 214 API),
  including 30 new analyser/safety cases; 69 client unit cases. Client build,
  browser-test TypeScript and all 152 Chromium/Photino-UA browser cases pass,
  including independent-field apply, navigation, cancellation, retries and paged
  selections. Lint has zero errors (12 pre-existing warnings); the existing
  large-bundle advisory remains. The review screen was visually inspected.
  Tests use isolated DBs and generated media; real-file hash preservation is
  asserted for WAV/AIFF/FLAC/MP3 decoder fixtures. The historical pre-audio schema
  playlist-upgrade fixture explicitly excludes the new column before migration.
  No installer/publish, owner DB migration or unrelated discovery-worker edit.

### Remaining accuracy/engine phases

- [x] Optional selected-track workflow, safe suggestions/apply, batch progress,
  cancellation, cache/provenance and initial read-only comparison.
- [ ] Resolve distribution-compatible established engine options, especially for
  key; compare against a larger independently checked, held-out house/garage/
  vinyl set (not just agreement with tags or synthetic examples).
- [ ] Improve/benchmark drifting and ambiguous tempo, detuned vinyl and key
  extraction; calibrate uncertainty before enabling any stronger acceptance default.
- [ ] Manual desktop test: audition missing-field suggestions and comparison mode;
  verify post-rescan/export metadata on the user's normal workflow. Accurate
  downbeat/variable-tempo beatgrids and optional tag writing remain separate work.

## 2026-10-01: Library and Mix Plan usability fixes

- **Bottom chain restored:** expanding the active plan now reserves a bounded,
  full-width area below the Library/playlists rather than covering them with a
  floating right-hand drawer. Collapsing/Escape, ordered multi-track drops,
  keyboard reordering, notes, rename and transition audition are preserved.
  Its heading is not duplicated; card content scrolls on shorter windows.
- **Recommendations made actionable:** “Find next tracks” beside “Recommend
  from” opens an audition/add panel. Match the last track or choose another plan
  entry, choose a recommendation mode and candidate playlist, then explicitly
  append a suggestion. Existing plan tracks are marked “In plan”; additions are
  single-flight, failures remain visible, and failed reads have a Retry action.
  An empty plan explains that it needs a first track. The existing backend
  scoring/scope implementation is reused, not replaced with invented matches.
- **Title column fix:** title fills spare space only until a custom width is
  set. Pointer/keyboard resizing starts from its rendered width, then applies
  an exact saved width to headers and rows. The previous unconditional `1fr`
  was swallowing reductions. Double-click reset and existing presets remain.
- **Version-aware titles:** Library/playlists, preparation, compact playback,
  chain cards and recommendation rows include the version/mix in the title.
  Already-embedded versions are not duplicated (including curly/straight
  apostrophes). This is display formatting; it does not rewrite tags or files.
- **Toggleable main beatgrid:** a persisted Beatgrid on/off control covers the
  whole-track waveform, preparation zoom and magnifier. Spacing adapts to width
  and zoom: overview bars/phrases rather than thousands of dense lines, individual
  beats when zoomed. FirstBeat anchors the grid; with BPM alone the display is
  explicitly **estimated from 0:00**. Hiding lines does not disable cue snapping.
  Estimated lines do not invent a FirstBeat marker or enable snapping. This is
  a fixed-tempo, 4/4 display, not variable-tempo audio analysis.
- **Data/verification boundaries:** client tests use fabricated audio, tracks,
  playlists and mocked APIs/bridge. Backend tests use isolated profiles and
  temporary media with the existing FFmpeg dependency. No owner's music, DB,
  USB data or discovery-worker edit is changed; no installer is generated.
- **Verified:** 65 client unit cases, 145 Chromium/Photino-UA browser cases and
  all 500 backend cases pass. Client and browser-test TypeScript builds pass;
  lint has zero errors (12 pre-existing warnings). Browser coverage includes
  pointer/keyboard title resizing and persisted widths, versions, scoped/mode/
  seed recommendations and save/read failures, empty plans, grid persistence,
  internal/native drag regression, and chain + preparation at 1024/1366/1920
  widths. Screenshots were inspected. The existing large-bundle advisory remains.

### Built-in BPM/key analysis assessment — not implemented in this fix

At the time of this Library fix, WISP imported TBPM/INITIALKEY tags through MetadataReader. Its local
waveform/downbeat/structural-marker processing can use a supplied BPM, but does
not yet detect tempo or key independently. The experimental phase above now supersedes this assessment. Local/offline analysis is feasible;
the existing audio decode pipeline is groundwork, not an analyser by itself.

Recommended next stages:

1. Evaluate an audio-analysis engine and its Windows packaging/licensing against
   a representative labelled set (house/garage, old vinyl rips, intros/breakdowns).
   Established algorithms already expose BPM/beat positions and key/scale;
   Essentia is a candidate to evaluate, **not an approved dependency**. Its
   licensing/distribution terms need review before selection:
   https://essentia.upf.edu/reference/std_RhythmExtractor2013.html,
   https://essentia.upf.edu/reference/std_KeyExtractor.html,
   https://essentia.upf.edu/licensing_information.html.
2. Add a cancellable background batch queue with progress, bounded decoding,
   per-track failures, content-identity caching and analyser-version provenance.
   Store suggested tempo/key, beat anchor and confidence separately from accepted
   values. Existing user/Mixed In Key tags must not be silently overwritten.
3. Provide review/apply controls, half/double-tempo correction, first-beat/grid
   adjustment and Camelot display. Treat ambiguous keys and drifting vinyl tempo
   as uncertain; validate supported formats and later USB propagation separately.

This is a medium-to-large feature, not another small UI patch. A first useful
offline analyser is achievable, but matching commercial analysis reliability
requires measured validation; no accuracy or delivery-time promise is made.


## 2026-10-01: marketing presentation refinement (PR #50 follow-up)

- **Clearer product presentation:** Library, Crate Digger, Mix Plans and Review
  demonstrations now sit beneath their copy in wide product stages. Rounded
  framing and restrained depth replace hard-edged thumbnails. The plan capture
  focuses on the BPM/key/energy journey and transition notes rather than unrelated
  headers; the Wanted crop focuses on titles and waiting/found states.
- **Sharper assets:** recaptured the same actual client and approved Tonka audio
  at 2x pixel density as lossless WebP. Audio/library data stays read-only and
  private. Static image dimensions and capture provenance are updated together.
- **Visible, restrained motion:** content enters with a one-time 650 ms fade and
  16 px rise when it reaches the viewport. Hero copy is included. Reduced motion
  immediately reveals pending content and disables these animations; the no-JS
  baseline remains visible. Completed demos restore their crisp static poster.
- **Preview clarification:** opening index.html as a file can block module scripts;
  use the served HTTP preview for animations and demo controls. This is not a
  reason to bypass browser security, and does not affect the served production site.
- **CI limitation observed on the preceding revision:** marketing validation
  passed, but the unchanged backend TrackFileDateBackfillTests case timed out.
  Its isolated regression passes locally. No backend/library recovery code is
  changed by this presentation refinement.
- **Refinement verification:** marketing build, all 26 Node cases and all 30
  Chromium cases pass, including new entrance timing, live reduced-motion,
  high-density/wide framing and finished-demo poster checks. Desktop/mobile
  screenshots and all four decoded demo frames were inspected. Actual posters
  are 2x lossless; clips remain native CSS-pixel video (not falsely upscaled).

## 2026-10-01: production homepage readiness verification

- **Cause:** main run 36892858038 built/tested/published installer 0.1.121 and
  deployed Azure successfully, but final verification failed because the expected
  version marker was not in the homepage HTML. The matching release manifest was
  already visible. Subsequent read-only checks found the correct HTML, installer
  link and assets; this is consistent with independent Azure edge propagation.
- **Implemented:** the verifier now rechecks the manifest and ordinary homepage
  together on every attempt. The existing 60-check budget and 5-second intervals
  remain, with useful retry diagnostics and the last mismatch in the final error.
  A previously matching manifest is not assumed to stay current at every edge.
- **Fail-closed safeguards preserved:** exact expected manifest/commit/digest,
  matching HTML version and installer URL, no-store manifest, nosniff/CSP headers,
  configured HTTPS Azure hostname and subsequent asset checks. Installer integrity,
  main-only publishing, obsolete-main guard, Azure credentials and permissions
  are unchanged. There is no fallback that accepts an old release as success.
- **Verified:** 34 marketing Node cases and 30 browser cases pass; static site
  builds. Eight new injected-request/clock cases cover the observed race, stale
  manifest regression, wrong download link, endpoint failures, exhausted retries,
  security/identity checks and invalid destinations. The exact patched CLI also
  passed a read-only verification against the live 0.1.121 site and its assets.
  No installer was built and no release/deployment was triggered. The historical
  run remains failed; the fix takes effect after owner merge/promotion to main.

## 2026-10-01: marketing workflow, focused media and purposeful motion

- **Implemented on the marketing feature branch:** retained the approved paper,
  ink, condensed typography, purple and Wispa identity. Reworked the story into
  Library → Crate Digger / YouTube sources → Wanted / store searches → Mix Plans
  → direct USB export → recording / feedback. The previously bare “Good sets
  start before you play” section now provides a usable workflow route.
- **Current UI, real song waveform:** replaced all four old full-window PNGs with
  eight focused WebPs and four short silent recordings of actual client actions.
  The owner approved names from Garage / Old Skool House and actual waveform
  analysis for Robin S — Show Me Love (Tonka's 2002 Club Mix). Capture reads
  selected metadata through read-only SQLite and decodes the active audio in RAM;
  no music, databases, real paths, credentials or accounts are published or altered.
  The review example uses that same song's real min/max waveform, with illustrative
  feedback; it does not pretend to be a recorded DJ mix. USB/provider results are
  illustrative, not live external operations. Provenance and media integrity/size
  checks are included; MP4s containing an audio stream are rejected at build time.
- **Accessible motion:** subtle one-time reveals and on-arrival demonstrations,
  explicit keyboard pause/resume/replay, offscreen/background pause, reduced-motion
  and data-saving opt-outs, static no-JS/error fallbacks, actual reload on retry.
  No looping, tracking, remote media or framework dependency was introduced.
- **Truthful product copy:** more emphasis on discovery/Wanted and planning;
  Soulseek is optional secondary copy. Availability means Discogs matches and
  store search links, not guaranteed stock. Main USB copy says compatible CDJs;
  the disclosure retains the documented original CDJ-900 hardware baseline and
  reference-entry / beatgrid / detailed-waveform limitations, not universal support.
- **Release scope:** existing latest-installer rendering and develop/main release
  gates remain intact. Deployment checks now cover all updated media/MIME types;
  no production deployment, installer build or merge is part of this feature work.
- **Local verification:** static marketing build, all 26 Node cases and all 27
  Chromium browser cases pass, including production/no-JS download behaviour,
  360–1920 px layouts, 200% text, media MIME/ranges, reduced motion, data-saving,
  retry and keyboard replay. The current client production build also passed
  (existing large-bundle warning unchanged). Desktop/mobile layouts and decoded
  video frames were inspected; all 12 media assets total about 1 MB. The original
  checkout's unrelated DiscoveryScanWorker edit remains untouched.
- **CI test hardening:** the first marketing CI run exposed a timing/policy
  assumption in the blocked-autoplay test. It now waits for the rejected automatic
  attempt and permits native playback only after a trusted control click, without
  depending on headless Chromium's transient userActivation state.
- **Separate app follow-up (not implemented here):** tracklist titles can omit
  a stored Version, making different mixes indistinguishable. The capture labels
  the Tonka version explicitly; this is not a fix to app tracklist rendering.
  Physical mobile and additional CDJ compatibility tests remain outside this pass.

## 2026-10-01: desktop upgrade serves the current UI

- **Confirmed cause:** owner installed 0.1.111 / production commit `d891e09`.
  Both shortcuts targeted that installation and its current HTML/JS matched the
  redesign build. Launch logs instead requested September's old hashed assets
  without requesting the entry HTML. The persistent WebView reused cached HTML;
  previous installer assets still present on disk allowed the old UI to load.
  This was not a failed merge or a lost library.
- **Implemented:** Photino launches with `?wisp-ui=<assembly release identity>`
  (including the release/commit), bypassing cached entry URLs on upgrade. HTML
  responses, including default-file, HEAD and conditional 304 responses, now
  carry `Cache-Control: no-store, max-age=0`. The loopback origin/port stays the
  same; no WebView profile, preferences, drafts, database, cues or music is reset.
  Asset/API caching and existing installed files are not destructively changed.
- **Regression coverage:** 12 backend cases cover release-key changes, existing
  queries/fragments, real static/default files, conditional requests and unchanged
  asset/API semantics. A real persistent Chromium disk-cache test reproduces old
  HTML at the unversioned URL after the new app starts, then proves the actual
  release-key launch loads current on-disk HTML and the redesigned sidebar, keeps
  localStorage and remains current on another browser launch.
- **Release gate strengthened:** that cache test runs on PR validation against
  the tested application DLL and built client, and against the actual installed
  executable on the main-only Windows installer runner. Installer HTTP checks
  also compare served HTML with the installed entry file and verify cache headers
  and the same-origin launch URL. The previous fresh-profile/reinstall-only smoke
  did not exercise a warmed browser cache and missed this defect.
- **Verification scope:** local tests use generated, isolated browser/library
  profiles, not the owner's installation/data. Persistent Chromium exercises the
  failure and fix but is not a native WebView2 upgrade acceptance test; the owner
  must relaunch the new installed release to confirm that final environment.
  The first full backend run hit one unrelated USB-test temporary-directory
  access error; the complete Infrastructure rerun passed all 185 tests.
- **Local verification complete:** the subsequent full backend run passed all
  500 tests (115 Core, 185 Infrastructure, 200 API). Client 61 unit/137 browser
  tests and production client build pass; lint has no errors and 12 pre-existing
  warnings. Two persistent-cache probes passed against the real built app; Node
  and installer PowerShell syntax checks pass. Existing bundle-size warning
  remains. The unrelated dirty Discovery source in the original checkout is
  untouched; generated profiles/cache/artifacts are ignored by Git.
- **Delivery:** feature branch `codex/desktop-upgrade-cache` targets develop.
  Owner approved implementing/releasing this patch. Merge/release follows green
  checks only; production publication and final installer URL are reported after
  the main pipeline succeeds. No installer is built/installed locally.

## 2026-10-01: UI redesign final release verification

- **Scope:** all UI phases #42–#45 are merged into develop and owner visually
  approved. Verification uses merged `d02c8e7` in a separate checkout on
  `codex/ui-release-verification`, with a fresh isolated profile and generated
  audio. Owner library/cues/music/USBs and unrelated Discovery source edit are
  untouched. No production merge, packaging, install or deployment performed.
- **Release blocker corrected:** full browser verification caught sidebar
  tooltips intercepting adjacent navigation clicks at scaled-equivalent widths.
  The harden skill guided placement outside the sidebar hit area; hints remain
  hoverable, keyboard-described and Escape-dismissible. Added an explicit
  adjacent-navigation regression; no drag/audio/API/export behaviour changed.
- **Backend:** all 488 tests pass (115 Core, 185 Infrastructure, 188 API), using
  existing FFmpeg for isolated audio tests. Three additional full Infrastructure
  runs pass. Previous PR #45 date-backfill timeout did not reproduce; its root
  cause is not established. Merged develop validation run 36860987829 is green.
- **Client:** after tooltip fix, 61 unit and 137 browser tests pass; client build
  and browser-test TypeScript check pass. Lint has no errors/12 existing warnings;
  existing roughly 511KB initial bundle warning remains. No root build/publish.
- **Release support:** 8 dependency-download recovery tests, 23 marketing unit
  tests, 17 marketing browser tests and marketing build pass locally. Main-only
  production packaging/publishing/deployment gates and smoke scripts reviewed,
  not executed locally or bypassed.
- **Native:** actual Photino/WebView2 launches and loads production client/assets
  from an isolated profile; generated track playback advances across Library,
  Mix Plans and sidebar collapse. Xone:24C Input 1 captures stereo float 44.1kHz
  for 67.76 seconds across navigation and Settings; capture start pauses library
  audio, explicit stop reaches Ready without issue and complete WAV decodes with
  FFmpeg. This near-silent test verifies lifecycle, not both musical deck routes
  or listening quality. Native Settings exposes modal-only accessibility content
  and dismisses with Escape without stopping capture.
- **Still unverified:** successful sustained OLE drops to WISP playlists/plans,
  Explorer and rekordbox. One automated multi-track drag releases before handoff,
  reports it safely and leaves playlist empty; no success claimed. Native complete
  keyboard focus loop/return is inconclusive in accessibility focus reporting;
  full browser focus coverage passes. Actual Windows 125/150% display scaling
  not changed/tested; browser equivalents remain separate. No live-provider,
  physical USB or new CDJ hardware acceptance.
- **Release gate:** merge verification fix into develop after CI, then owner
  accepts remaining manual checks/limitations and authorises develop→main.
  Main push builds the installer, verifies install/start/upgrade/uninstall and
  publishes download/checksum plus website. No new installer exists yet.
- **Owner release decision:** subsequently explicitly authorised merging this
  verification PR and develop→main once checks pass, accepting the documented
  remaining manual-check limits. This is release acceptance of limitations,
  not evidence that deferred hardware/OLE/scaling checks passed. Production
  pipeline completion and the new installer URL must be reported separately.

## 2026-10-01: UI 4 remaining workspaces and final consistency implemented

- **Delivery:** `codex/ui-phase-four-workspaces` from current origin/develop,
  after owner-approved/merged UI 3 PR #44. PR targets develop; no merge,
  auto-merge, production promotion or installer release authorised.
- **Design:** frontend-design and normalize skills guided reuse of approved
  display/body typography, shared tokens, Lucide icons, controls, section tabs
  and native modals. Flat lists and existing workspaces remain; no new theme.
- **Mixes:** Review retains the full waveform/zoom/loop workspace. Tracklist
  and Exports use compact transport without replacing the audio owner or
  unmounting editors; waveform height/preferences and comment drafts survive.
  Section navigation precedes playback. More compact export options expose the
  create action in the initial 1024x768 fixture viewport. Existing actual versus
  planned tracklists, ratings, comments, revised plans and RF64 paths remain.
- **Recording:** visible input/title/folder/optional blueprint and shared Start/
  Stop controls; technical capture format is collapsed help. Input failures and
  request errors stay outside collapsed diagnostics. No capture, checkpoint,
  recovery, endpoint identity, metering, monitoring or gain-processing changes.
- **Soulseek:** consistent page header, readable sortable results with full
  Download labels and keyboard-accessible local scrolling. Download completion
  is not called library import completion. Transfer/filter/retry/cancel/clear and
  sharing use shared controls while retaining existing contracts. Search state,
  batch feedback and header dropdown remain. Contextual search gains native
  modal focus containment/restoration and prevents dismissal during active or
  starting search/queue requests; no new polling/provider requests added.
- **Settings:** Library / Connections / Audio tools / About & diagnostics,
  with mounted forms preserving drafts across categories. Masked accessible
  credential controls, visible loading/read/save/remove errors and read retries;
  failed reads disable configuration writes. Soulseek form hydrates once, not
  on every settings refresh. Explorer errors are actionable. Removed the inert
  Coming soon placeholder, not implemented functionality. Credential drafts
  are not stored in browser persistence; existing plain-JSON credential storage
  remains unchanged and is not represented as encrypted.
- **CDJ:** shared selector and export controls, accurate overview-waveform/
  Memory Cue copy and restored keyboard focus. Physical device ID, disconnect/
  drive-letter-reuse handling, layout/preflight checks, single-flight export,
  replacement/backups and success/error dialogs remain. Historical CDJ-900
  evidence is preserved; full CDJ-850 acceptance, beat grids/detailed scrolling
  waveforms and residual reference-catalogue limitations remain explicit.
- **Verified:** 61 unit tests and all 136 browser tests pass, including eight
  UI 4 additions for compact layouts, stable audio, retained credential drafts,
  failed reads/saves, scaled-equivalent Settings, modal focus, USB scope and
  pending-search dismissal. Client build and browser-test TypeScript checks
  pass. Lint: zero errors and 12 pre-existing warnings. Existing approximately
  511KB initial-chunk warning remains; no new backend/native contracts required
  dotnet verification or local packaging.
- **Safety/limits:** fictional browser fixtures only; no working profiles,
  library/music/cues, USB contents, recording captures, external services,
  website/pipeline or installer changes. Owner visual/native acceptance stays
  open: Photino focus/scaling, Windows OLE/folder/rekordbox dragging, Xone input
  and device playback are not proved by browser mocks. Existing feature-local
  sharing draft lifecycle is unchanged; category-preserved Settings drafts
  deliberately disappear when Settings closes. Ignored after-renders are in
  `artifacts/ui-phase-four`; prior audit is the before baseline.

## 2026-10-01: UI 3 Mix Plans and discovery workspaces implemented

- **Delivery:** `codex/ui-phase-three-workspaces`, based on current develop after
  merged PR #43. Implements all seven UI 3 items; owner visual/native acceptance
  remains open. No merge, auto-merge or production promotion is authorised.
- **Shared workspace layout:** editorial headers, flat readable results and
  existing shared buttons/tabs/status/dialogs/Lucide icons, following the
  frontend-design and normalize skills. Plans/artists/sources have independent
  collapsible, pointer/keyboard-resizable navigators. Persisted widths are bounded
  to 180–360px/default 240px; invalid saved values fall back safely without
  resetting existing preferences. No new font, theme or backend contract.
- **Mix Plans:** ordered Tracklist is the default; Chain view remains available.
  Optional transition details expose BPM/key warnings, preview and anchored filler
  suggestions. Notes and energy/key/BPM charts are deliberately expanded.
  Removed duplicate page-level plan selection from the global header. Preserved
  entry identities, internal multi-drop ordering, anchors, notes, recording links,
  recommendation playlist and export. Failed writes/partial adds are visible;
  plan rename refreshes the selected plan as well as its navigator. Preview and
  suggestions use native shared modals; local cue shortcuts remain active inside
  preview without activating Library shortcuts. Closing details restores focus.
- **Discover:** explicit My artists/Search anywhere modes precede the input;
  local artist filtering is not described as track search. Existing provider
  settings/debounce/budgets/direct YouTube URL search remain unchanged. Track/video
  results precede artist results, with persistent Watch/Soulseek/Want controls.
  Compact source matching replaces repeated provider tiles. Release status has
  shared New/Wanted/In library/Dismissed controls; follow/save/refresh/matching
  failures are actionable. Artist matching now contains and restores modal focus.
- **Crate Digger:** clear active-source context, common All/New/Want/Already have
  filters plus More filters; existing upload-date ordering/paging/SSE scan reports
  remain. Scan completion explicitly reports no new tracks and updated dates.
  Details use a scrollable non-modal right inspector, with corrections collapsed
  until needed. Close/track/source changes confirm discarding edited metadata;
  failed correction/status/availability writes retain retry controls. Correction
  inputs lock during saving to prevent a completed request clearing newer edits.
  Newly created sources enter the cached navigator before selection, avoiding a
  stale-list reset during refetch; a deliberately delayed refresh test covers it.
- **Wanted:** flat searchable wishlist with newest/oldest/artist sorting and
  All/Waiting/Found states. Soulseek and source handoffs remain. Removing a wish
  never deletes audio and still asks for confirmation: no misleading undo is
  offered without an API capable of restoring original identity/history.
- **Measured:** fictional-data renders at 1024/1366 by 768 and 1920 by 1080,
  with playback active. Open plan navigator plus transition details leaves list
  areas of 420x290, 602x326 and 1156x638px. All four pages avoid whole-window
  horizontal overflow; independent scroll areas and collapse controls remain.
  Ignored screenshots: `artifacts/ui-phase-three`. Equivalent CSS viewports at
  125/150 percent and reduced-motion checks are not native Windows scaling tests.
- **Verified:** 61 unit tests, 128 browser tests, client build and browser-test
  TypeScript checks pass. Includes existing dual-drag, playlist/duplicate, cue,
  loudness, recorder, Soulseek and CDJ-export UI suites; 19 new phase-three tests
  cover page interactions/failures/playback/layout. Lint: zero errors, 12 existing
  warnings. Build retains the existing approximately 512KB initial-chunk warning.
- **Limits/safety:** no real library/profile/music/cue/USB writes, recording
  capture, external provider requests, website/pipeline changes or installers.
  Native Windows OLE/folder/rekordbox dragging, Photino focus, physical scaling,
  live-provider results and Xone/device playback remain owner checks. Backend
  and native APIs are unchanged; mock-bridge tests imply no CDJ compatibility.
  Global page navigation still unmounts existing feature-local drafts: Crate
  discard protection covers inspector/source changes, not navigation away from
  the page. These edits are not represented as durable cross-page drafts.

## 2026-10-01: Restore the approved full-height preparation sidebar

- **Correction in PR #43:** the initial UI 2 implementation placed the cue/details
  area inside the height-limited top preparation pane, diverging from the approved
  prototype. Restored a separate right column spanning both waveform and track
  list. It contains the track summary, saved Memory Cue bank and existing Markers,
  Notes, Tags, Metadata and Matches sections; no cue/export semantics change.
- **Independent controls:** Collapse track sidebar gives the left workspace its
  full width without closing the waveform. Show track sidebar reopens it. Focus
  list still hides both preparation areas without stopping playback. Stable portal
  placement retains editor/tab state and the existing table/audio owners; collapse
  returns keyboard focus to the reopen control. Existing shared tokens, controls
  and Lucide icons were reused under the frontend-design/normalize skills.
- **Measured:** the inspector is 602px high at 1024/1366 by 768 and 914px at
  1920 by 1080, independent of waveform resizing. Compact browsing remains 11/11/19
  complete rows. Narrow preparation tables scroll locally rather than overflowing
  the whole window. Ignored screenshots remain under `artifacts/ui-phase-two`.
- **Verified:** client build, browser-test TypeScript check, 58 unit tests and
  all 109 browser tests pass; lint has zero errors and 12 existing warnings.
  Added geometric coverage for full-height placement and independent resizing,
  plus collapse/reopen focus, scroll, zoom, audio and unsaved-notes retention.
  Existing drag, playlist, cue, recording, export UI and Soulseek suites pass.
- **Limits:** owner/native visual and drag acceptance remain open. No backend,
  real library/profile, music, USB, recording capture or installer changes. Client
  build retains the existing approximately 514KB initial-chunk warning. This updates
  the same open develop PR; no merge, auto-merge or production promotion.

## 2026-10-01: UI 2 Library, playlists and precision preparation implemented

- **Actual application migration:** implemented the approved Library direction
  on `codex/ui-phase-two-library`, following merged UI 1/PR #42. A clear All
  tracks/playlist header, primary search, optional advanced filters and one
  selection toolbar replace the stacked action bars. Frequent Add to mix/Add
  to playlist actions stay visible; Library actions contains maintenance,
  loudness/versions, playlist removal and duplicate scan. Normalised/original
  version feedback stays visible even when the File column is hidden.
- **Playback versus preparation:** ordinary Play/double-click browsing uses a
  compact full-width bottom overview. Prepare deliberately opens a wide top
  waveform and right-hand cue/details sidebar. Focus list hides preparation
  without stopping audio or resetting zoom, height or in-session editor drafts.
  The single application-lifetime audio deck remains mounted across navigation.
  Zoom offers whole track and 60/20/6/2-second playhead-centred windows; existing
  beatgrid, beat snapping, hover/wheel magnifier and cue seeking remain. Keyboard
  seeking and 10ms nudges update paused position immediately.
- **Cue clarity:** separate saved Memory Cue/loop bank and editorial WISP
  markers, millisecond timestamps, counts and explicit save/remove/error feedback.
  Saving means selected in WISP for the next export, never automatic USB sync.
  Hot Cues remain explicitly unsupported on CDJ-850; no new cue type/export
  format is invented. Marker-generation tools are collapsible. Existing structural
  suggestions run only during explicit preparation; failed cue reads cannot
  masquerade as an empty list and trigger automatic writes.
- **Space and columns:** active plan defaults to a 40px summary and expands
  into a drawer without shrinking the track list. Existing drops, ordering,
  notes and transition preview remain. DJ preparation/Recently added/File
  management presets and selectable, pointer/keyboard-resizable columns persist
  with bounded defaults; Recently added selects newest-first track sorting.
  Track dates remain distinct from playlist-entry dates. Keyboard row actions,
  context-menu navigation/Escape/focus return and table semantics are provided.
- **Measured actual-client layouts:** 1,205 fictional tracks, playing audio,
  selection and compact plan show 11 complete rows at 1024 by 768 and 1366 by
  768 (429px list), and 19 at 1920 by 1080. Core DJ columns fit without horizontal
  overflow. The default 328px preparation plus 12px handle leaves a 174px list/
  four rows at the laptop sizes. Only 24 rows are mounted there; virtualisation
  and the existing scroll owner are retained. Ignored screenshots are under
  `artifacts/ui-phase-two`; no user library data is used.
- **Verified:** 58 unit tests and all 108 browser tests pass; client build and
  browser-test TypeScript checks pass. Lint has zero errors and the 12 existing
  warnings. New browser coverage includes real WAV/audio ownership and paused
  position retention across search/sort/paging, zoom/beatgrid/fine seek, pointer
  and keyboard resize, preference persistence, Memory Cue save/remove/failure,
  missing-audio recovery, failed library/track/cue reads and retry, plan multi-drop/
  keyboard reorder, and equivalent 125/150 percent CSS viewports/reduced motion.
  Existing native-drag-contract, duplicate/occurrence removal, loudness, recording,
  Soulseek and CDJ-export UI suites still pass.
- **Limits and safety:** native Windows OLE/folder/rekordbox dragging, Photino/
  WebView2 focus, physical Windows scaling and Xone/audio-device acceptance remain
  owner checks. Existing 4096-bucket peaks are reused: millisecond controls do
  not promise sample-accurate waveform analysis. Build retains an approximately
  512 KB initial-chunk warning and existing lazy feature loading. No backend,
  database/profile, working music/cues, USB, website, pipeline or installer/publish
  changes. Removed only the unused client BulkActionBar component; its source is
  recoverable from Git. The two design skills guided reuse of UI 1 tokens, shared
  controls and the approved content-first layout rather than a second design system.
- **Next gate:** owner reviews the UI 2 PR into develop and checks playback,
  Prepare/Focus list, cue editing and internal/external dragging locally. Phase
  implementation items are checked; native/owner acceptance and production
  promotion remain open. UI 3 then covers Mix Plans and discovery workspaces.

## 2026-10-01: UI 1 application foundations and navigation implemented

- **Implemented in PR #42:** approved dark editorial direction in the actual
  client, with shared colour/type/spacing/focus tokens, self-hosted DM Sans and
  Barlow Condensed fonts, reusable buttons, section navigation, native menus,
  status messages, dialogs and hover/keyboard tooltips. Font licence downloads
  are included in About and emitted with static-server-compatible `.txt` names.
- **Navigation:** Workspace and Find music groups with consistent Lucide icons
  and 38px rows; independently scrolling/searchable playlists, visible keyboard
  management menus, current-page breadcrumbs and bounded global plan controls.
  Compact navigation defaults consistently at 1100px, with additive saved
  preferences and an explicit searchable playlist drawer. The drawer is non-modal
  so Library selection and internal drops remain usable. Existing duplicate
  confirmations, occurrence identities and native drag contracts are preserved.
- **Accessibility:** Settings now uses a native modal, contains Tab/Shift+Tab
  focus, prevents background interaction and returns focus on close. Common
  confirmations/prompts/alerts and playlist creation use the same foundation;
  queued prompts retain separate drafts. Playlist menus handle keyboard navigation,
  errors and retry. Unavailable scan actions have focus-accessible explanations.
- **Verified:** 56 unit tests and all 95 browser tests passed; client build and
  browser-test TypeScript checks passed. Lint has zero errors and 12 existing
  warnings. Browser renders cover 1024 by 768, 1366 by 768 and 1920 by 1080,
  long names/55 playlists, all destinations, empty/error states, contrast,
  reduced motion and equivalent 125/150 percent CSS viewports. Screenshots use
  fictional fixtures under ignored `artifacts/ui-phase-one`.
- **Regression evidence:** the existing internal/external drag-contract,
  duplicate/removal, CDJ-export UI, recording, Mixes, loudness and Soulseek browser
  suites pass. A real browser audio element/WAV fixture keeps playing across
  navigation, sidebar changes and Settings; mocked active capture stays visible
  without a stop/restart request. Native bridge mocks do not verify Windows OLE,
  rekordbox dragging, WebView2 focus, Xone capture or CDJ hardware. Physical
  Windows display scaling and owner visual/native acceptance remain outstanding.
- **Limits and safety:** build emits a roughly 505 KB initial-chunk warning;
  existing lazy feature loading is retained. No backend, user library/profile,
  audio/cue data, USB, website or release pipeline changes; no installer/publish
  was run. The actual Library/player/preparation layout is unchanged, including
  existing waveform/beat-grid/cue behaviour. Its migration belongs to UI 2.
- **Next gate:** owner reviews/merges PR #42 into develop and checks the native
  interactions before UI 1 acceptance is marked complete. UI 2 then implements
  the approved Library/preparation layout; production promotion remains owner-led.

## 2026-10-01: Accepted UI direction and precision preparation preview

- **Owner decision:** approved the shell direction with the adjustment that
  compact bottom playback must not replace a usable cue editor. The design
  approval gate is checked; application UI 1 and UI 2 remain unimplemented.
- **Prototype revised:** wide top waveform above the track list, Memory Cue
  bank on the right, whole-track through two-second zoom, centred playhead,
  visible cue markers, click/keyboard seeking, millisecond timestamp display
  and 10 ms adjustments. Pointer/keyboard resizing is bounded; Focus list
  collapses preparation and reopening restores the session's chosen height
  without resetting the position. Production preferences are still pending.
- **Verified prototype:** Browse and Selected + plan retain eight full rows
  at 1366 by 768 and 1024 by 768; expanded preparation retains four with the
  waveform taking priority. All three states also passed at 1920 by 1080.
  Browser checks passed for zoom, cue seeking, click seeking, fine positioning,
  pointer and keyboard resize, height/position retention and Focus list, plus
  existing search, selection, modal focus, tooltips and equivalent-zoom checks.
- **Limits:** waveform samples and cues are fictional, not real audio analysis
  or a detected beat grid. This verifies the layout and interaction proposal,
  not audio-accurate cue placement in WISP. No application code, audio controller,
  user profile, music, database, USB or release pipeline was changed.
- **Next:** migrate the accepted shared foundations/navigation into WISP for
  UI 1; implement the actual preparation layout and precision controls in UI 2.

## 2026-09-30: UI 1 shell and Library approval preview

- **Started:** isolated interactive design prototype in `design/ui-redesign`,
  representing the visual gate before UI 1 application migration. No application
  source, profile, audio, cue data, USB or production site is changed.
- **Visual proposal:** marketing-inspired dark surfaces, DM Sans and condensed
  headings, clearer navigation icons/groups, separately scrolling playlists,
  compact-navigation playlist drawer, compact bottom transport and one right
  pane for preparation or active plan. Shared selection tools replace search
  tools instead of adding another permanent toolbar.
- **Prototype only:** fictional Library/playlists, selection, cue feedback,
  column controls, tooltip behaviour and native Settings dialog focus. Audio,
  downloads, export, maintenance and other page destinations are not connected;
  demo controls explicitly disclose this. The real Settings focus repair and
  shared application foundations are still pending.
- **Verified prototype:** browser checks for Browse/Prepare/Selected with plan
  at 1024 by 768, 1366 by 768 and 1920 by 1080, retaining at least eight complete
  track rows at the two laptop sizes. Long labels, search/empty state, Select all,
  optional date column, playlist filtering and compact drawer, Settings focus
  containment/return, keyboard tooltips/Escape and illustrative cue feedback
  passed. Reduced-motion mode and equivalent 125/150 percent CSS viewport checks
  passed; the latter are not physical Windows display-scaling evidence.
- **Safety and limits:** browser reported no script/console errors or requests
  to WISP APIs/external services. Fonts/icons reuse existing dependency assets;
  no new package or generated asset is added to Git. Static prototype tables
  do not validate real-library virtualisation, Windows OLE dragging, playback,
  capture or CDJ hardware. These remain later implementation regression gates.
- **Next gate:** owner approval of the visual example. The two prototype delivery
  checkboxes are checked; UI 1 implementation and all later phases remain open.

## 2026-09-30: Application UI redesign audit and phased plan

- **Planning implemented:** tracked
  [UI redesign plan](WISP_UI_REDESIGN_IMPLEMENTATION_PLAN.md) with four bounded
  implementation phases, per-phase checklists, acceptance criteria and a shared
  regression checklist. This documentation does not implement the redesign.
- **Audit evidence:** 25 rendered states across all main pages, playlists,
  preparation and Mixes sub-pages using fictional browser fixtures; laptop-width
  checks include 1366 and 1024px. The sampled Library list shrank from 550px
  alone to 80px with preparation, expanded plan and multi-selection. Settings
  allowed keyboard focus behind its overlay. USB dialogs were source-reviewed,
  not exercised against physical storage.
- **Proposed direction:** marketing-inspired typography, crisp borders and
  restrained purple in a dark desktop workspace; grouped navigation, usable
  playlists in compact mode, contextual tools, configurable Library columns,
  deliberate preparation/plan drawers and consistent accessible controls.
  The owner must approve a shell/Library visual example before broad migration.
- **Delivery:** shared foundations/navigation, Library/preparation, planning/
  discovery, then remaining pages/final review, through codex branches and PRs
  into develop. Owner merge and production-promotion policy is unchanged.
- **Protected behaviour:** internal and external multi-file dragging, playlist
  occurrence identity/duplicates, playback/capture across navigation, Memory
  Cues, existing export safeguards, relinking/audio versions and plan/actual
  recording tracklist separation. Native/hardware checks stay distinct from
  mocked browser evidence; no new CDJ compatibility is claimed.
- **Current limit:** all UI implementation phases and visual approval remain
  pending. No application source, data, export engine or release pipeline changes
  are included in this planning PR.

## 2026-09-30: Production marketing/release pipeline (deployment acceptance pending)

- **Implemented:** main-only installer → smoke test → verified draft/public GitHub
  Release → anonymous EXE/checksum verification → static site build → Azure
  production deployment. PR/develop/manual jobs validate only. Draft uploads are
  verified by digest/size; published assets are immutable to retries. Main runs
  are not interrupted by newer pushes, and main-tip guards reject obsolete runs.
- **Production download:** baked-in public installer link, version and signing
  disclosure. No visitor GitHub API call or sign-in is needed, including with JS
  disabled. A no-store `release.json` records commit/version/installer SHA-256.
- **Azure provisioned:** WISP-only `rg-wisp-prod`, Free `wisp-web-prod` at
  `https://zealous-smoke-0124a0503.4.azurestaticapps.net`, managed identity with
  Contributor scoped to this site, production-only OIDC federation and a
  main-only GitHub environment. No DNS, custom domain, paid SKU, permanent secret
  or Pulse/Physiqo resource was changed. Bootstrap/runbook are committed.
- **Validation repaired:** workflow-policy tests now cover marketing validation,
  release/deploy dependency chain and main-only permissions rather than assuming
  the original two-job workflow. Local: 23 release/production tests, 17 browser
  checks and four workflow-policy tests pass, including API-outage/no-JS
  production downloads. Live release/deployment evidence will be recorded after
  the authorized promotion, not inferred from local tests.
- **Release hardening:** explicit same-major security pins for Microsoft.OpenApi
  2.7.5 and SQLitePCLRaw bundle 2.1.12 (native SQLite 3.53.3); an in-memory test
  guards the runtime SQLite security baseline. All 488 backend tests pass; the
  application NuGet vulnerability audit reports no known vulnerable packages
  against the current configured advisory sources.
- **Limits:** unsigned Windows installer (SmartScreen may warn); Free Azure
  hosting has quotas/no SLA; no custom domain or automatic post-deployment
  rollback. Failed-job retry retains tested artifacts; rebuilding an already
  published version with different bytes is intentionally refused. App redesign
  is deferred; no new CDJ hardware compatibility claim is made.

## 2026-09-30: Design-first marketing homepage prototype

- **Implemented:** independent static site in `src/Wisp.Marketing`, with warm
  paper/ink/flat-purple styling, condensed typography, square edges, sparse hard
  button shadows, editorial feature sections and the existing Wispa mark. No
  gradient decoration, status badges, fabricated testimonials or feature-card
  grid. Desktop application source and installer packaging steps are unchanged;
  production packaging also waits for the new marketing validation job.
- **Visual evidence:** four screenshots of the real WISP client captured against
  fictional browser-only API fixtures. No user database, credentials or music
  are accessed; screenshots are labelled as a demo collection. Self-hosted fonts
  include their licence files in the site output.
- **Download discovery:** anonymous latest-stable GitHub Release lookup, own-repo
  HTTPS Windows installer selection, canonical/versioned names, safe text-only
  version display and six-second timeout. Missing releases, network failures and
  rate limits have useful GitHub fallbacks; no fake version or broken download is
  presented as ready. The page remains navigable with JavaScript disabled.
- **Scope:** a working local prototype for design approval. Azure/DNS/domain
  provisioning and public release publishing are deliberately deferred. Existing
  Actions installers are not made publicly downloadable by this change. Azure
  Static Web Apps security headers and independent validation are prepared.
- **Hardware claims:** homepage USB wording is limited to the documented owner
  CDJ-900 playback/overview/Memory Cue test, with player/format caveats. No new
  hardware acceptance is claimed.
- **Verification:** static site build and 10 release-selection tests pass, as do
  15 browser checks covering 360/390/768/1440/1920px, enlarged text, keyboard
  focus, reduced motion, no-JavaScript fallback, release success/missing/error/
  timeout states, assets and hosting headers. Desktop/mobile renders and all four
  source screenshots were reviewed. The unchanged desktop client build passes
  with its existing chunk-size warning. Physical mobile, Azure deployment and
  public installer-download acceptance remain untested at this prototype stage.
- **Dependency audit:** the isolated marketing package reports zero known
  vulnerabilities. The existing root development toolchain separately reports
  critical `concurrently`/`shell-quote` advisories; it is not included in the
  static site's output and is left unchanged for a dedicated dependency fix.

## 2026-09-30: Dedicated Soulseek workspace, resilient transfers and opt-in sharing

- **Implemented:** a profile-gated Soulseek sidebar page with separate Search,
  Downloads and Sharing sections. The existing header transfer dropdown remains
  available and opens the Downloads section. Search results/query and the last
  section survive navigation within the application session; peer filenames are
  not persisted to browser localStorage.
- **Search:** shared contextual/workspace search UI, format/quality/slot/locked
  filters (including AIFF/AIF), sortable file/duration/quality/size/user/queue
  columns, multi-selection and sequential download queueing. Restricted results
  cannot be downloaded. Single and partial batch failures are visible, including
  from the dropdown after navigating away. Stop queueing finishes the current
  request without submitting the remaining files. Server searches are actually
  stopped/deleted; network connection status checks logged-in state, not simply
  daemon availability. A reconnect action is available when slskd is reachable.
- **Transfers/imports:** active/completed/failed-or-cancelled filters, file/user
  filtering, cancel/retry, clear individual/all finished history, active folder
  visibility, speed/queue information and library-import status/retry. Clearing
  still removes history only, never music files. Additive `SoulseekImportReceipts`
  migration replaces process-memory receipts, scoped to the daemon URL hash.
  Completed receipts survive restart and history clearing. Interrupted import
  scans become explicitly retryable on startup; a retry retains its original
  folder if the download preference has since changed.
- **Queue acknowledgement:** slskd may return HTTP 201 with a `Failed` list and
  no enqueued file. This is not reported as success. Queue HTTP calls have a
  separate four-minute timeout because slskd can wait up to three minutes for a
  peer acknowledgement; availability/list probes retain their three-second
  timeout. Transfer polling continues while a queue request is pending.
- **Sharing:** disabled by default, explicit selected folders only, persistent
  upload slot/speed limits, current share counts and scan status, rescan, active
  uploads and targeted upload cancellation. Drive roots, WISP profile paths and
  the configured private recording folder are rejected. Managed YAML excludes
  incomplete/private recording directories, identity sidecars and common
  metadata/artwork/temporary files. Normal and dotted music directories remain
  searchable (slskd applies regex filters to directories as well as files).
  Folder aliases avoid exposing full local paths to peers. Single-quoted YAML
  preserves Windows backslashes and apostrophes correctly.
- **Explicit limitations:** saving/enabling/disabling sharing or changing limits
  requires restarting WISP; the running connection is left unchanged, so active
  transfers are not interrupted. External slskd folder/limit configuration is
  read-only in WISP; share monitoring/rescan/upload cancellation remain available.
  Filters are not an exhaustive privacy boundary: select folders containing only
  files you intend to distribute. No chat/rooms/buddy management or automatic
  whole-library sharing. Cleared slskd history is not reconstructed as a permanent
  download catalogue. Successful folder scan completion does not certify that
  every downloaded file was playable/indexed; the UI says “Library scan complete”.
- **Protocol evidence:** checked bundled slskd 0.25.1 search, server, shares,
  transfers, download service and share scanner source. Peer-to-peer downloads
  and uploads on the user's account have not been exercised by this change;
  network availability, peer restrictions and router/firewall setup still apply.
  User credentials, library database and music remain untouched by testing.
- **Verification:** all 486 backend tests (115 Core, 184 Infrastructure, 187 API),
  53 client unit tests and 84 browser tests pass. Client build passes; changed
  frontend files lint clean and the full lint run has no errors (12 existing
  warnings). Compact Search/Downloads screenshots were reviewed. Generated YAML
  also passes the bundled slskd 0.25.1 offline startup/config validation with
  isolated fake credentials and `--no-start --no-connect`; no peer login occurs.
  Existing dependency vulnerability advisories and the client chunk-size warning
  remain; these checks do not substitute for a live peer transfer test.

## 2026-09-30: Portable track identity beyond filenames

- **Implemented:** the existing track GUID is stored as `WISP_TRACK_ID` in MP3
  ID3, FLAC Vorbis comments, M4A custom metadata and AIFF ID3. WAV, Ogg and Opus
  use adjacent `.wisp-id.json` sidecars. A read-only folder can retain identity
  in the database even when neither embedded tags nor a sidecar can be written.
- **Verification independent of tags:** a versioned SHA-256 fingerprint of
  demuxed audio packets plus audio format information is stored separately from
  the existing file/cache hash. A matching GUID is accepted for relocation only
  with matching audio identity and duration. If an editor strips the GUID, the
  audio fingerprint can still recover the track. Different audio carrying a
  copied GUID and multiple matching replacement files are not automatically linked.
- **Integration:** rescans initialise existing tracks without changing their
  GUIDs or relationships, identify moved files across the scanned root, and
  refresh key/BPM/energy while preserving curated text. Playback/download can
  recover a renamed file within its previous directory; moving folders requires
  a rescan of the destination. The previous conservative name-based recovery is
  retained only for legacy rows that have no audio identity yet.
- **Safe writes:** embedding stages a copy, verifies readable metadata, artwork,
  identity read-back and unchanged audio, then atomically replaces the original.
  Failed embedding falls back to a sidecar. Existing normalisation/loudness
  source validators are protected by using sidecars for those tracks. Explicit
  relink and active-version changes invalidate the old identity cache. Generated
  normalisation files remain excluded from ordinary discovery/backfill.
- **Rollout:** the additive database migration has nullable fields; it does not
  rewrite music at startup. Run a rescan once in the updated application to
  initialise identities before external renaming. Initialisation needs FFmpeg;
  if unavailable, ordinary metadata scanning continues and identity work is
  deferred. Recovery does not promise to identify re-encoded/edited audio.
- **Evidence:** synthetic fixtures cover all eight supported extensions,
  arbitrary renames/moves, key/BPM/title changes, stripped identifiers, copied
  identifiers, duplicate ambiguity, sidecars left behind, read-only sources,
  preservation of custom tags, and existing playlist/cue identity. These are
  format/integration tests, not a claim that every Mixed In Key version preserves
  custom tags; fingerprint fallback is independently tested. No live user music
  was tagged or migrated during this implementation.
- **Verified:** 115 Core, 184 Infrastructure and 168 API tests pass with the
  bundled FFmpeg enabled. The offline recovery tool builds, and EF reports no
  pending model changes. Existing dependency advisory warnings remain.

## 2026-09-30: Recover library links after external filename analysis

- **Incident confirmed:** Mixed In Key was configured with `RenameAfterProcessing=True`
  and `FileNameFormat=Name_Key_Tempo`. It renamed files such as `Alton Miller -
  Eggun.mp3` to `Alton Miller - Eggun - 9A - 123.mp3`; WISP retained the old
  path, causing playback to return `file_missing` (HTTP 410). The audio remained
  on disk.
- **Owner library repaired:** 149 unique, one-to-one renamed paths were linked
  back to their existing WISP rows. Track IDs, cues, device cues, playlists,
  mix plans, tags, notes and dates were preserved. The confirmed accidentally
  removed `Forces Of Nature - Jessie's Song Tell Me (Miami Vocal Mix)` was
  re-added as a new row; its previously deleted cues and playlist memberships
  could not be recovered from the available data.
- **Recovery safety:** Before the live repair, a SQLite backup was made at
  `C:\Users\scott\AppData\Local\Wisp\backups\rename-recovery-applied-20260930\wisp-before-recovery.db`.
  The repair was hash-gated and did not move, rename, delete or rewrite audio.
  The post-repair database passes SQLite integrity and foreign-key checks; 42
  older unavailable rows remain deliberately retained.
- **Implemented in WISP:** scanner recovery runs before importing new paths;
  unique same-folder analysis-suffix matches retain the existing row, while
  ambiguous candidates are skipped for explicit relink. Playback and download
  attempt bounded same-folder recovery. Curated metadata and preparation are
  preserved while fresh key/BPM/energy tags are accepted.
- **Recovery tooling:** `tools/Wisp.LibraryRecovery` creates a non-destructive
  plan report by default and requires explicit `--apply` with WISP and Mixed In
  Key closed. It never deletes unresolved rows or files.
- **Verification:** full solution tests pass (115 Core, 168 Infrastructure,
  168 API). The known NU1903 dependency warnings remain unrelated.

## 2026-09-17: Resilient, consistent FFmpeg acquisition in CI

- **Failure confirmed:** main push run `35227109392` failed during Validate's
  FFmpeg preparation because the moving gyan.dev latest URL returned HTTP 503.
  The production installer job was skipped; this was not an application build
  or test failure. The develop-to-main promotion itself was already merged.
- **Implemented:** validation and packaging now share `ffmpeg-dependency.json`,
  pinned to the installer's existing FFmpeg 8.0.1 essentials ZIP and SHA-256.
  The GitHub release URL is primary with the same publisher's asset API endpoint
  as fallback. Neither URL depends on gyan.dev. Both endpoints remain GitHub
  infrastructure, not independent protection against a total GitHub outage.
- **Implemented:** shared bounded retries/timeouts, backoff, checksum verification
  on every cache hit and fresh download, and unique partial files promoted only
  after verification. Exhausted retries fail clearly; no unverified binary is
  accepted. slskd's existing pinned archive also uses this shared helper; its
  version/hash and the separate signed WebView bootstrapper flow are unchanged.
- **Implemented:** CI caches only the FFmpeg ZIP, keyed by the pinned manifest,
  in validation and production packaging. Extraction selects exactly one binary
  in isolation, checks its version, and preserves the existing binary on failure.
  No recursive clearing of tools/ffmpeg; local development binaries are no longer
  blindly accepted as the release test dependency.
- **Verified:** eight offline download tests (including HTTP 503, fallback,
  retries, checksum failures and cache paths) run in CI. Actual cold downloads
  from both GitHub endpoints match the pinned checksum; extraction/version smoke
  test and warm-cache reuse pass in isolated local directories. No local installer
  or application package generated; no music, USB or application database changes.
  All 430 backend tests (115 Core / 149 Infrastructure / 166 API) pass with the
  freshly downloaded pinned FFmpeg enabled; PowerShell syntax/diff checks pass.
- **Release policy unchanged:** only a successful push to main packages an
  installer. Merge this fix into develop, then promote develop to main again;
  rerunning the old failed commit will still use the old downloader.

## 2026-09-14: Rekordbox USB crash — transaction bookkeeping and playlist positions

- **New compatibility failure:** owner reports rekordbox 7.2.16 crashes when
  opening the WISP USB. CDJ-900 playback/waveform/Memory Cue acceptance does not
  establish that rekordbox can safely open or edit the same database.
- **Crash evidence:** the September 14 dump records a read access violation at
  `rekordbox.exe+0x2561392`; a September 10 dump has the same fault offset, with
  its original trigger unknown. Local instruction inspection shows a loop
  population-counting/clearing 16-bit masks and moving backwards in 36-byte
  groups until a remaining counter reaches zero. No private symbols or claimed
  symbolized stack trace; dumps remain private and outside Git.
- **Concrete defect matching that loop:** six WISP-modified pages declare one
  changed row but retain 3–10 transaction bits from earlier appends. The preserved
  native reference has matching counts/masks. Subtracting an oversized mask
  population from a count of one underflows, allowing an out-of-page scan. This
  is supported by the code/fixture evidence and the successful owner retest below.
- **Implemented:** each template append clears the previous transaction masks,
  marks only its own row, and uses the current database sequence before advancing
  it. Fresh development databases now also publish matching transaction counts.
  Presence masks, track/audio paths and waveform/cue encoding are unchanged.
- **Implemented:** playlist-entry positions restart at one per playlist; duplicate
  tracks retain separate occurrences. New root playlists append after existing
  sibling sort orders. Missing referenced tracks fail rather than silently vanish.
- **Validation:** validate transaction counts, masks and first-changed slot in
  templates and staged/installed exports, with native paired failure sentinels
  supported. Reject invalid/shared/cyclic table pages, uninitialized data pages,
  heap/directory overlap and transaction bits beyond allocated slots. Playlist
  checks use stored positions rather than physical row order and reject gaps,
  duplicates and colliding sibling sort orders. This remains a bounded validator,
  not full DeviceSQL compatibility certification or a general repair utility.
- **Controlled F: retest prepared:** hash-gated offline repair of the saved
  pre-crash catalogue changes 27 bytes on six data pages plus the file header,
  only transaction metadata/sequence and playlist positions/order. The repaired
  file passes the new validator; the pre-crash file is rejected. Installed it
  with the saved working Pioneer tree after verifying the spare's physical
  identity and closed apps. All nine installed Pioneer files are verified against
  the snapshot except that deliberate PDB repair; all seven audio files are
  byte-identical. No audio or waveform/cue regeneration, formatting or deletion.
  The post-crash tree is recoverable at
  `F:\WISP\backups\PIONEER-before-rekordbox-compat-20260914`; both original and
  crash snapshots remain under `E:\Wisp USB Backups`, outside Git.
- **Owner-confirmed rekordbox retest:** after installing the repaired saved
  catalogue, the owner reports that opening/browsing F: now works without a crash.
  This confirms the repaired USB opens in their rekordbox environment; it does
  not certify later edit/delete/sync operations.
- **Verification:** 115 Core, 149 Infrastructure and 166 API tests passed with
  FFmpeg enabled and the private native/pre-crash/repaired fixtures exercised
  read-only. Added 21 transaction/playlist cases, including 16-row group and page
  boundaries, repeated/empty playlists, corrupt masks/counts and native sentinels.
  Client code is unchanged; existing NuGet advisory warnings remain. No installer.
- **Pending acceptance:** CDJ waveform/cue/playback regression; then a fresh export
  from the patched WISP app. The one-off saved-file repair is not itself proof that
  every fresh export or rekordbox edit works. Reference catalogue removal,
  template independence and the Devices workspace remain separate open work.

Format reference: [DeviceSQL transaction and playlist structure](https://djl-analysis.deepsymmetry.org/rekordbox-export-analysis/exports.html).

## 2026-09-14: Consolidated pending CDJ work after the Mixes redesign merge

- Consolidated PRs #29 (cue encoding/USB selection), #30 (waveforms/path lookup)
  and #31 (milestone cleanup/Devices roadmap) into #31, updated against `develop`
  after the owner merged #28. Preserved both sets of implementation history in
  the status-file conflict; the merged Mixes UI and all CDJ changes remain intact.
- No new feature, USB mutation or hardware compatibility claim. Devices browsing
  and ordering remain planned; catalogue pruning still needs the recorded
  evidence gates. Superseded PRs are closed without merging their branches.
- **Combined verification:** 115 Core, 128 Infrastructure, 166 API, 53 client
  unit and 74 browser tests passed; client build and lint passed (13 existing
  warnings). Existing NuGet advisories remain. No installer generated.

## 2026-09-13: CDJ milestone cleanup, recovery snapshot and Devices roadmap

- **Safe closeout, not full Phase 25 completion:** preserve the owner's accepted
  CDJ-900 playback/overview/Memory Cue baseline. Reference-only catalogue entries
  still remain; template-independent export, catalogue pruning and broader
  hardware/format coverage are not implemented by this cleanup.
- **Export UI:** replace stale test-only/pending-hardware messages with accurate
  CDJ-900 scope, safe-eject/cue-recall instructions and remaining limitations.
  Replacement explicitly means the whole Pioneer library, not incremental sync,
  with the previous PIONEER and WISP audio backed up first.
- **Missed entry point fixed:** the header's Mix Plan dropdown now uses the shared
  USB picker/export component, including physical-device identity and replacement
  review. Removed its obsolete folder-picker API wrappers. A browser regression
  test exercises that exact entry point and rejects any folder-picker request.
- **Dead code removed:** the disabled catalogue-only switch and unused
  `ClearCatalogueRows` deletion prototype. This does not change the active
  database append/analysis encoder or remove any reference tracks from a USB.
  Do not resurrect the unverified deletion algorithm as a compatibility fix.
- **Recovery evidence:** with owner authorization, copied the current spare F:
  contents to `E:\Wisp USB Backups\2026-09-13-working-cdj900-76F3C2B2` outside Git.
  All 53 files (345,357,611 bytes), including existing backups and player files,
  were length/SHA-256 verified, then the source inventory/hashes rechecked.
  Only Windows System Volume Information was excluded. This is a file snapshot,
  not a sector image; the single-partition MBR/FAT32 USB was not changed.
  One spare USB suffices for sequential samples; other prepared USBs stay untouched.
- **Next evidence gate:** capture a native rekordbox before/after device-track
  deletion on that same spare, preserving both states before implementing pruning.
  The working WISP snapshot is a recovery baseline, not that deletion fixture.
- **Planned, not built:** [Devices workspace phases](WISP_USB_WORKSPACE_PLAN.md):
  actual device-library browsing first, then USB-local draft ordering with explicit
  reviewed Save to USB; later incremental playlist management and cue/history
  import. Browsing/playing/dragging does not auto-sync. Reordering must preserve
  audio paths and byte-identical analysis to protect the accepted hardware baseline.
- **Verification:** 115 Core, 128 Infrastructure and 166 API tests passed using
  an isolated build output; client build, 53 unit tests, 73 browser tests and lint
  passed (13 existing warnings). No installer, production-data mutation or new
  hardware test performed.

## 2026-09-13: CDJ-900 hardware acceptance — waveform and Memory Cues working

- **Owner-confirmed result after `5f05fb1`:** following the analysis-path repair
  and re-export in the ongoing F:/Smoke Test Mix/CDJ-900 test, the owner reports
  that both the waveform and Memory Cues are working. Together with the earlier
  playlist/playback confirmation, this verifies direct Wisp export with overview
  waveform display and Memory Cue recall in this tested CDJ-900 workflow.
- **Scope:** this is user-reported physical hardware evidence, not just a binary
  parser/test pass. The report does not individually certify all 11 timestamps,
  loops, every supported audio format, large libraries or the CDJ-850. Those
  cases need separate acceptance tests; do not label export universally flawless.
- **Key repair:** player-derived audio-path hashing places Wisp's analysis where
  the CDJ looks for it. A PDB link alone was insufficient. Preserve this lookup
  behavior and its regression tests in future exporter changes.
- **Remaining work:** remove retained reference catalogue entries/template
  dependency, handle analysis hash collisions beyond safe rejection, and address
  VBR seek indexes/beat grids/detailed waveforms as separately scoped features.
  No additional code, USB changes or formatting were needed to record this result.

This successful hardware report supersedes the pending waveform/Memory Cue
acceptance statements in the historical entries below for this CDJ-900 test.

## 2026-09-13: CDJ analysis lookup path repair — hardware retest pending

- **Hardware result:** the owner re-exported with waveform support and still
  saw no waveform. F:'s version-3 receipt confirms the new exporter was used;
  all seven DAT files contain the generated previews. Software validation was
  insufficient: a self-consistent PDB link does not establish player discovery.
- **Concrete path mismatch:** for Blue Monday, Wisp wrote analysis under
  `P001/00000001`, while the CDJ created its own file under `P050/00018218`.
  The published rekordbox audio-path hash reproduces the latter exactly. It
  also reproduces all three saved rekordbox reference directories and the
  previously observed CDJ-created directories for the other two loaded tracks.
  This establishes an incorrect lookup location; it does not prove there are
  no other analysis-acceptance requirements on CDJ-850/900.
- **Fixed:** derive `PIONEER/USBANLZ/Pxxx/yyyyyyyy/ANLZ0000.DAT` from the exact
  USB-relative audio path using UTF-16 code units and uint32 wraparound, instead
  of sequential DeviceSQL IDs. PDB links, DAT placement and receipt paths use
  the same result. Waveform-bearing export validation now also requires this
  player-derived location. Waveform payloads, cue encoding, audio, catalogue
  allocation and USB layout are unchanged in this follow-up.
- **Collision safety:** detect duplicate analysis paths before copying tracks
  and before sidecar writes. The 200003-bucket hash can collide; until shared
  bucket allocation is hardware-verified, stop with an actionable error rather
  than overwrite another selected track's waveform/cues.
- **Verified:** 115 Core, 128 Infrastructure and 166 API tests. Added published
  path vectors, UTF-16/overflow coverage, a genuine hash-collision case, rejection
  of the former self-consistent ID-based folder and opt-in comparison against
  private rekordbox/player-created folders. Reanalyzed all seven actual export
  tracks into an isolated template-based test database at the corrected paths,
  validating their previews and all 11 cue timestamps. USB and production data
  were read-only. Client code is unchanged from the preceding 72-browser /
  53-unit-test pass; no installer generated. One published example disagrees
  with that source's own algorithm and is not used as a trusted test oracle;
  the actual local rekordbox/CDJ evidence matches.
- **Next:** rebuild/restart the updated debug app and export the same playlist
  to F: again, accepting the existing-library backup/replacement. No formatting
  is needed. Safely eject, load from the WISP playlist and check the overview.
  This lookup repair could also affect cue discovery, but Memory Cue recall
  remains unconfirmed. Missing VBR/beat-grid/detailed-waveform support and the
  retained reference catalogue remain separate limitations.

Algorithm source (reported hardware work used CDJ-3000, so checked locally
against the owner's older-player files rather than assuming compatibility):
[fourfour — ANLZ path hash](https://github.com/morizkraemer/fourfour/blob/master/pioneer-usb-writer/reference-code/PIONEER.md#1-anlz-path-hash-algorithm).

## 2026-09-13: CDJ overview waveform export — software verified, player test pending

- **New hardware evidence:** after the MBR/single-FAT32 preparation, the owner
  reports that the CDJ-900 recognizes the USB and plays tracks loaded directly
  from the WISP playlist. This establishes basic playback for that test, not
  complete compatibility. The owner is unsure about Memory Cue recall and will
  retest it; it is **unconfirmed**, not a confirmed failure or success.
- **Waveform diagnosis:** the seven-track version-2 export had no `PWAV` or
  `PWV2` sections. Its 11 cue timestamps remained intact. Additional apparently
  player-created `ANLZ0001.DAT` files existed for three tracks; their existence
  does not establish why the player did or did not use Wisp's cue data.
- **Implemented:** decode each staged audio copy through the configured/bundled
  FFmpeg and write 400-column `PWAV` and 100-column `PWV2` overview previews in
  its `ANLZ0000.DAT`. Set the database analysis date and validate its analysis
  and audio path links. Original audio, cue timestamps, playlist allocation and
  physical USB layout are unchanged. This adds overview waveforms, not detailed
  scrolling/RGB waveforms, beat grids or MP3 variable-bitrate seek indexes.
- **Signal handling:** stream 44.1 kHz stereo PCM into bounded 10 ms energy
  summaries, using actual decoded length rather than cached track duration.
  Separate channel energy avoids anti-phase cancellation. Preserve silence and
  the final partial window; fixed square-root RMS display scaling does not
  normalize the music or alter playback gain. PWAV uses neutral whiteness;
  Wisp is not reproducing rekordbox's proprietary spectral/color analysis.
  Tiny-preview low-nibble range follows the privately preserved reference.
- **Safety:** complete analysis and validation before replacing the existing
  library. Decode failure/cancellation leaves existing USB files intact; hidden
  FFmpeg children are terminated on failure/cancellation. Ten-minute analysis
  timeout per track, six-hour decoded duration cap, bounded stderr. Application
  exports cannot silently skip an unavailable analyzer. Both export endpoints
  return actionable waveform errors through Wisp's existing dialogs.
- **Validation/receipt:** reject missing/duplicate/malformed preview sections,
  incorrect counts/header constants, tiny heights outside the profile range,
  payload mismatches and wrong database links/dates. Version-3 receipts retain
  every cue timestamp and add preview sizes and decoded sample-frame count.
  Dialogs now explain waveform analysis and the pending physical test.
- **Verified locally:** 115 Core, 117 Infrastructure and 166 API tests pass;
  client build, 53 unit tests, all 72 browser tests and zero-error lint pass
  (13 existing warnings).
  Real FFmpeg integration ran, including anti-phase WAV, corruption handling,
  all seven tracks from the owner's F: receipt, and an isolated template-based
  database containing their waveforms and all 11 cues. Preview headers match
  the three private rekordbox reference DAT files. No USB files or production
  library data were modified by these tests. Existing SQLite/OpenAPI package
  advisory warnings remain unrelated. No installer was generated.
- **Next:** rebuild/restart Wisp, re-export `Smoke Test Mix` to the existing F:
  USB, confirm the backup/replacement dialog and safely eject. Load the WISP
  playlist on CDJ-900 and check the overview waveform. No reformat is required.
  Waveform display and Memory Cue recall still require physical verification;
  retained reference catalogue entries remain a known limitation.

Format sources: [Crate Digger ANLZ schema](https://github.com/Deep-Symmetry/crate-digger/blob/main/src/main/kaitai/rekordbox_anlz.ksy)
and [Beat Link preview decoder](https://github.com/Deep-Symmetry/beat-link/blob/main/src/main/java/org/deepsymmetry/beatlink/data/WaveformPreview.java).

## 2026-09-13: connected USB selector and CDJ-900 NO USB diagnosis

- **Hardware report:** the owner exported `Smoke Test Mix` from the corrected
  debug build; the original CDJ-900 displayed **NO USB**. This is not a successful
  player acceptance result for the cue repair.
- **Read-only finding:** Windows reports a single approximately 32 GB Generic
  Flash Disk using **GPT**, with its main FAT32 volume at F: and a 512 KiB
  `UEFI_NTFS` boot partition at H:. These are partitions of the SAME physical
  USB, not two separate sticks. Formatting F: alone retained the GPT layout and
  second partition. AlphaTheta explicitly lists GUID partition maps as unsupported
  on CDJ-900. The earlier instructions to format FAT32 alone were incomplete.
- **Export inspection:** version-2 receipt identifies seven copied tracks,
  three playlists and 11 Memory Cues. All seven audio paths exist. Independent
  read-only decoding of their DAT files found the corrected 56-byte record
  boundaries and all cue timestamps matching the receipt. This does not prove
  playback or cue recall on the player.
- **Implemented:** Export to CDJ USB opens a Wisp-styled USB selector with a
  labelled dropdown, refresh/automatic recheck, volume label/letter, device model,
  capacity/free space, filesystem, partition style/count and preparation warning.
  One entry per physical USB (largest mounted volume); internal/system disks and
  unmounted disks are not offered. USB-attached SSDs are detected by bus type,
  not just Windows' Removable classification. No folder browser in this flow.
- **Implemented safeguards:** block GPT/unknown layouts, multiple partitions,
  unsupported filesystems, system/internal/read-only/unready disks. HTTP export
  requires the selected device identity; the backend validates it at preflight,
  before copying and again after staging/before replacing the library. A changed
  selection is rejected rather than silently following a reused drive letter.
  Existing non-root infrastructure folder fixtures remain isolated test exports;
  the application API cannot use this as a folder-picker bypass.
- **Read-only discovery:** bounded, hidden Windows Storage inventory subprocess
  runs a fixed Get-Disk/Get-Partition/Get-Volume script with no interpolated user
  arguments. Detection errors block export and offer refresh. The support CLI
  `--list-cdj-usbs` runs without starting Wisp, creating a profile or opening its
  database. Tested against the owner's USB: F:, GPT, two partitions, blocked.
- **Verified:** 381 backend tests (115 Core / 100 Infrastructure / 166 API),
  53 client unit tests, 72 browser tests, client build and zero-error lint pass.
  Browser checks include GPT blocking, missing/swapped USBs, refresh/error
  recovery, confirmation/cancel and no folder-picker call. Visual inspection at
  1400px and 800px; selector is lazy-loaded. No local installer generated.
- **USB preparation completed after separate owner approval:** backed up all 29
  non-system files from both F: and H: (115,197,663 bytes), verifying each copy's
  length and SHA-256 before erasure. Only Windows-managed `System Volume
  Information` was excluded. The private backup and verification manifest are at
  `E:\Wisp USB Backups\2026-09-13-before-mbr-76F3C2B2`, outside Git. Recreated only
  the identity-checked USB as **MBR with one FAT32 partition**, 32 KiB clusters,
  labelled `WISP USB` at F:. The former H: boot partition is removed; its files
  remain in the backup. No internal disks were changed. Windows retained GPT
  after clearing and temporarily held F:'s old mapping; guarded preparation
  stopped at each unexpected state before completing the verified layout.
- **Post-preparation verification:** Windows reports one MBR/FAT32 partition;
  Wisp's read-only `--list-cdj-usbs` reports `CanExport: true` and no compatibility
  problem. The volume contains only Windows filesystem metadata: old exports
  were not restored. The separate local Pioneer reference remains available.
- **Next hardware test:** freshly export `Smoke Test Mix` from Wisp to F:, safely
  eject, then test the WISP-prefixed playlist and Memory Cues using the player's
  CUE/LOOP CALL controls. Layout acceptance by Wisp is not hardware acceptance;
  CDJ-900 playback and Memory Cue recall still need physical proof. Catalogue
  cleanup and Pioneer waveform support remain unresolved.

Source: [AlphaTheta — CDJ-900 USB device not recognized](https://support.alphatheta.com/en-US/articles/19545774076185?product=4416496076569).

## 2026-09-13: CDJ Memory Cue encoding repair — hardware test pending

- **Fixed:** classic `PCPT` entries now occupy exactly 56 bytes. The old writer
  declared 56 but emitted 60, writing cue type as uint32 rather than one byte
  plus the three-byte `00 03 e8` field. This shifted cue/loop timestamps and
  broke the next record boundary. Corrected the `0x00010000` marker and matched
  the reference PMAI header and empty cue-list sentinel as well.
- **Verified locally:** literal format-oracle tests and independent field-offset
  decoding cover zero/multiple cues, time zero, milliseconds, loops and malformed
  records. Opt-in comparison with the privately preserved September rekordbox
  reference matched all six classic Memory Cue records across three DAT files
  (normalizing only creation-order versus timestamp-order link fields).
  The reference currently has two stored points per track, including a near-start
  point; no USB/hardware acceptance is inferred from this comparison.
- **Fixed validation:** before installation and again afterwards, decode every
  cue's signature, length, type, flags, ordering and timestamps. Check audio-path
  tag, section boundaries and unique cue lists. The former count-only validator
  accepted malformed records. Regression tests explicitly recreate that bug.
- **Diagnostic reference:** the exporter can read an explicitly preserved
  `<WISP_DATA_DIR>/pioneer-reference/export.pdb` (normally under
  `%LOCALAPPDATA%/Wisp`) before searching separate connected USBs. An explicit
  `WISP_PIONEER_TEMPLATE` override takes priority and fails if missing/invalid.
  The target itself cannot be its own reference. Reference selection happens
  before copying music; no reference is automatically learned from Wisp output.
- **Local test preparation:** the owner's F: export.pdb and USBANLZ directory
  were copied privately to that reference folder, outside Git. Database SHA-256
  matched before/after copy. This is NOT an audio/full-USB backup. F: was not
  written or formatted. Formatting the test USB no longer removes the only
  available database template on this PC.
- **Export UX:** prevent repeat clicks, show errors in Wisp dialogs, and state
  the retained-catalogue limitation in both fresh and replacement confirmation.
  Version-2 export receipts record each cue/loop timestamp in milliseconds.
- **Verification:** 26 targeted Pioneer tests pass with the private PDB and DAT
  reference enabled. Full backend suite: 369 passing tests. Client unit tests:
  53 passing; browser suite: 69 passing, including fresh/replacement/cancel/error
  CDJ export flows. Client production build and lint (zero errors) pass. Existing
  SQLite/OpenAPI dependency advisory warnings remain unrelated to this change.
- **Not shipped as full compatibility:** no new hardware result yet. Template
  tracks remain visible; clean independent catalogue generation, Pioneer
  waveforms/beatgrids and VBR seek analysis remain unresolved. Synthetic loop
  tests are not hardware proof. This repair does not change the catalogue
  allocator that previously permitted three-track playback on CDJ-850.
- **Next test:** run the updated build, format the intended test USB as FAT32
  only after retaining any wanted files, save two clearly separated Wisp **CDJ
  Memory** cues per track, explicitly export a small playlist, safely eject, and
  open the playlist prefixed `WISP` on each player. Check audio and use
  **CUE/LOOP CALL**, not just the large transport CUE button, to verify both saved
  times. Record CDJ-850 and original CDJ-900 results separately. Extra template
  tracks and no waveform are expected in this isolated cue test.

Format reference: [Crate Digger's independent ANLZ schema](https://github.com/Deep-Symmetry/crate-digger/blob/main/src/main/kaitai/rekordbox_anlz.ksy).
This entry supersedes older claims below that cue counts alone validate export.

## 2026-09-13: Phase 26g UI — approved Mixes redesign

- **Implemented:** the owner-approved recording-desk/listening-notebook concept.
  The sidebar now says **Mixes**. Its library has real cached waveform thumbnails,
  search, review/attention filters, date/title/duration/rating sorts, saved planned-set
  names, ratings and recording/file status. Record and import are explicit actions.
  Selecting a row opens a separate mix workspace rather than expanding one long page.
- **Recording desk:** separate setup and active-capture views; prominent server-clock
  duration, stereo dBFS meters, clipping warning and Stop and save. Input diagnostics
  are behind Test input & routing and remain open after results/errors. The global
  capture indicator returns to the recorder after navigation/reload. Successful stop
  opens the saved take; capture, checkpoints, close protection and recovery use the
  existing backend. No fabricated live waveform or software monitoring.
- **Individual mix:** persistent, height-adjustable waveform/transport; distinct
  Review / Tracklist / Exports areas preserve the same audio element and in-progress
  forms while switching. Comment ranges, comment/bookmark/track-start icons and a
  separate playhead layer replace indistinguishable ticks. The peaks canvas no longer
  redraws or recreates its resize observer for each playback update.
- **Review:** star satisfaction controls (including Unrated), status, listening notes,
  composer and personal reflection. Explicit Save feedback and Save comment & feedback
  commit all review edits atomically. Unsaved/draft/saving/error states remain visible;
  existing local draft persistence, conflict checks and discard confirmation remain.
  Quick bookmarks still save separately and are not actual track entrances or song cues.
- **Tracklist and plans:** compact occurrence rows, per-row timing/order editor,
  direct Go to start, library/manual additions, historical blueprint comparison/linking
  and Revise for next time. Original plan snapshots and actual played entries remain
  separate; no automatic track recognition, guessed timestamps or rewritten history.
- **Exports and files:** dedicated format choices (320 kbps MP3 / 24-bit WAV / exact
  master), destination and export history. Existing verified jobs, cancellation,
  immutable tracklist copies and RF64-derived playback are preserved. Details & files
  contains show-folder, recover, relink, new linked take and separately confirmed
  remove-entry/delete-managed-audio actions. No duplicate saved-takes audio players.
- **Shell/responsiveness:** unrelated global Mix Plan/scan controls and the duplicate
  track player are hidden in Mixes; the shared track audio engine stays mounted.
  Narrow Mixes windows compact the sidebar (expand remains available), and review
  columns/controls reflow. Library/mix navigation resets scroll and survives reload
  within the window; restoring navigation never starts a recording or export.
- **Verification:** 469 tests: 115 core / 70 infrastructure / 164 API / 53 client /
  67 browser. Client typecheck/build and lint pass (13 pre-existing lint warnings).
  Browser tests cover the redesigned navigation, retained playback/composer across
  tabs, sticky player at 800×600, ratings/drafts, recovery, input-test results, exports,
  tracklist/revision workflows and existing drag/playlist/loudness regressions. API
  checks cover 32-bin cache-only thumbnails, missing sources, unchanged master bytes
  and historical planned-set names. Desktop/small-window screenshots reviewed using
  isolated mocked browser APIs, not the owner's recordings.
- **Evidence boundary:** no live database/music/`D:/Mixes` writes, new Xone capture,
  installer build or CDJ compatibility claim. Existing NuGet advisory warnings remain.
  Long-session Xone/unplug/sleep/native-close and independent exported-mix listening
  acceptance are still open; this implements the UI part, not all Phase 26g gates.

## 2026-09-13: Phase 26f — finished-mix exports and large-master playback

- **Implemented:** Recordings → choose a mix → Export finished mix. Choose a
  destination, MP3 320 kbps CBR / 24-bit PCM WAV / exact original master, and
  optionally include the saved actual tracklist. This exports the complete recorded
  mix, not individual songs or a rekordbox/CDJ USB database.
- Every export has a unique folder beneath `WISP Mix Exports`, with audio and a
  title/date/hash manifest. MP3/WAV carry title/date tags; original-master copies
  are byte-identical. No automatic normalisation or destructive processing. WAV
  converts float to 24-bit PCM at the master sample rate; standard WAV's 4 GiB
  ceiling is enforced. Larger exact masters retain RF64, or use MP3 for compatibility.
- Tracklists are immutable copies of the saved actual list at a checked revision:
  confirmed entrance times sorted chronologically, repeated/equal-time occurrences
  retained, played-but-untimed entries separately labelled, drafts excluded.
  No invented timestamps, blueprint substitution, private comments or ratings.
- Durable job IDs/history, progress, cancel, errors and no-overwrite retries.
  Capture/input tests and mix import/export are mutually exclusive. Source format,
  length and SHA-256 are checked under a read lock. Encoded output is verified as
  stereo / required bitrate or PCM subtype and fully decoded to count frames and
  confirm duration before publishing; all audio/log buffers are bounded.
- Preflight estimates the new copy plus reserve alongside the existing master;
  monitor free space during processing. Flush/hash output and atomically publish
  its directory on the same volume. Cancel removes only recognised owned temporary
  files; unexpected files/links are retained. Restart marks unfinished jobs
  Interrupted. Completed packages after a DB commit failure remain at the reported
  path; create a fresh export after restart to register another copy, never overwrite.
- Verified MP3 exports now enable playback of >4 GiB RF64 takes in WISP. Normal
  mixes can select original or export playback. Playback never starts an export,
  and capture still pauses/blocks it. Missing/changed exports are not treated as
  valid playback copies. Scanner/Git exclusions keep generated mixes out of library/code.
- **Verification:** 468 tests (115 core / 70 infrastructure / 164 API / 53 client /
  66 browser). Full FFmpeg encode/decode of 3-minute and approximately 46.6-minute
  sparse >4 GiB fixtures; 320 kbps checked in every MP3 frame; 24-bit WAV subtype/
  frame length, metadata, source/review preservation, request retries, real-process
  cancel, disk/encoder/DB failure, owned cleanup/restart, range playback, stale
  tracklists and rollback guard. Browser flows cover options, progress/navigation,
  failed retries/reload and large-master derivative playback. Client build/typecheck
  pass; lint zero errors with 13 existing warnings. Prior drag/playlist/loudness/
  recording regressions remain passing. Existing NuGet vulnerability warnings remain.
- **Evidence boundary:** isolated profiles/generated audio only; no live library,
  database or `D:/Mixes` modifications, new hardware capture, CDJ claim or installer.
  Browser API responses are mocked with actual browser audio playback; the large
  encoder fixture is synthetic silence. Listen to a real exported mix independently
  before relying on it for sharing. Back up audio folders AND WISP's database to
  retain reviews, tracklists and plan history; save local browser drafts first.
- **Next: Phase 26g.** The owner-requested visual/structural recording-page redesign
  is still required. This phase used the frontend-design skill for grouped export
  options, visible job states and responsive controls within the current UI; it
  does not claim that the existing recording-page layout is now final or approved.
  Multi-hour Xone capture, native-close, unplug/sleep and real-mix listening acceptance
  remain outstanding.

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
