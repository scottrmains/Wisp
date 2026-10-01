# WISP application UI redesign implementation plan

Updated: 2026-10-01

Status: UI 1 shared foundations/navigation (PR #42) are merged into develop.
UI 2 Library/playlists/preparation, including the approved full-height right
inspector, is merged into develop (PR #43) and the owner approved its appearance.
UI 3 Mix Plans/discovery is merged into develop (PR #44); the owner approved its
appearance. UI 4 is merged into develop (PR #45) and the owner approved its
appearance. All four implementation phases and owner visual reviews are complete.
Final release verification found and fixed a compact-sidebar tooltip obstruction
on `codex/ui-release-verification`; that fix still requires merging into develop.
Automated and partial native evidence is recorded below and in the status log;
remaining native acceptance and production promotion are separate gates.

## Product outcome

Make WISP easier to browse, prepare tracks, plan sets and review recordings
without losing working functionality. Bring the marketing site's deliberate
typography, crisp borders and restrained colour into a dark desktop music
workspace. Useful content takes priority over permanent toolbars and decoration.

This tracked document is the checklist for the redesign. Record implementation
and verification evidence in [WISP_IMPLEMENTATION_STATUS.md](WISP_IMPLEMENTATION_STATUS.md)
as each phase is delivered. Checked implementation items do not imply hardware
acceptance; automated, browser and native results must remain distinguishable.

## Audit baseline

The September 30 audit inspected 25 rendered states covering Library, playlists,
track preparation, Mix Plans, Discover, Crate Digger, Wanted, Soulseek, Mixes and
Settings. Browser fixtures used fictional data, not the owner's library. USB
export dialogs were source-reviewed, not exercised against a physical device.

- At 1366 by 768, the Library track-list container measured 550px alone, 210px
  with preparation open, 153px with preparation and playlist chrome, and 80px
  with preparation, an expanded plan and multi-selection. These are sampled
  states, not a guarantee for every dataset or stored layout preference.
- Global navigation plus fixed inner navigators occupy 608px in Discover,
  544px in Crate Digger and 512px in Mix Plans. The Library's fixed grid is
  approximately 1984px wide before its viewport is considered.
- Small controls include the 14px New playlist button and several 10 to 20px
  plan/player actions. Existing icons are already from one Lucide family.
- With Settings open, pressing Tab moved focus to All mixes behind the overlay.
  The newer shared dialogs and USB picker already use native modal dialogs.
- The USB picker says waveforms are not generated, contradicting the export
  confirmation's overview-waveform description. Fix wording against current
  capabilities; do not change export behaviour to make the copy simpler.
- Mixes has the strongest page hierarchy, but its large shared player pushes
  Tracklist and Exports controls below the initial laptop viewport.

Audit screenshots and metrics are local diagnostics under ignored artifacts.
Do not make those files a dependency of the tracked plan or commit user data.
Capture reproducible fictional baselines for each implementation PR.

## Scope and protected behaviour

This is a client experience redesign, not a new audio engine, export format or
library model. Reuse existing API contracts, identities and native services.

- Internal track dragging adds the intended selection to WISP playlists or Mix
  Plans. External dragging supplies audio files to Windows folders and other
  applications, including rekordbox. Neither path initiates a download.
- Preserve playlist occurrence identity, ordering, repeated entries, duplicate
  confirmation, removal and cross-page Select all behaviour.
- Navigation, collapsing a panel or opening Settings must not stop playback or
  recording. Preserve the application-lifetime player/capture owners; hiding
  presentation is not the same as unmounting the audio controller.
- Closing/stopping remains an explicit action. Keep Memory Cues, Hot Cues and
  WISP preparation markers distinct; a stored cue is not proof of USB sync.
- Preserve track identities, relinking, normalised/original audio versions,
  annotations, ratings and the separation between Mix Plan blueprints and
  actual recording tracklists. No automatic library writes or destructive edits.
- Preserve optional, profile-gated Soulseek access and transfer dropdown;
  clearing history still never deletes files. Sharing remains opt-in.
- Keep existing verified export limitations visible. No new CDJ compatibility
  claim follows from UI work. USB discovery/browsing must not imply automatic
  sync; a future Devices page belongs to [the USB workspace plan](WISP_USB_WORKSPACE_PLAN.md),
  not this redesign.
- No production website redesign, release pipeline change, database migration,
  new light theme, multitrack editor or automatic track recognition is planned.
  Small supporting API changes require an explained need and separate review.

## Design direction and approval gate

Use charcoal surfaces, warm off-white text and restrained purple, with meaningful
key, energy, progress and warning colours preserved. Use DM Sans for interface
text and the marketing site's condensed type sparingly for headings. Reuse
self-hosted font assets and licences. Prefer crisp separators, modest corner
radii and flat lists; reserve hard shadows for appropriate primary actions.

Proposed navigation groups are Workspace (Library, Mix Plans, Mixes), Find music
(Discover, Crate Digger, Wanted, configured Soulseek), and a separate playlist
area. Group names, icon choices and exact dimensions remain design proposals.

- [x] Produce a visual shell and Library example using fictional tracks, with
  ordinary browsing, playback/preparation and multi-selection states.
- [x] Show a narrow-window variation and the plan drawer behaviour, not just a
  wide empty page. Include long playlist and track names.
- [x] Obtain owner approval before broad page migration. Record the accepted
  example and any requested adjustments in the status document and PR.

Accepted adjustment: the compact bottom waveform is a playback overview, not a
cue editor. Deliberate preparation opens a wide, resizable waveform above the
track list, with the cue bank on the right. Include playhead-centred zoom,
visible cue markers, accurate seeking and fine position adjustment. Focus list
collapses preparation without stopping playback; reopening restores the chosen
height. The eight-row target applies to compact browsing, not expanded cue
editing, where precision takes priority. Production height preferences must be
saved using existing UI preferences; the prototype remembers only in-session.

The isolated prototype is in `design/ui-redesign`. Install the existing client
and marketing dependencies with `npm ci --prefix src/Wisp.Client` and
`npm ci --prefix src/Wisp.Marketing`, then run
`node design/ui-redesign/serve.mjs` and open `http://127.0.0.1:19710`.
Use Browse, Prepare and Selected + plan at the top to review the three states.
`node design/ui-redesign/test-preview.mjs` runs prototype browser checks and
saves ignored screenshots/metrics under `artifacts/ui-redesign`.

The prototype has no WISP API, native bridge, storage or audio connections.
Selection, playlist filtering, cue feedback and playback presentation are
fictional demonstrations, not implemented app features. Settings in the actual
application now uses the shared native modal and contains/restores focus.
Its Library/player/preparation layout supplied the approved UI 2 direction.
That direction is now implemented separately in the actual client; the prototype
itself is still disconnected and is not included in any production asset.

## Delivery workflow

Start each implementation branch from current origin/develop, using codex/
branches and PRs into develop. The owner decides merges and main promotion.
Use four bounded implementation PRs after this documentation PR; split a phase
further if review or testing becomes unwieldy. Every PR must leave a usable app.

| Phase | Main delivery | Depends on |
| --- | --- | --- |
| UI 1 | Shared foundations and navigation | Approved shell and Library example |
| UI 2 | Library, playlists and track preparation | UI 1 |
| UI 3 | Mix Plans and discovery pages | UI 1 and UI 2 interaction patterns |
| UI 4 | Mixes, Soulseek, Settings, export messaging and final review | UI 1 through UI 3 |

Early safety corrections such as Settings focus containment or stale export copy
may land in UI 1, with their later checklists updated. Do not leave a verified
accessibility issue open solely to match the cosmetic page sequence.

## Phase UI 1 Shared foundations and navigation

- [x] Define reusable colour, typography, spacing, border, radius, control-size
  and focus tokens; replace inconsistent shared-shell styling first.
- [x] Establish shared buttons, icon buttons, tabs, menus, status messages and
  dialog presentation. Retain suitable existing native dialog semantics.
- [x] Choose clearer Lucide metaphors, consistent strokes and 18 to 20px main
  navigation icons. Aim for 36 to 40px navigation rows and comfortably padded
  desktop actions; do not inflate every dense table control to touch size.
- [x] Implement tooltips for hover and keyboard focus, Escape dismissal, actual
  shortcut hints, truncated labels and unavailable-action explanations. Give
  icon controls accessible names independent of tooltips. Essential warnings
  and instructions stay visible.
- [x] Group primary navigation; give playlists a separately scrolling area,
  search and visible management menu with keyboard access. Preserve playlist
  drop targets and duplicate confirmation when navigating/searching.
- [x] Keep playlist access possible in compact navigation through an explicit
  accessible drawer. Make compact-window behaviour consistent across pages.
- [x] Standardise page headers, current-page semantics and global actions.
  Keep transfer/capture status available without duplicate page controls.
- [x] Contain Settings focus, restore focus on close and prevent background
  interaction. Validate other shared menus/dialogs rather than assuming every
  custom overlay has the same fault.
- [x] Persist compatible layout preferences with safe defaults and bounds;
  avoid resetting existing preferences or storing sensitive data in new caches.

Implementation scope: global shell/header and reusable foundations are migrated;
feature-specific headers, tables and specialised dialogs follow in UI 2 to UI 4.
No new keyboard shortcuts are invented or advertised. Wide and compact-window
sidebar preferences are additive; existing panel dimensions remain unchanged.
The compact playlist drawer is deliberately non-modal so background Library
selection and internal dragging remain available. Settings and confirmations
remain modal. These implementation checks do not close the native acceptance gate.

Acceptance: all existing destinations remain reachable with mouse and keyboard,
including configured/unconfigured Soulseek and playlists in compact navigation.
No navigation/collapse action stops active audio or capture. Shared controls
have visible focus and correctly contrasted text; Settings cannot focus or
activate content behind the modal.

## Phase UI 2 Library playlists and track preparation

- [x] Replace stacked permanent action bars with a clear Library/playlist
  header, primary search, optional advanced filters and one selection toolbar.
  Replace scope jargon with ordinary playlist and All tracks labels.
- [x] Create a compact persistent playback presentation and deliberately opened
  top preparation waveform with a full-height, independently collapsible cue/details
  sidebar on the right of both waveform and track list. Support zoom around
  the playhead, clear cue markers, precise seeking and fine position adjustment.
  Preserve resizing and remember the preferred dock height, focus-list behaviour,
  cue seeking, playback position and the application-level audio controller.
- [x] Make the active plan a compact summary/drawer by default, retaining an
  explicit expanded view. Its presence must not reduce browsing to one row.
- [x] Offer selectable, resizable columns and remembered presets for DJ
  preparation, Recently added and File management. Keep virtualisation and
  useful sorting; track dates remain distinct from playlist membership dates.
- [x] Keep Play, Cue and Add to plan prominent. Move less frequent maintenance
  actions into an accessible menu without hiding the reason for unavailable
  audio. Reduce duplicated Overview/Metadata and action/tab content.
- [x] Make WISP markers, saved Memory Cues and Hot Cues visibly distinct with
  timestamps, counts and add/remove feedback. Do not introduce an inferred
  exported state or pretend unsupported player cue types work.
- [x] Preserve internal and external multi-file dragging, Ctrl+A across pages,
  row/occurrence identity, duplicate prompts, playlist removal and plan reorder.
- [x] Verify sorting/filtering/pagination and panel resizing do not lose the
  user's position or inadvertently change the playing track.

Acceptance: at 1366 by 768, the compact browsing layout with playback, active
plan and multi-selection shows at least eight full track rows plus the header.
Expanded preparation is an explicit choice with a clear return to browsing.
Its waveform precision takes priority over eight visible rows; measure and
record the remaining list space rather than shrinking the cue editor to meet
the compact browsing target.
At 1024px wide, core DJ columns remain usable without forcing the complete file
management grid onto the screen. Record actual dimensions and screenshots.

UI 2 implementation evidence: fictional 1,205-track fixtures in the real client
show 11 complete rows at both 1024 by 768 and 1366 by 768 with playback,
selection and the compact plan. The list container is 429px high; default expanded
preparation is 328px plus its 12px resize handle, leaving a 174px list/four rows.
At 1920 by 1080 compact browsing has 19 complete rows. The full-height right
inspector measures 602px at the laptop sizes and 914px at 1920 by 1080; changing
waveform height does not change inspector height. It collapses independently,
retaining tabs, notes drafts, zoom, audio and the track-list scroll owner.
The compact browsing DJ view fits the two laptop widths without horizontal
scrolling; with the sidebar open at 1024px, or with optional file-management
columns, the table uses its own horizontal scroll. Only 24 rows are mounted at the laptop
sizes. Screenshots are ignored diagnostics under `artifacts/ui-phase-two`.

Verified automated controls include real browser audio/paused seeking, whole-track
and playhead-centred zoom, anchored beatgrid/magnifier, 10ms adjustment, both resize
methods, persistent sizes/columns, Focus list/audio/zoom retention, saved Memory Cue
feedback/errors, cross-page selection, keyboard menus/reorder and existing dual-format
drag contracts. All 109 browser and 58 unit tests pass. Browser bridge fixtures are
not Windows OLE, rekordbox or Xone acceptance. Cue precision still uses the existing
4096-bucket analysis; millisecond controls do not imply sample-accurate peaks.
Implementation boxes above do not close the owner/native acceptance gate below.

## Phase UI 3 Mix Plans and discovery

- [x] Make plan/artist/source navigators collapsible or resizable, with bounded
  remembered widths and useful layouts at 1024px.
- [x] Mix Plans: separate plan selection from the main work area; reduce
  repeated selectors. Provide a readable ordered-track view and a deliberate
  transition-detail view, preserving existing chain editing and preview.
- [x] Discover: distinguish general music search from followed-library-artist
  filtering, with clear modes and placeholders. Prioritise track results when
  relevant without silently changing provider capabilities or search budgets.
- [x] Discover: reduce repeated provider cards/badges, clarify follow/want/
  dismiss actions, and preserve direct YouTube link search and audition.
- [x] Crate Digger: prioritise common status filters, move others into More
  filters, clarify scan progress/results and show source context. Preserve
  upload-date ordering and explain undated items without a permanent text bar.
- [x] Wanted: use a readable wishlist layout with search, sort and Found/Waiting
  states. Make removal easy to understand; an undo replaces confirmation only
  if it can reliably restore the item without duplicate or lost state.
- [x] Apply common loading, empty, offline, quota, partial-result and failure
  states. Avoid disruptive modal detail views where a stable inspector suffices.

Acceptance: each page's search/filter scope is understandable before typing.
Primary content remains usable at narrow widths, and source/plan selection does
not consume most of the screen. Audition, Want, download handoff and plan
editing continue working with accessible feedback on failure.

UI 3 implementation evidence: the actual client is exercised with fictional
plans, artists, 601 discoveries and Wanted items. Plan/artist/source navigators
default to 240px instead of the previous 288/384/320px, with independent saved
collapse/180–360px width preferences and keyboard resize. The ordered plan view
has an optional transition inspector; chain editing and previews remain available.
Discover places explicit search modes before the input and track results before
artist results. Crate Digger uses a non-modal inspector, collapsed corrections
and confirmation before discarding edited metadata. Wanted retains confirmation
because its API cannot faithfully undo a deleted item's identity/history.

Screenshots at 1024/1366 by 768 and 1920 by 1080 are under ignored
`artifacts/ui-phase-three`. With playback and both plan/transition panels open,
the ordered list is 420 by 290px, 602 by 326px and 1156 by 638px respectively;
panels can be closed for browsing. CSS-equivalent 125/150 percent viewports are
checked separately from physical Windows scaling. Existing library virtualisation,
audio owners, download/search APIs, budgets and export formats are unchanged.
Tests cover search scopes/direct URLs, Want/follow/dismiss/restore, auditions,
download-dialog handoff, plan drops/reorder/notes/anchors/preview shortcuts,
rescan results, parse/status/availability failures, retry and safe removal.
Native Windows OLE, Photino/WebView2 focus/scaling, live providers and hardware
remain owner acceptance checks; no new device compatibility claim is made.

## Phase UI 4 Remaining pages and final consistency

- [x] Mixes: preserve the library/record/review separation and Review/Tracklist/
  Exports tabs. Use a compact transport on Tracklist and Exports so their main
  actions appear without first scrolling past a full waveform.
- [x] Recording: keep endpoint, destination, plan and Start/Stop unmistakable;
  place technical format/routing detail in contextual help. Preserve meters,
  recovery, recording lifecycle and no automatic monitoring/gain changes.
- [x] Review: preserve ratings, review status, timestamp/range notes, looping,
  actual tracklist edits and revised-plan workflow. Do not rewrite blueprints.
- [x] Soulseek: refine search-table readability and Download actions, transfer
  versus import state, batch feedback and sharing instructions. Retain search
  state, cancellation/retry, clear history and the header transfer dropdown.
- [x] Settings: organise common settings and connections ahead of diagnostics,
  using clear categories. Keep credentials secure and advanced paths available.
- [x] CDJ export: align picker, review, progress, success and error wording with
  current implementation, including overview versus detailed waveforms, cue
  counts, replacement/backups, reference entries and verified player limits.
  Correct the stale waveform wording; do not suppress safety warnings.
- [x] Complete shared visual, keyboard, contrast, tooltip and window-size review
  across every page, menu, dialog and relevant busy/error/empty state.

### UI 4 implementation evidence and limits

- Shared typography, tokens, section navigation and controls carry the approved
  design through Mixes, Soulseek, Settings and USB selection. No theme, native
  API, export format, provider budget or database migration changed.
- Review owns the full waveform and tools. Tracklist/Exports hide presentation
  only and retain the same audio element, position, waveform preferences and
  mounted editors. The compact player plus primary copy/create actions fit the
  initial 1024x768 fixture viewport. Existing ratings/comments/loop/blueprint/
  revision/export lifecycle suites remain the behaviour evidence.
- Recording input format and routing help are contextual; unavailable-input and
  request errors remain visible outside collapsed diagnostics. Endpoint identity,
  meters, recovery, saved input and no monitoring/gain processing are unchanged.
- Soulseek results scroll locally, have readable Download actions and sortable
  column semantics. Transfer/import states, retries, safe history clearing and
  optional sharing remain distinct. Contextual search uses a shared native
  modal with contained/restored focus and blocks dismissal during search/queue
  operations, including the initial request. Embedded search remains mounted.
- Settings categories are Library, Connections, Audio tools and About &
  diagnostics. Category changes keep forms mounted; credentials remain masked
  by default and drafts are not persisted in browser storage. Failed reads
  disable writes and expose Retry; failed saves keep drafts. Explorer errors no
  longer disappear silently. Existing plain-JSON credential storage is unchanged
  and remains a security limitation, not an encryption claim.
- USB selector now accurately describes overview waveforms and Memory Cues,
  with existing reference entries, replacement/backups and device-layout checks
  intact. Original CDJ-900 evidence is historical owner hardware confirmation;
  the full CDJ-850 profile remains unverified. No physical USB was written here.
- After-renders: `artifacts/ui-phase-four` (ignored), including 1024/1366x768 and
  1920x1080 recording/Soulseek, compact Mixes, Settings categories and USB picker.
  The prior audit is the before baseline; this phase does not contain a fresh
  paired before capture for every state. 125/150% equivalent Settings viewport
  and reduced-motion checks are browser evidence, not native Windows scaling.
- Final automated evidence covers all app destinations, existing virtualised
  library/selection/dual drag/cues/loudness and feature busy/error/empty flows.
  Browser focus and bridge fixtures do not establish Photino/WebView2 focus,
  Windows OLE/folder/rekordbox drag, Xone capture or hardware playback acceptance.
  Feature-local sharing drafts still follow their existing tab lifecycle; no
  cross-page draft persistence was added. Owner UI/native acceptance is open.
- Verified: 61 unit tests, 136 browser tests (eight UI 4 additions), client
  build and browser-test TypeScript checks pass. Lint has no errors and the
  same 12 existing warnings; the approximately 511KB initial-chunk warning
  remains. Backend/native tests and local packaging were not needed or run.

Acceptance: Tracklist and Exports expose their primary work in the initial laptop
viewport; recording and music playback remain stable across navigation. USB UI
states agree with actual capabilities, without new hardware claims. The full
regression checklist below has evidence or an explicitly documented limitation.

## Verification checklist for each phase

### Final release verification: 2026-10-01

Verified from merged develop `d02c8e7` in a separate checkout and fresh
`WISP_DATA_DIR`; the owner's library, music, USBs and local source edit were not
changed. The prior PR date-backfill timeout did not reproduce in a full local
backend run or three additional Infrastructure suite runs. The merged develop
GitHub run [36860987829](https://github.com/scottrmains/Wisp/actions/runs/36860987829)
passed. Its passing result does not establish the cause of the earlier timeout.

The full browser run exposed a tooltip covering the next compact navigation row.
Sidebar hints now open beside their triggers, retaining hover and Escape support.
An explicit regression covers adjacent-button clicks with a visible tooltip.
After the fix, 137 browser tests and 61 unit tests pass; client build and browser
TypeScript checks pass. Lint has no errors and 12 existing warnings; the existing
approximately 511KB initial-chunk warning remains. All 488 backend tests pass
(115 Core, 185 Infrastructure, 188 API), with FFmpeg-enabled audio tests. Dependency
download recovery (8 cases), marketing unit tests (23), marketing browser tests
(17) and marketing build also pass. No installer was generated locally.

| Acceptance area | Evidence / remaining limit |
| --- | --- |
| Responsive pages, selection, virtualisation, menus, cue/preparation controls, USB messaging | Full real-client browser suite with fictional fixtures; 1024/1366/1920 and scaled-equivalent layouts. No fresh paired before capture for every state. |
| Native playback/navigation | Production-built client in Photino/WebView2 with two generated MP3s; playback time advances across Library to Mix Plans and sidebar collapse. |
| Native capture/navigation | Xone:24C Input 1, stereo 44.1kHz float master, 67.76 seconds; capture continues through Mix Plans, Wanted and Settings. Library playback pauses on capture start; explicit stop reaches Ready with no issue. The complete WAV decodes with FFmpeg. Near-silent input does not prove musical routing, both decks or subjective quality. |
| Native Settings | Modal shows only dialog content in accessibility tree; Escape dismisses while capture continues. Full focus-cycle/return is browser-verified only; native focused-element reporting remains inconclusive. |
| Native OLE internal/external drops | Browser dual-format/duplicate/selection regressions pass. One native multi-track attempt reports early mouse release and adds nothing. Automation's short gesture does not verify a successful sustained drop. Owner must check playlists/plans, Explorer and rekordbox manually. No change to drag implementation. |
| Actual Windows 125/150% display scaling | Not changed or verified; browser-equivalent viewport checks are not OS scaling evidence. |
| Installer / production download | Production pipeline remains main-push-only. Install/start/upgrade/uninstall and public download verification run on the production runner after owner-authorised promotion; not yet run for this revision. |

This closes the implementation/visual-review scope, not all native acceptance.
Remaining manual checks may be consciously accepted by the owner for a release;
do not silently mark them passed. No new CDJ hardware or live provider claim.

Use isolated browser fixtures and WISP_DATA_DIR profiles. Never exercise delete,
rename, scan, download, normalise, record or USB-write tests against the owner's
working library. Keep screenshots, music, credentials and databases out of Git.

- [ ] Record before/after renders at 1024 by 768, 1366 by 768 and 1920 by 1080,
  plus 125 and 150 percent scaling checks. Test long names and overflowing
  content; retain useful access rather than merely shrinking labels.
- [ ] Exercise empty, populated, large virtualised, loading, disabled, offline
  and error states appropriate to touched pages. Check window resizing during
  playback and active capture without stealing keyboard focus.
- [ ] Test keyboard navigation, selection, menus, focus return, tooltip dismissal
  and resize controls. Check text/control contrast and reduced-motion behaviour.
- [ ] Run client tests, lint and client build. Run existing browser drag tests
  and add targeted interaction coverage for the changed layouts. Use dotnet
  test when native/backend contracts are touched. Do not run the root package
  build, dotnet publish or installer builds for routine redesign verification.
- [ ] Confirm large-library scrolling and filtering remain virtualised and
  responsive; avoid eager waveform loading for every row and extra polling.
  Measure suspect regressions rather than claiming performance from screenshots.
- [ ] Native acceptance for changes affecting drag/playback/capture: multiple
  tracks to WISP playlists/plans, a Windows folder and rekordbox; playback across
  pages and panel collapse; Xone input/recording navigation as applicable.
  Browser mock-bridge tests alone do not prove Windows OLE or hardware behaviour.
- [ ] Record evidence, deferred checks and known limitations in the PR and
  implementation status. Obtain owner UI acceptance before marking a phase done.

## Progress checklist

- [x] Review current pages and navigation using isolated fictional fixtures.
- [x] Record the proposed phased delivery and acceptance checklists.
- [x] Approve the shell and Library visual example.
- [x] Implement UI 1 and obtain owner visual approval (PR #42).
- [x] Implement UI 2 and obtain owner visual approval (PR #43).
- [x] Implement UI 3 and obtain owner visual approval (PR #44).
- [x] Implement UI 4 and obtain owner visual approval (PR #45).
- [ ] Merge final verification fix after its PR checks pass.
- [ ] Complete remaining native checks above, or record explicit owner release acceptance of their limits.
- [ ] Owner approves develop to main promotion after final regression review.

Each phase PR should summarise its completed checkboxes, before/after evidence,
test results, native checks still outstanding and any safe rollback concerns.
If a safety regression remains unresolved, leave the affected acceptance gate
unchecked and keep the previous working interaction available.
