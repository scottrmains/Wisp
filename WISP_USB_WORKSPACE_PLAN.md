# WISP USB workspace — proposal and implementation phases

Status: planned, not implemented. Updated 2026-09-13.

## Product decision

Add a **Devices** section to the sidebar. Connected USBs appear beneath it;
selecting a USB opens a device-specific workspace with its playlists and tracks.
The existing discovery service is reusable, but the app currently only discovers
devices in the export picker. There is no device library browser or order editor yet.

The key distinction is **library playlist versus USB playlist**. Once exported,
the USB is a snapshot. Reordering a USB playlist should not silently reorder its
source Wisp playlist, alter a Mix Plan, import tracks or trigger downloads.

- Device header: label, drive letter, capacity/free space, connection and read/write status.
- Playlist pane: playlists actually present in the device database, with counts.
- Track pane: position, title, artist, duration, BPM/key where present, file availability,
  overview/Memory Cue availability. Do not imply full analysis from BPM alone.
- Order controls: drag rows, move up/down with keyboard/buttons, multi-select.
  Temporary sorting by title/BPM is distinct from saving the play order.
- Draft bar: **Unsaved USB changes · Review changes · Save to USB · Discard**.
- Explicit optional **Save as a Wisp playlist**; never an automatic two-way mirror.
- Offline/error states retain drafts but cannot write. Reconnecting never auto-applies them.

Plugging in a USB, viewing a playlist and playing a track perform **no sync writes**.
Only an explicit reviewed Save/Sync action changes device contents.

## Baseline and honest phase boundary

The owner has confirmed direct Wisp playlist playback, overview waveforms and
Memory Cue recall on CDJ-900 using the September 13 path-hash repair. Preserve
the analysis-path hash and waveform/cue encoding as the regression baseline.

This is not full Phase 25 acceptance: the template catalogue still appears,
the exporter needs a preserved Pioneer database, and incremental sync, a public
reader, restore UI, full CDJ-850/format/loop coverage and other items remain open.
The device workspace must not disguise today's whole-library replacement as a
safe incremental playlist edit.

## USB-0 — catalogue cleanup and recovery evidence

- [ ] Capture a before/after **rekordbox** deletion sample and diff track,
  playlist-entry, playlist-tree, index/allocation and transaction metadata.
- [ ] Implement catalogue pruning from that evidence; do not revive the unused
  delete-only prototype that preceded CDJ-850 failures.
- [ ] Validate the final reachable track/playlist sets exactly against the export,
  not just that expected rows are a subset of retained reference rows.
- [ ] Test multiple pages, partial/full row groups, references shared by kept
  tracks, repeated playlist entries, empty playlists and corrupt input.
- [ ] Hardware check: no reference-only tracks/playlists, while WISP audio,
  waveform and Memory Cue recall still work. Keep the accepted export recoverable.
- [ ] Separately resolve clean-machine template provisioning before claiming
  template-independent, install-and-export support.

One USB is sufficient: snapshot its working contents and hashes onto the PC,
capture each sample stage sequentially, and restore the snapshot when needed.
Never overwrite the sole golden reference or touch the owner's other prepared
USBs. A file snapshot preserves files; it is not a sector/partition image.

## USB-1 — read-only device browser

- [ ] Reuse `GET /api/cdj-export/devices` with bounded background refresh and
  explicit Refresh. No repeated overlapping inventory processes.
- [ ] Implement a defensive classic DeviceSQL reader. Read playlists, membership
  order/duplicates and track paths from **export.pdb**, not only Wisp's receipt.
- [ ] Enrich with a validated Wisp receipt where available. The current v3 receipt
  has per-track analysis information but no full playlist membership/order snapshot;
  do not infer a device playlist from its current source library playlist.
- [ ] Preserve repeated tracks as separate playlist entries. Keep entry identity
  distinct from track identity so multi-row reorder/remove behaves correctly.
- [ ] Read existing rekordbox USBs without adopting or modifying them. Unknown/new
  database formats, corrupt libraries and unsafe paths stay read-only with a reason.
- [ ] Parser bounds, cycle detection and row/size limits; treat titles and paths as
  untrusted data, never commands. Do not follow traversal/reparse paths off the USB.
- [ ] Cache per device/database revision; invalidate on disconnect/external changes.

Acceptance: shows actual device playlists/order; open/browse/disconnect leave
PDB, ANLZ, audio and device metadata hashes unchanged. This phase can proceed
independently while USB-0 fixture collection is pending.

## USB-2 — USB-local draft ordering and save

- [ ] Enable editing first for verified Wisp-managed exports. Foreign rekordbox
  libraries remain viewable but write-locked until preservation is proven.
- [ ] Persist drafts in the PC profile with device/library identity and the base
  PDB checksum. The transient drive-letter/session device ID alone is not enough.
- [ ] Dirty navigation/disconnect/reconnect behavior; display old/new order and
  the exact destination before saving. No writes on drag/drop alone.
- [ ] Reject stale drafts if rekordbox/CDJ/another Wisp session changed the library.
  Offer reload/review, never silently overwrite an external change.
- [ ] Clone the database and update only the selected playlist's ordering;
  preserve track IDs, unrelated playlists, metadata and reference rows.
- [ ] Do **not** rename/move audio to change order: analysis lookup depends on its
  exact path. Do not re-copy music or reanalyze merely to reorder a playlist.
- [ ] Stage, reopen/validate, check physical device identity and current base
  revision immediately before commit, back up and install with crash recovery.
  Serialize all exports/edits/restores per device; coordinate with close/eject.
- [ ] Clear the draft only after installed-file validation succeeds. Show an
  actionable error and retain the draft after cancellation/failure.

Acceptance: reordered playlist is correct on the player; every audio and ANLZ
file is byte-identical; unrelated playlist memberships/IDs remain intact;
stale/reused-drive-letter writes are blocked; the prior library can be restored.

## USB-3 — explicit incremental playlist management

- [ ] Add/remove/rename device playlists; choose several Wisp playlists/Mix Plans
  for one USB with a clear ownership policy.
- [ ] Versioned managed manifest: stable device/library identity, track and entry
  mappings, playlist membership/order, source revisions and content checksums.
- [ ] Review additions, updates, retained files and removals. Copy/analyze only
  changed audio/prep; preserve unrelated device content.
- [ ] Removing a playlist does not delete shared audio. Removing unreferenced
  files is a separate, explicit cleanup action with a recovery path.
- [ ] Cancellable job/progress, space preflight, safe eject guidance, backup list
  and a verified Restore action. No automatic backup deletion.
- [ ] Check drift between source and USB without silently propagating changes;
  optionally save USB order back as a new Wisp playlist.

Acceptance: unplug/out-of-space/cancel/crash recovery, repeat sync idempotence,
shared tracks, multiple/repeated entries and hardware verification all pass.

## USB-4 — bring preparation home

- [ ] Read CDJ-created Memory Cues and history, with source/version information.
- [ ] Preview imported changes; choose USB/library values per conflict.
- [ ] Keep user edits, original track identity and cue provenance; never call this
  automatic synchronization merely because a USB is connected.

## Implementation recommendation

Build USB-1 first, then a narrowly scoped USB-2 reorder workflow. These provide
the requested rekordbox-like browsing/ordering without bundling in a general
USB manager or changing the working analysis encoder. USB-3 and USB-4 remain
separate work with explicit acceptance gates. USB-0 catalogue removal is a
release-quality gate, not something to mark done because local parsers pass.
