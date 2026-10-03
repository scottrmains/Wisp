# WISP accounts community and premium implementation plan

Created and reviewed: 2026-10-03

Status: planning complete; implementation has not started. All delivery checklists
below are deliberately unchecked. This is the authoritative roadmap for this
feature, not a claim that accounts, cloud storage, payments or community exist.

WISP should remain a complete local DJ application that works as a guest. An
optional account will add a connected experience: a DJ profile, mix sharing,
timestamp feedback, discussion threads, optional backup across installations and,
eventually, paid benefits. Each phase delivers a usable increment without making
later phases a prerequisite for using the existing application.

This document does not authorise paid infrastructure, repository privacy changes,
premium restrictions, public uploads or a production release. Those decisions
have explicit approval gates below. The separate
[private repository and release hosting plan](WISP_PRIVATE_RELEASE_HOSTING_PLAN.md)
continues to govern private source hosting and public installer distribution.

## Product principles

- Guest use remains the default. No mandatory registration, trial countdown or
  account popup when opening the app, playing a track or exporting a USB.
- Local SQLite remains the source of truth for the local library, cues, playlists,
  mix plans and recordings. PostgreSQL serves the connected features; it does not
  replace SQLite or become a dependency of playback and recording.
- Signing in does not upload music, publish recordings, synchronise the library,
  change track identities or make personal notes public.
- Sign out, expired subscriptions and cloud outages do not delete or lock existing
  local files, cue data, playlists, recordings or existing preparation features.
- Cloud access and content ownership are enforced by the server. Hiding buttons,
  trusting a client premium flag or making GitHub private is not security.
- Sharing is an explicit action with a preview of exactly what will leave the
  device. Private local review data and public community feedback stay separate.
- Add useful functionality before charging for it. Pricing and paid feature
  boundaries require owner approval; none are introduced by the groundwork.
- Public features ship with their safety and operational requirements, not with
  an assumption that moderation, backups or abuse protection can be added later.

## Final product experience

The following is the intended finished experience. It guides the phases; it is
not the scope of the first implementation PR. Names and visual details can be
refined during UI review without weakening the privacy or guest-use rules.

### Account entry and settings

Use a compact account control in the existing navigation footer, avoiding another
large permanent navigation group. Guest shows a neutral person icon and Guest;
an account shows its avatar and display name. Clicking opens Account settings.
Keep a text label, keyboard access and a tooltip; do not rely on an icon alone.

Settings has Account, Profile, Privacy, Devices, Notifications, Cloud backup and,
only once billing exists, Plan and billing sections. Show only implemented
sections. Disabled or unconfigured cloud features must not produce misleading
working-looking sign-in, upload or upgrade buttons.

Guest can continue using WISP without dismissing repeated prompts. Sign in and
Create account open the system browser and return to the app. Password entry,
verification and password recovery belong to the identity provider. The app shows
Connecting, Signed in, Offline and Sign in again states with an actionable reason,
not raw provider errors or tokens. A cancelled login simply returns to Guest.

A profile has a display name, unique public handle, avatar, optional bio, genres
and approved external links. Email, billing details, device information and local
music paths are never public profile fields. A public profile is separately opted
into; an account can exist without joining the community.

### Community navigation and discovery

Add one Community navigation destination, separated from local preparation tools.
Within it, use subpages rather than one overloaded workspace: Explore, Following,
Discussions, Saved and My profile. Notifications use a small inbox control. Public
content can be browsed as a guest; posting, reacting, following and saving require
an account. Guest prompts explain the specific action and retain the browsing
position when cancelled or completed.

Explore presents mix artwork, creator, title, duration, genres and a clear play
action. Support search and accessible filters for genre, date, duration and sort
order. Start with understandable newest/curated views; do not promise a machine
learning recommendation engine or inspect private listening/library data.

Use WISP's established restrained visual style and marketing-site inspiration:
strong headings, clear spacing, purposeful icons and subtle motion. Avoid dense
status badges, oversized promotional panels and pushing local workflows out of
the navigation. Loading, empty, unavailable and offline states are part of each
page, including keyboard navigation, focus handling and reduced-motion support.

### Publishing and reviewing a mix

From a completed Recording, Share mix opens a focused publish flow:

1. Choose a supported external mix link initially, or a hosted audio derivative
   once uploads are implemented. Keep the local lossless master untouched.
2. Add title, artwork, description, genres and the actual performed tracklist.
   Show timestamps and track versions; the original Mix Plan is a blueprint,
   not an assumed accurate tracklist.
3. Choose Draft/private, Unlisted or Public and whether comments and downloads
   are allowed. Unlisted means anyone with the link can access it, not private.
4. Preview shared fields, review the rights and community conditions, and publish.
   Personal satisfaction ratings, private annotations and preparation notes are
   excluded unless individually selected for a supported sharing field.

My mixes separates drafts, publishing/processing, published and failed items.
Users can edit metadata, update the public tracklist, change visibility, disable
comments, unpublish or delete the cloud copy without deleting their local mix.
Replacing audio creates an explicit new audio revision; existing timestamp
comments must not silently attach to different sound at the same timestamp.

The final hosted mix page has prominent artwork/title, a useful full-width
waveform, transport controls, timestamped tracklist, creator information and a
separate feedback panel. Clicking a tracklist time or timestamp comment seeks
playback. Time-range feedback can describe a transition rather than a single
instant. External providers may not support these controls: clearly show provider
playback and open-link fallbacks rather than pretending WISP controls their player.

Personal 1–5 satisfaction ratings remain private and distinct from public likes.
Public feedback supports replies and categories such as Transition, Phrasing,
Levels and Track choice. Useful comments can be saved into a local review only
after confirmation. They never edit local cue points or a Mix Plan automatically.

### Discussions and social features

Discussion boards support named categories, threads, replies, safe formatting,
search, bookmarks, mentions and optional follows. A user can follow DJs and receive
an in-app notification when they publish a mix or reply. Email notifications are
opt-in, grouped where appropriate and independently configurable.

Every public mix, comment, thread and profile has reporting/blocking actions.
Moderation has a dedicated restricted console and an audit trail, including
removals, suspensions, reasons and appeals. Staff capabilities are server-granted,
never inferred from a local setting or visible UI route. Direct messages, live
chat and live streaming are not part of this roadmap.

### Backup and multiple installations

Cloud backup is a separate opt-in feature with a clear summary of included data,
last success, storage use and restore options. Initially it backs up selected
preparation metadata, not the audio collection. Music paths and device settings
are machine-specific; restoring metadata does not imply the audio exists on the
new computer. Relink to local files while preserving track/cue identities.

The finished experience supports selected libraries/workspaces across devices,
offline edits and a visible conflict review. It does not merge two whole SQLite
databases or replace newer data without approval. Recordings audio backup, if
offered, requires separate consent and a separately approved storage allowance.

### Future premium experience

Plan and billing shows the current plan, capabilities, usage, renewal/end date and
Manage subscription. Checkout and payment details use a hosted billing provider,
not WISP forms storing card data. Possible paid benefits are larger hosted mix
allowances, larger backup retention/storage and additional cloud conveniences.
These are candidates, not approved paid restrictions or price promises.

Plan comparison explains exact limits before purchase. Cancellation, payment
failure and an expired plan show what changes and when. Provide a retrieval/export
window for cloud data according to an approved retention policy. No silent data
deletion on downgrade. Existing local features remain usable, and private source
hosting is not a prerequisite for introducing account architecture.

## Current foundation and proposed architecture

The inspected application uses React/TypeScript, a Photino/WebView2 desktop shell,
an ASP.NET Core 10 local API and EF Core SQLite. Recording sessions, plan snapshots,
performed tracklists, review feedback and local export records already exist.
There is no WISP account authentication configured in the inspected desktop API.

Keep local and cloud trust boundaries separate:

```text
WISP React interface
    |
    v
Native desktop host and local API ---- local SQLite and local audio
    |
    +---- system browser ---- managed identity provider
    |                          returns a protected native session
    |
    +---- HTTPS WISP cloud API ---- PostgreSQL for cloud records
                         |
                         +---- private media storage and background workers
                         +---- billing provider and restricted moderation tools
```

The proposed identity provider is Microsoft Entra External ID in a customer
external tenant, using MSAL .NET in the native host. Microsoft documents external
tenant desktop sign-in support in its
[desktop quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-desktop-app-sign-in).
Confirm the exact SDK, user flow and Photino callback on a development tenant
before committing to production. Use an identity-provider interface so a change
does not rewrite library or community models.

Use system-browser OAuth/OIDC authorisation code with PKCE, the proof that binds
the callback to the login request, following
[RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252). Do not collect provider
passwords in the embedded WebView or embed a client secret in the executable.
Validate the SDK-supported redirect, state/nonce handling and cancellation.

Native tokens belong in an OS-protected token cache, not SQLite, config JSON,
JavaScript state, browser localStorage or logs. The React UI receives a safe
account/status DTO, not refresh/access tokens. The native host attaches an access
token for the cloud API audience; an identity token is not an API access token.
The cloud API validates issuer, audience, signature, expiry and permissions.

Proposed Azure services are a separate cloud API on Container Apps or App Service,
Azure Database for PostgreSQL, private Blob Storage for user media/backups and
Key Vault for server secrets. Choose hosting after a small development proof and
cost/credit review. Azure documents
[managed identities for Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity)
and [Blob security recommendations](https://learn.microsoft.com/en-us/azure/storage/blobs/security-recommendations);
use least-privilege service access rather than desktop storage/database keys.

Public installer storage from the private-repository plan is a different purpose
and container/security boundary from private user audio. Never make the user
media container public simply because release installers are public.

### Intended code boundaries

These are proposed implementation locations, not projects added by this plan.
Confirm names during Phase 1; preserve the separation even if names change.

| Area | Intended location and change |
| --- | --- |
| Account state and policies | Wisp.Core account/capability contracts without provider or network dependencies |
| Native authentication and cloud client | Wisp.Infrastructure provider adapter, protected token cache and bounded HTTPS calls |
| Desktop coordination | Wisp.Api account/status endpoints and native login coordination; never publicly deploy its file/USB endpoints |
| Desktop presentation | Wisp.Client account settings, Community subpages and recording publish/review integration |
| Cloud transport contracts | Small versioned DTO assembly/schema; no local database entities, token types or music paths |
| Cloud API | Separate proposed Wisp.Cloud.Api with API authentication, ownership, capability and moderation checks |
| Cloud persistence | Separate PostgreSQL context/migrations; do not add cloud tables to the local SQLite context or reuse its migrations |
| Media and durable jobs | Separate proposed Wisp.Cloud.Worker with restricted processing, retries and cleanup |
| Shared public views | Approved web routes/components for public profiles, mixes and threads; no desktop native bridge in public pages |
| Infrastructure and deployment | Reviewed Azure definitions and explicit environment workflows; no production deployment on arbitrary development pushes |

Cloud API schemas must tolerate an older installed desktop client. Keep native
sign-in, account lifecycle and cloud session handling separate from public web
session handling. Any browser account area needs its own reviewed authentication
flow; it must not receive the desktop's protected token cache.

## Identity and data ownership

| Record or boundary | Intended responsibility |
| --- | --- |
| Local TrackId and recording/plan IDs | Preserve existing local identities; signing in does not regenerate them |
| WispUserId | Stable server-generated UUID for the cloud user |
| AuthIdentity | Unique trusted provider issuer plus subject linked to WispUserId; email is not the identity key |
| InstallationId and device record | Random installation association and user-visible device label; not proof of identity or authority |
| Local workspace cloud binding | Explicit account/workspace association for backup/publishing queues; not automatic ownership of the whole library |
| Profile and preferences | Private account settings plus separately approved public profile fields |
| MixPost and published tracklist | Cloud copy of explicitly selected fields, independent of the local recording/blueprint |
| MixRevision and media assets | Immutable audio revision, processing state, owner, size, duration and controlled storage reference |
| Comment, thread and social records | Author IDs, version checks, report/block state and moderation visibility |
| Entitlement and subscription records | Server-owned capability/limit decisions and billing-provider mapping |
| Backup and sync records | Selected portable data, revision/cursor history, deletions and restore manifests |

Do not infer ownership from a supplied user ID, local track ID, email or object
storage path. Resolve the authenticated user on the server for every write and
private read. Use ownership checks, uniqueness constraints, foreign keys,
pagination, bounded payloads and optimistic concurrency. Clients may suggest
idempotency IDs, but the server checks their owner, scope and request content.

The local workspace stays independent of the signed-in account. Account switching
requires an explicit choice before binding it to new cloud operations. Cancel or
quarantine the previous user's pending operations; clear account-scoped caches.
Never replay queued publishing, billing or backup work under a different identity.
This is not a multi-user privacy sandbox for people sharing one Windows profile;
separate local-profile isolation would be additional scope.

Email changes preserve WispUserId. Adding another login method requires an
authenticated linking flow and reauthentication; matching emails never silently
merge accounts. A deleted account must not reappear with its old permissions
because a desktop retains an old token or queued job.

## Phase sequence

Each phase should normally be a bounded PR or a small group of PRs into develop.
Dependencies below are delivery gates, not promised dates. Earlier phases remain
valuable even if community hosting or subscriptions are postponed.

| Phase | Delivered increment | Depends on |
| --- | --- | --- |
| 1 | Local account interfaces and protected guest behaviour | None |
| 2 | Development cloud API, identity and database foundation | 1 and infrastructure approval |
| 3 | Optional desktop sign in and account linking | 2 |
| 4 | Complete profile, privacy and account lifecycle | 3 |
| 5 | Mix sharing with external links and timestamp feedback | 4 and public-community approval |
| 6 | Discussion boards, follows, notifications and moderation tools | 5 |
| 7 | Hosted mix uploads, waveform playback and media operations | 5, 6 and hosting/rights approval |
| 8 | Optional cloud backup and controlled multi-device synchronisation | 4; integration checks against 5 to 7 |
| 9 | Paid plans, billing and enforced entitlements | 4 and approved valuable cloud features/pricing |
| 10 | Cross-feature polish, operational readiness and final release | All approved final-product phases |

Phases 8 and 9 can remain deferred while a free account/community release runs.
They remain part of the envisioned finished feature. If a phase is removed from
scope, record that decision here instead of marking it complete.

## Phase 1 Local groundwork

Purpose: add safe seams for later accounts without requiring an identity provider,
database server, login screen, subscription or network access.

Implementation checklist:

- [ ] Define account/session states, a safe UI status contract and native account,
  cloud-client, protected-token-store and entitlement interfaces.
- [ ] Supply a Guest/no-cloud implementation and explicit disabled-by-default
  cloud feature configuration. Missing configuration must fail safely to Guest.
- [ ] Separate account UI state from local library, playback, recording and
  Soulseek settings. Do not reuse Soulseek credentials for WISP authentication.
- [ ] Define installation identity and future workspace association semantics
  without claiming existing library records for a cloud user.
- [ ] Add Settings entry/status only where useful; do not ship inert login or
  premium buttons or a fake signed-in state.
- [ ] Audit loopback binding, Host/Origin checks and protection of local commands
  from untrusted websites. CORS alone is not local API authentication. Keep the
  future cloud API separate; do not require cloud login on all local endpoints.
- [ ] Record intended package boundaries, contract versioning, threat model and
  environment configuration. Proposed cloud project names are not created yet.

Acceptance checklist:

- [ ] Isolated-profile tests prove startup, local browsing, playback, recording,
  cues, analysis and export entry points work with cloud disabled and offline.
- [ ] Existing IDs/data remain unchanged; migrations, if any, are additive and
  tested against a fixture, never the owner's working library.
- [ ] No cloud credentials, token cache, music or personal database enter Git.
- [ ] Document the delivered interfaces and remaining absence of real accounts
  in WISP_IMPLEMENTATION_STATUS.md.

Exit: a normal user sees no loss of existing behaviour. Later account code can
be added without making the local application depend on a cloud service.

## Phase 2 Cloud identity and service foundation

Purpose: build and test a minimal protected cloud service before wiring desktop
login into production.

Implementation checklist:

- [ ] Confirm Azure subscription credit eligibility, allowed resources, region,
  budget alerts and expected compute/database/storage/egress costs with the owner.
  Credits are not proof every service or third-party bill is covered; budget
  alerts are not a guaranteed spending cap.
- [ ] Approve development infrastructure separately. Use WISP-specific resources
  and least-privilege identities; do not modify Pulse/Physiqo application resources.
- [ ] Create reviewed infrastructure-as-code with separate dev/staging/production
  configuration and data boundaries. Keep secrets out of source and CI logs.
- [ ] Prove Entra External ID customer sign-up/sign-in, verified identity claims,
  API access-token audience/scopes and native redirect compatibility on a dev tenant.
- [ ] Add a separate cloud API and PostgreSQL migrations for users, auth identities,
  private profiles, account state and audited creation/deletion lifecycle.
- [ ] Implement minimal protected account endpoints such as current user and
  retry-safe first-sign-in provisioning. Resolve identity from validated tokens.
- [ ] Handle parallel first sign-ins without duplicate users and define disabled,
  deleting and deleted-account behaviour independently of provider token validity.
- [ ] Add readiness/health checks, structured redacted logs, request IDs, bounded
  requests, rate limits, secret rotation and database connection limits.
- [ ] Establish backup/restore, migration rollback and a minimum service runbook
  before any production account data is stored.

Acceptance checklist:

- [ ] Invalid/expired/wrong-audience/wrong-issuer tokens fail; anonymous private
  reads fail; users cannot read or change another user's private records.
- [ ] Email changes and repeated callbacks preserve the same WispUserId.
- [ ] A development restore and migration failure exercise succeeds with synthetic
  data. No production tenant/data is used for automated tests.
- [ ] Owner reviews resource scope/costs and identity-provider limitations before
  approving production provisioning.

Exit: synthetic users can securely call the development cloud service. Desktop
users still use Guest until Phase 3 is delivered and enabled.

## Phase 3 Optional desktop accounts

Purpose: deliver the first real end-to-end user feature: sign in without disturbing
an existing local WISP workspace.

Implementation checklist:

- [ ] Integrate maintained native MSAL/token-cache support; prove protected cache
  persistence and fail safely if the secure store is unavailable.
- [ ] Implement system-browser sign-up/sign-in and supported callbacks with PKCE,
  SDK state/nonce safeguards, cancellation, timeout and single active login flow.
- [ ] Add Account settings and compact navigation status with Guest, Connecting,
  Signed in, Offline and Sign in again states; preserve route and unsaved work.
- [ ] Call the cloud current-user/provisioning endpoint after successful sign-in;
  display the cloud profile, not an unverified client-supplied identity.
- [ ] Refresh sessions safely and recover from provider/service/network failures.
  Do not repeatedly open browsers or block local startup while offline.
- [ ] Sign out clears protected local tokens and account-scoped caches and stops
  queued cloud actions. Explain that provider browser login may remain separate.
- [ ] Handle account switching and workspace binding explicitly. Login alone
  never uploads local data or changes the workspace's ownership assumptions.
- [ ] Provide actionable recovery/help for cancelled verification, unavailable
  browser/callback, expired sessions and a cloud account disabled by staff.

Acceptance checklist:

- [ ] Manual Windows/Photino tests cover first signup, existing login, cancellation,
  restart, logout, token expiry, offline launch and two different test accounts.
- [ ] Fault-injection tests cover callback replay/mismatch, refresh failure,
  duplicate clicks and sign-out during an in-flight cloud request.
- [ ] React/debug logs/settings/database contain no tokens or provider passwords.
- [ ] Guest and signed-in local workflows have equal access to existing features;
  signing out preserves all local tracks, cues, playlists and recordings.

Exit: the user can link and unlink an optional WISP account. There is still no
automatic sync, public publishing, subscription or paid restriction.

## Phase 4 Profile privacy and account lifecycle

Purpose: make accounts supportable and safe before inviting public participation.

Implementation checklist:

- [ ] Implement private account details and opt-in public profiles: display name,
  unique handle, bounded avatar upload, bio, genres and validated external links.
- [ ] Add profile preview, visibility controls, safe editing, conflict handling,
  avatar processing and removal. Do not expose email through public/search DTOs.
- [ ] Support provider-managed recovery/security settings where available; confirm
  email-change and additional-provider linking without silent account merges.
- [ ] Add WISP installation/device listing and server-side device revocation.
  Explain its scope: WISP registration revocation is not guaranteed immediate
  revocation of every identity-provider session/access token.
- [ ] Add privacy, notification preferences, policy versions and consent records.
  Optional product analytics must not depend on uploading private library data.
- [ ] Implement machine-readable cloud data export and deletion workflow with
  recent reauthentication, progress, retries and documented retention exceptions.
  Deleting the cloud account keeps local files/data by default and stops queues.
- [ ] Coordinate provider identity removal, WISP account disablement and eventual
  cloud deletion so stale credentials cannot resurrect a deleted account.
- [ ] Introduce server capability/usage contracts with all current local features
  unchanged. Model limits separately from subscription state; no billing yet.
- [ ] Add policy/support destinations and assign operational responsibility for
  account issues, privacy requests and security incident escalation.

Acceptance checklist:

- [ ] Two-user tests cover handle conflicts, profile scraping/private-field leaks,
  blocked devices, account switching and stale-token access after account disablement.
- [ ] Export/deletion tests check blobs, derived media, backups, queues and public
  content against the approved retention policy as those phases are introduced.
- [ ] Owner approves profile/privacy wording and obtains appropriate legal review
  before a public launch; this checklist is not a compliance certification.

Exit: optional accounts have usable profiles, privacy controls and a tested exit
path, not just a login button.

## Phase 5 External mix sharing and feedback

Purpose: launch a useful community without taking on hosted audio immediately.

Implementation checklist:

- [ ] Add Community Explore, public profile/mix pages and My mixes with separate
  draft, published and failed states. Allow guest browsing of public content.
- [ ] Add Recording to Share mix flow with supported external links, title,
  artwork, description, genre, duration and actual timestamped tracklist.
- [ ] Create an explicit publication snapshot with preserved track versions and
  repeated-track occurrence IDs. Never publish the entire local database/plan JSON.
- [ ] Implement Draft/private, Unlisted and Public rules, comment controls,
  preview, publish/edit/unpublish/delete and owner-only private draft access.
- [ ] Exclude local paths, credentials, private ratings and review notes by default;
  show all outbound fields before confirmation. Validate every timestamp/duration.
- [ ] Support public comments/replies and timestamp/range feedback; show a clear
  fallback when the external player cannot seek or show a WISP waveform.
- [ ] Add search, bounded pagination and genre/date/duration filters. No automatic
  playback, misleading provider controls or auto-download of linked audio.
- [ ] Allow only approved link/embed schemes/providers, sanitise content and prevent
  unsafe server URL fetching, stored XSS and private-network metadata requests.
- [ ] Ship report, block, spam/rate limits, suspension and a minimum staff review
  process at the same time as public posting. Define blocked-user visibility rules.
- [ ] Publish community rules, supported-provider limitations, moderation contacts
  and a rights/takedown process after owner/legal review.

Acceptance checklist:

- [ ] Test guest/private/unlisted/public access, publication retries, conflicts,
  ownership changes attempted by clients and author deletion/unpublish.
- [ ] Test invalid links/markup/timestamps, missing external audio, hostile content,
  blocked users and moderator removal. No private fields appear in HTML/API/search.
- [ ] Owner approves the public-community release and staffing before enablement.

Exit: a user can share a mix link and performed tracklist and receive feedback.
WISP is not yet hosting the audio or promising third-party playback availability.

## Phase 6 Discussions social features and moderation

Purpose: turn a mix gallery into a coherent community with operational safeguards.

Implementation checklist:

- [ ] Implement discussion categories, threads, replies, safe formatting, paging,
  search, edit history and deletion/tombstones with owner/moderator permissions.
- [ ] Add follows, Following feed, likes and Saved/bookmarks. Personal satisfaction
  ratings remain separate and private; avoid exposing private activity histories.
- [ ] Add in-app notifications for approved follows, replies and mentions, with
  read/unread state, batching/deduplication and per-category preferences.
- [ ] Offer opt-in email notification delivery only after provider/domain/cost
  approval, with unsubscribe controls and no marketing opt-in hidden in signup.
- [ ] Complete the restricted moderation console: report queues, content actions,
  temporary/permanent suspension, reasons, appeals and audited staff access.
- [ ] Define notification/content behaviour after blocks, removal, account deletion
  and moderator actions; suppress abusive mentions and repeated notifications.
- [ ] Add server role management, staff reauthentication and provider-supported
  strong authentication for moderation. Never trust client role declarations.
- [ ] Add spam/flood controls, configurable posting limits and escalation tools;
  verify safeguards cannot be bypassed through raw API calls.

Acceptance checklist:

- [ ] Test nested/repeated replies, concurrent edits, duplicate reactions/follows,
  cursor pagination, notification retries and account switching without leakage.
- [ ] Run a moderator exercise with synthetic spam, an appeal and account removal;
  document responsibilities and response targets rather than promising 24/7 support.
- [ ] Verify keyboard/mobile layouts and a clean guest read-only experience.

Exit: discussions and social interaction work without making moderation or
notification delivery an uncontrolled manual burden.

## Phase 7 Hosted mix audio and playback

Purpose: add WISP-hosted recordings only after rights, safety, storage and bandwidth
requirements have been explicitly accepted.

Implementation checklist:

- [ ] Owner approves hosting territories/policies, content rights requirements,
  takedown handling, storage/egress budget and size/duration/account quotas.
  Owning an audio file or checking a rights box is not proof all hosting rights exist.
- [ ] Add quota-reserved upload sessions with server-assigned object paths,
  short-lived narrowly scoped upload access, checksums, resumable progress,
  cancellation and orphan/failed-upload cleanup. Never expose storage account keys.
- [ ] Keep uploads private/quarantined until validation and processing complete.
  Enforce limits on received bytes, media type, actual duration and decoded output.
- [ ] Process untrusted media in a restricted worker with bounded CPU/memory/disk,
  timeouts and updated decoders. Avoid untrusted media work in the local desktop
  API or the public request process. Add queue retries, dead-letter handling and
  idempotent processing without duplicate storage charges.
- [ ] Generate playback derivatives, true waveform peaks and metadata from the
  uploaded audio. Preserve the source/master; label lossy formats honestly.
- [ ] Add hosted mix transport, seek/zoom waveform, timestamp/range feedback,
  tracklist seeking and controlled continuous playback with accessible controls.
- [ ] Enforce private/unlisted/public access for media and metadata consistently,
  including byte-range requests, temporary playback URLs and download permissions.
  Define signed-URL expiry and cache behaviour when visibility changes.
- [ ] Add audio revision semantics, processing/error states and explicit handling
  of old timestamp feedback when audio is replaced or removed.
- [ ] Show storage use, upload history, remaining allowance and safe delete/remove
  actions. Default downloads off; only enable when rights/policy permit.
- [ ] Integrate moderation removal across audio, derivatives, waveforms, artwork,
  search and caches. Test effective access withdrawal rather than only hiding UI.

Acceptance checklist:

- [ ] Test large/interrupted uploads, wrong checksums, malformed/oversized media,
  decoder timeout, quota races, malicious object paths and a failed worker restart.
- [ ] Test long-mix browser playback, seeking/ranges, waveform alignment, timestamp
  links, hidden downloads and private media access across two accounts and Guest.
- [ ] Measure actual costs and processing capacity in staging; demonstrate deletion,
  orphan cleanup, restore and takedown with synthetic or cleared test audio.

Exit: hosted mixes can be safely uploaded, streamed, reviewed and removed. This
phase is not a licence to host copyrighted material or a live-streaming feature.

## Phase 8 Optional backup and multi device preparation

Purpose: use accounts for private continuity as well as public sharing.

Implementation checklist:

- [ ] Define opt-in backup categories: selected track metadata/cues, playlists,
  mix plans, recording metadata, actual tracklists and private review notes.
  Explain whether file-identification data is included and why; exclude audio,
  credentials, local paths/device settings and caches from the default payload.
- [ ] Add portable versioned manifests and per-workspace binding, encrypted transport
  and protected storage. Do not describe service-readable encrypted-at-rest data
  as end-to-end encrypted; assess client-held-key tradeoffs before promising that.
- [ ] Deliver manual backup and previewed restore first, with retention/history,
  checksums, storage usage and an additive restore into an isolated workspace.
- [ ] Match restored references to local files without assuming paths are portable;
  show unresolved tracks, preserve cue IDs and never delete source music.
- [ ] Add incremental opt-in sync using stable IDs, revision tokens, tombstones,
  account-scoped durable queues and conflict detection, not whole-database merging.
- [ ] Show local/cloud changes and resolve same-field conflicts explicitly. Preserve
  recording history and distinguish blueprint changes from actual tracklists.
- [ ] Support reconnect, retry and device replacement; paused or expired cloud
  sessions keep local edits. Account switching cancels/quarantines old queues.
- [ ] Implement selective restore, export, backup deletion and account-deletion
  handling. Cloud deletion cannot silently mean deleting a local music file.
- [ ] Evaluate optional recording-audio backup separately, with explicit consent,
  rights review, storage limits and no automatic upload of the music collection.

Acceptance checklist:

- [ ] Test two installations, concurrent offline edits, deletions, old manifests,
  duplicate occurrences, missing files and interrupted migrations/restores.
- [ ] Demonstrate recovery without altering the owner's real database or files.
- [ ] Verify private reviews/backup objects cannot be exposed through public profile,
  search, mix sharing or another user's account after switching.

Exit: accounts can preserve selected preparation data and safely synchronise it
across devices, while local music and offline work stay under the user's control.

## Phase 9 Premium plans billing and entitlements

Purpose: monetise approved connected benefits without retroactively breaking
guest use or treating a subscription flag in the executable as enforcement.

Implementation checklist:

- [ ] Owner approves free/paid capabilities, quotas, pricing, billing currency,
  cancellation/refund policy, taxes and supported regions with appropriate advice.
  No existing local feature becomes paid without a separate explicit decision.
- [ ] Select a billing provider after cost/credit review; Stripe hosted checkout
  and customer portal are proposals, not approved infrastructure or guaranteed
  Azure-credit expenditure.
- [ ] Add server-owned subscription mapping and capability grants with effective
  dates, limits, usage and auditable policy versions. Keep billing secrets server-side.
- [ ] Implement authenticated checkout/portal session creation, protected return
  links and native app reconciliation. A checkout success page is not proof of payment.
- [ ] Verify webhook signatures and persist/deduplicate event processing; handle
  retries, out-of-order events and provider reconciliation before granting/revoking
  capabilities. Follow the provider's [webhook guidance](https://docs.stripe.com/webhooks)
  and [subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
  if Stripe is selected.
- [ ] Enforce cloud quotas/features on the server, including concurrent uploads and
  direct API calls. Present the same capability decisions in the desktop UI.
- [ ] Model trial, active, past due, grace, cancel-at-period-end, expired/refunded
  and suspended states. Define grace/retention behaviour rather than guessing from
  a paid/not-paid boolean; separate safety suspension from billing status.
- [ ] If a new paid offline desktop feature is approved, define signed entitlement
  cache, expiry/grace, clock-change/replay handling and revocation limits. No claim
  of unbreakable desktop licensing; never block existing guest/local features.
- [ ] Add Plan and billing with exact usage/limits, upgrade/manage/cancel actions,
  renewal/end dates, receipts/provider links and accessible downgrade explanations.
- [ ] Implement downgrade over-quota behaviour, export/retrieval windows and explicit
  notices before any approved retention cleanup; no immediate destructive deletion.

Acceptance checklist:

- [ ] Sandbox tests cover success, abandoned checkout, failed renewal, retry,
  cancellation, refund, disputed payment, duplicate/out-of-order webhooks and outage.
- [ ] Test tampered client entitlements, cross-account billing IDs, quota races and
  offline/cache expiry; local libraries/recordings/cues remain accessible throughout.
- [ ] Reconcile a synthetic billing ledger against provider state and approve the
  support/refund runbook before accepting real payments.

Exit: a user can subscribe to approved benefits and manage the subscription with
predictable limits and no loss of existing local preparation functionality.

## Phase 10 Final integrations polish and release

Purpose: finish the connected product as a coherent WISP experience rather than
leaving a collection of separate account/community screens.

Implementation checklist:

- [ ] Complete cross-feature journeys: record, review, share actual tracklist,
  receive feedback, save selected feedback locally and explicitly create a revised
  Mix Plan without rewriting the source recording or public history.
- [ ] Offer Create plan from a public tracklist with reviewable local track matches,
  duplicate occurrences and missing-track handling. Adding missing tracks to Wanted
  is explicit; no automatic Soulseek download or redistribution of individual songs.
- [ ] Add permanent share links and approved web profile/mix/thread pages so a guest
  can view shared content on a phone without installing WISP. Keep account web
  authentication separate from native tokens, with secure session/CSRF handling.
- [ ] Preserve public-link redirects/handle changes, metadata previews and removed
  content states without exposing private drafts or cached private audio.
- [ ] Polish responsive layouts, keyboard/focus behaviour, tooltips, icons, reduced
  motion, contrast, long titles/versions and all empty/loading/offline/error states.
- [ ] Prevent competing local/community playback; preserve current recording capture
  across navigation and never interrupt it with login, uploads or cloud errors.
- [ ] Add API/client version compatibility, minimum-supported cloud versions and
  safe feature rollout/disable switches. Disabling cloud features leaves Guest intact.
- [ ] Exercise restore, security incident, identity outage, worker failure, moderation
  escalation and billing reconciliation runbooks; verify monitoring and budget alerts.
- [ ] Complete independent security/privacy review, accessibility checks and staged
  load/cost measurements. Resolve launch-blocking findings before wider enablement.
- [ ] Update help, account/community terms, implementation status and release notes
  with exact implemented features and verified limitations, not roadmap promises.
- [ ] Obtain owner approval for beta/production enablement and promotion via a
  develop to main PR. Packaging/installers remain production-pipeline work only.

Acceptance checklist:

- [ ] Walk through final guest, signed-in free, paid, offline, blocked, expired and
  account-deletion journeys using isolated test accounts/workspaces.
- [ ] Confirm ordinary local DJ workflows remain usable without cloud access,
  regardless of subscription or community availability.
- [ ] Confirm support/moderation ownership, data retention, budgets, rollback and
  incident contacts are documented and operational rather than just UI checkboxes.
- [ ] Mark each approved preceding phase complete only with recorded test evidence
  and owner acceptance; document any deferred item without calling it implemented.

Exit: all approved final-product features work together, with supportable cloud
operations and unchanged local-first behaviour. Production release remains an
owner decision, not an automatic consequence of finishing a feature PR.

## Verification required throughout delivery

For every phase:

- [ ] Update this plan's checklist and WISP_IMPLEMENTATION_STATUS.md with code,
  tested evidence, manual acceptance and unresolved limitations as separate facts.
- [ ] Add unit and integration tests for the new contracts, ownership checks,
  concurrency, cancellation, retry and negative/error cases in that phase.
- [ ] Add client/browser checks for relevant settings, routes, confirmations,
  accessibility and account transitions. Never hit production billing/auth/media
  in automated tests; use test doubles plus bounded staging acceptance exercises.
- [ ] Use isolated WISP_DATA_DIR profiles and synthetic/cleared media. No real music,
  credentials, databases, token stores, recovery backups or generated artifacts in Git.
- [ ] Run proportionate dotnet test and client test/lint/build checks; do not run
  root npm run build, dotnet publish or installer builds for routine feature work.
- [ ] Keep secrets out of exceptions, analytics and HTTP logging. Public content
  DTOs must be reviewed independently from private account/backup DTOs.
- [ ] Check cloud request cancellation and CPU/disk contention cannot break active
  local playback/capture. Keep large operations bounded and off the UI thread.
- [ ] Use a codex feature branch from current origin/develop and a PR into develop;
  do not directly push integration/production branches or merge without approval.

This roadmap does not add CDJ hardware compatibility claims. Existing USB behaviour
is a regression concern; compatibility evidence remains the documented hardware
tests, not successful cloud or account test runs.

## Decisions and release gates

| Decision | Proposed direction | Must be resolved before |
| --- | --- | --- |
| Account provider | Entra External ID customer tenant with native MSAL proof | Phase 2 provider setup |
| Initial login methods | Verified email flow first; optional social methods only after provider support/configuration checks | Phase 3 public account enablement |
| Azure hosting and region | Separate WISP API, PostgreSQL and private storage; exact SKUs after cost/credit review | Any billable provisioning |
| Public profile default | Private account, explicit public-profile opt-in | Phase 4 acceptance |
| Community participation and moderation | Guest public browse, accounts for writes, staffed report/block handling | Phase 5 public posting |
| Hosted audio rights and territories | External links first; professional policy review before WISP-hosted audio | Phase 7 enablement |
| Backup scope and encryption model | Metadata-first opt-in; no automatic music upload or end-to-end encryption claim | Phase 8 enablement |
| Paid benefits and offline grace | New approved cloud benefits first; existing local features unaffected | Phase 9 implementation |
| Billing provider and pricing | Hosted provider checkout; Stripe provisional; third-party charges separately reviewed | Phase 9 live payments |
| Retention and account deletion | Explicit lifecycle for public posts, user audio, backups, billing/audit exceptions | Relevant phase storing that data |
| Public URLs and domains | Use approved WISP domains/routes; avoid assuming unrelated domain/resource changes are authorised | Public web/community deployment |
| Repository privacy and Azure installer downloads | Follow the separate private-release plan; not coupled to login rollout | Any repository/distribution cutover |

## Scope boundaries and future proposals

The finished scope above includes accounts, profiles, mix sharing/review,
discussions/social features, hosted mixes, optional metadata backup/sync and
approved premium benefits. It deliberately excludes automatic audio acquisition,
sharing individual purchased library tracks, live streaming, direct messages,
social-login methods unsupported by the chosen provider, mobile native apps,
automatic track recognition and a general collaborative DAW.

Those can be separate future proposals. Do not add placeholder integrations or
mark this plan incomplete because it intentionally excludes unrelated products.

No phase has a guaranteed date or blanket accuracy/security/compliance promise.
Phase 1 is the recommended next implementation slice: interfaces, Guest behaviour,
configuration and tests only. Stop at each paid/public release gate for the owner's
decision, while continuing safe approved work within the active phase.
