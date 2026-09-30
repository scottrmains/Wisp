# WISP application UI redesign implementation plan

Updated: 2026-09-30

Status: shell and Library prototype ready for visual approval. No redesign phase
is implemented in the application yet. The owner approved starting UI 1; its
visual gate remains open before migrating the real application.

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
- [ ] Obtain owner approval before broad page migration. Record the accepted
  example and any requested adjustments in the status document and PR.

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
application is unchanged; only the prototype demonstrates proper modal focus.
Its Library/player/preparation layout proposes UI 2 direction for approval, not
an early implementation of UI 2. No installer or production asset includes it.

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

- [ ] Define reusable colour, typography, spacing, border, radius, control-size
  and focus tokens; replace inconsistent shared-shell styling first.
- [ ] Establish shared buttons, icon buttons, tabs, menus, status messages and
  dialog presentation. Retain suitable existing native dialog semantics.
- [ ] Choose clearer Lucide metaphors, consistent strokes and 18 to 20px main
  navigation icons. Aim for 36 to 40px navigation rows and comfortably padded
  desktop actions; do not inflate every dense table control to touch size.
- [ ] Implement tooltips for hover and keyboard focus, Escape dismissal, actual
  shortcut hints, truncated labels and unavailable-action explanations. Give
  icon controls accessible names independent of tooltips. Essential warnings
  and instructions stay visible.
- [ ] Group primary navigation; give playlists a separately scrolling area,
  search and visible management menu with keyboard access. Preserve playlist
  drop targets and duplicate confirmation when navigating/searching.
- [ ] Keep playlist access possible in compact navigation through an explicit
  accessible drawer. Make compact-window behaviour consistent across pages.
- [ ] Standardise page headers, current-page semantics and global actions.
  Keep transfer/capture status available without duplicate page controls.
- [ ] Contain Settings focus, restore focus on close and prevent background
  interaction. Validate other shared menus/dialogs rather than assuming every
  custom overlay has the same fault.
- [ ] Persist compatible layout preferences with safe defaults and bounds;
  avoid resetting existing preferences or storing sensitive data in new caches.

Acceptance: all existing destinations remain reachable with mouse and keyboard,
including configured/unconfigured Soulseek and playlists in compact navigation.
No navigation/collapse action stops active audio or capture. Shared controls
have visible focus and correctly contrasted text; Settings cannot focus or
activate content behind the modal.

## Phase UI 2 Library playlists and track preparation

- [ ] Replace stacked permanent action bars with a clear Library/playlist
  header, primary search, optional advanced filters and one selection toolbar.
  Replace scope jargon with ordinary playlist and All tracks labels.
- [ ] Create a compact persistent playback presentation and deliberately opened
  preparation workspace. Preserve resizing, focus-list behaviour, cue seeking,
  playback position and the application-level audio controller.
- [ ] Make the active plan a compact summary/drawer by default, retaining an
  explicit expanded view. Its presence must not reduce browsing to one row.
- [ ] Offer selectable, resizable columns and remembered presets for DJ
  preparation, Recently added and File management. Keep virtualisation and
  useful sorting; track dates remain distinct from playlist membership dates.
- [ ] Keep Play, Cue and Add to plan prominent. Move less frequent maintenance
  actions into an accessible menu without hiding the reason for unavailable
  audio. Reduce duplicated Overview/Metadata and action/tab content.
- [ ] Make WISP markers, saved Memory Cues and Hot Cues visibly distinct with
  timestamps, counts and add/remove feedback. Do not introduce an inferred
  exported state or pretend unsupported player cue types work.
- [ ] Preserve internal and external multi-file dragging, Ctrl+A across pages,
  row/occurrence identity, duplicate prompts, playlist removal and plan reorder.
- [ ] Verify sorting/filtering/pagination and panel resizing do not lose the
  user's position or inadvertently change the playing track.

Acceptance: at 1366 by 768, the compact browsing layout with playback, active
plan and multi-selection shows at least eight full track rows plus the header.
Expanded preparation is an explicit choice with a clear return to browsing.
At 1024px wide, core DJ columns remain usable without forcing the complete file
management grid onto the screen. Record actual dimensions and screenshots.

## Phase UI 3 Mix Plans and discovery

- [ ] Make plan/artist/source navigators collapsible or resizable, with bounded
  remembered widths and useful layouts at 1024px.
- [ ] Mix Plans: separate plan selection from the main work area; reduce
  repeated selectors. Provide a readable ordered-track view and a deliberate
  transition-detail view, preserving existing chain editing and preview.
- [ ] Discover: distinguish general music search from followed-library-artist
  filtering, with clear modes and placeholders. Prioritise track results when
  relevant without silently changing provider capabilities or search budgets.
- [ ] Discover: reduce repeated provider cards/badges, clarify follow/want/
  dismiss actions, and preserve direct YouTube link search and audition.
- [ ] Crate Digger: prioritise common status filters, move others into More
  filters, clarify scan progress/results and show source context. Preserve
  upload-date ordering and explain undated items without a permanent text bar.
- [ ] Wanted: use a readable wishlist layout with search, sort and Found/Waiting
  states. Make removal easy to understand; an undo replaces confirmation only
  if it can reliably restore the item without duplicate or lost state.
- [ ] Apply common loading, empty, offline, quota, partial-result and failure
  states. Avoid disruptive modal detail views where a stable inspector suffices.

Acceptance: each page's search/filter scope is understandable before typing.
Primary content remains usable at narrow widths, and source/plan selection does
not consume most of the screen. Audition, Want, download handoff and plan
editing continue working with accessible feedback on failure.

## Phase UI 4 Remaining pages and final consistency

- [ ] Mixes: preserve the library/record/review separation and Review/Tracklist/
  Exports tabs. Use a compact transport on Tracklist and Exports so their main
  actions appear without first scrolling past a full waveform.
- [ ] Recording: keep endpoint, destination, plan and Start/Stop unmistakable;
  place technical format/routing detail in contextual help. Preserve meters,
  recovery, recording lifecycle and no automatic monitoring/gain changes.
- [ ] Review: preserve ratings, review status, timestamp/range notes, looping,
  actual tracklist edits and revised-plan workflow. Do not rewrite blueprints.
- [ ] Soulseek: refine search-table readability and Download actions, transfer
  versus import state, batch feedback and sharing instructions. Retain search
  state, cancellation/retry, clear history and the header transfer dropdown.
- [ ] Settings: organise common settings and connections ahead of diagnostics,
  using clear categories. Keep credentials secure and advanced paths available.
- [ ] CDJ export: align picker, review, progress, success and error wording with
  current implementation, including overview versus detailed waveforms, cue
  counts, replacement/backups, reference entries and verified player limits.
  Correct the stale waveform wording; do not suppress safety warnings.
- [ ] Complete shared visual, keyboard, contrast, tooltip and window-size review
  across every page, menu, dialog and relevant busy/error/empty state.

Acceptance: Tracklist and Exports expose their primary work in the initial laptop
viewport; recording and music playback remain stable across navigation. USB UI
states agree with actual capabilities, without new hardware claims. The full
regression checklist below has evidence or an explicitly documented limitation.

## Verification checklist for each phase

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
- [ ] Approve the shell and Library visual example.
- [ ] Complete and accept UI 1.
- [ ] Complete and accept UI 2.
- [ ] Complete and accept UI 3.
- [ ] Complete and accept UI 4.
- [ ] Owner approves develop to main promotion after final regression review.

Each phase PR should summarise its completed checkboxes, before/after evidence,
test results, native checks still outstanding and any safe rollback concerns.
If a safety regression remains unresolved, leave the affected acceptance gate
unchecked and keep the previous working interaction available.
