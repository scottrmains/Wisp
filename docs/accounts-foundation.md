# WISP local account foundation

Phase 1 adds interfaces for optional accounts while keeping the existing desktop
application usable as Guest. It does not implement sign-in, provision Azure,
introduce subscriptions or change the library database. This guide records the
implemented boundaries and the checks required before later phases replace the
disabled adapters. See the [full roadmap](../WISP_ACCOUNTS_COMMUNITY_IMPLEMENTATION_PLAN.md).

## Implemented code boundaries

| Location | Responsibility |
| --- | --- |
| `Wisp.Core/Accounts` | Provider-independent session, profile, capability, installation and future workspace-binding contracts |
| `Wisp.Infrastructure/Accounts` | Guest session, no-cloud client, local capabilities, unavailable token storage and lazy installation identity |
| `Wisp.Api/Accounts` | Dependency registration and read-only, versioned account status |
| `Wisp.Api/DesktopRequestSecurity.cs` | Loopback configuration and checks against requests from unrelated websites |
| `Wisp.Client/features/settings/AccountSettings.tsx` | Guest status, loading, safe retry and incompatible-version feedback within existing Settings |

The future cloud API, PostgreSQL context and worker remain separate proposed
projects; none have been created. Do not deploy the desktop API publicly: its
endpoints access local audio, files, USB drives and settings. Local capabilities
are descriptive in this phase; existing workflows are not routed through a new
entitlement gate.

## Session and status contract

`IAccountSessionService` defines Guest, Connecting, SignedIn, Offline and
SignInRequired states. Only Guest is implemented. Sign-in fails with a safe
`CloudUnavailableException`; signing out of Guest is a no-op. The no-cloud client
does not construct an HTTP client or call an identity provider. Soulseek and
catalog credentials remain independent and are not used as WISP credentials.

`GET /api/account/status` returns contract version 1 with `Cache-Control: no-store`.
The default response is:

```json
{
  "contractVersion": 1,
  "state": "Guest",
  "displayName": "Guest",
  "canSignIn": false,
  "cloudAvailable": false,
  "cloudState": "Disabled",
  "localCapabilities": [
    "Library", "Playback", "Recording", "Cues", "Analysis",
    "Playlists", "MixPlans", "CdjExport", "Downloads", "Cleanup"
  ],
  "user": null
}
```

The DTO excludes tokens, installation IDs, provider configuration, music paths
and billing details. There are no login, token, workspace-binding or premium
routes. Account settings fetches status only when selected, passes cancellation
to its request and caches the result briefly. Failed reads cannot block local
tools or discard other Settings drafts. An unsupported contract or session state
shows an update message instead of inventing working sign-in controls.

## Cloud configuration

`appsettings.json` ships with `Wisp:Cloud:Enabled` false. Configuration belongs to
deployment settings, not the personal `config.json` catalog credentials. Future
deployment keys are:

| Configuration key | Environment variable | Meaning |
| --- | --- | --- |
| `Wisp:Cloud:Enabled` | `Wisp__Cloud__Enabled` | Explicit opt-in; absent or invalid boolean means disabled |
| `Wisp:Cloud:ApiBaseUrl` | `Wisp__Cloud__ApiBaseUrl` | Proposed cloud API HTTPS address |
| `Wisp:Cloud:Authority` | `Wisp__Cloud__Authority` | Proposed managed identity HTTPS authority |
| `Wisp:Cloud:ClientId` | `Wisp__Cloud__ClientId` | Proposed public native client registration ID, not a secret |

Enabled configuration reports MissingConfiguration if values are absent and
InvalidConfiguration for non-HTTPS endpoints, embedded credentials, queries or
fragments. Fully populated configuration reports NotImplemented. **Every case
still returns Guest with all existing local capabilities.** Configuration alone
cannot activate an adapter that does not exist. No telemetry or account network
request is added; existing explicitly configured discovery/catalog services are
outside this account configuration.

## Installation identity and local data

`IInstallationIdentityStore` generates a random GUID within the chosen local
profile. Creation is lazy: startup and status reads do not create it. A later
explicit account/device operation can request it. The separate
`account-installation.id` file is written atomically; simultaneous requests retain
one identity. A corrupt existing identity fails without silently replacing it.
The ID is not a machine fingerprint, account credential or proof of ownership.
The file and temporary siblings are ignored by Git.

`WorkspaceCloudBinding` defines only a future explicit workspace/user association.
It is neither persisted nor automatically applied to existing library records.
Track, cue, playlist and recording IDs retain their current meaning. There are no
new local database migrations. Fixtures verify that identity creation does not
rewrite database or settings files, and Guest cue/playlist operations retain
existing record IDs and data.

`IProtectedAccountTokenStore` is native-only opaque cache storage. Phase 1 uses an
unavailable adapter: reads, writes and clears reject rather than save plaintext
or falsely report protected storage. No token cache exists. Phase 3 must add and
test actual OS-protected storage before enabling native authentication. Never
expose this interface over HTTP, the Photino bridge or JavaScript storage.

## Local host protection and threat model

The desktop defaults to `http://127.0.0.1:5125`. Explicit HTTP loopback URLs are
supported; wildcard/LAN addresses, HTTPS URLs, ambiguous paths and zero ports are
rejected. Explicit `Kestrel:Endpoints` configuration is rejected because it can
override URL binding; desktop consumers should use `--urls` or `ASPNETCORE_URLS`.
The host is not intended to be a general configurable web server. See Microsoft's
[Kestrel endpoint guidance](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel?view=aspnetcore-10.0).

Request checks run before local endpoints and static files. Host must name a
loopback address at a configured port, and actual remote connections must be
loopback. Supplied Origin headers must match trusted desktop origins. Requests
without Origin are checked using Fetch Metadata and Referer when supplied.
Development also trusts loopback Vite at port 5173 and the validated local SPA
URL; production does not trust the development port by default. The Vite proxy
rewrites Host to the API destination. Development CORS remains narrow and is not
treated as authentication.

Unsafe `/api` methods additionally require `X-Wisp-Client: desktop-v1`. All
shared client commands and custom playlist, mix-plan and loudness fetch helpers
include this non-secret marker. GET/HEAD media reads and range requests do not
need it. Direct local command scripts must also include it. The header works
alongside origin checks to prevent simple cross-site browser submissions; it is
**not** an access token or local-process authentication. See the
[MDN CSRF guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF)
and [Fetch Metadata reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site).

| Threat | Implemented boundary | Remaining limit |
| --- | --- | --- |
| Unrelated website submits a local command | Trusted Origin/Fetch Metadata/Referer checks and required command marker | Native processes can forge browser headers |
| DNS rebinding or accidental public binding | Loopback binding, Host/port checks, remote-IP check and rejection of Kestrel override | Does not defend a compromised OS or trusted loopback service |
| Account secrets leak into UI or files | Safe DTO, no token routes, unavailable token store and no active provider | Future adapters require separate security review |
| Cloud outage blocks local work | Guest adapters have no cloud network dependency; local workflows remain independent | Existing catalog services still depend on their own external providers |
| Login silently claims/uploads library data | No login, binding writes, ownership migrations or upload routes | Later phases must preserve explicit consent and account isolation |

These protections do not sandbox malware, prevent XSS in trusted WISP content,
authenticate native callers or remove all existing local API privacy risk. They
do not replace server-side cloud access-token validation. A future system-browser
OAuth callback requires a separately reviewed SDK-supported temporary loopback
listener; it must not weaken this file/USB API's origin checks. An embedded remote
website must never receive the desktop native bridge.

## Verification and remaining gates

Verified on 2026-10-03 with isolated profiles and synthetic/mock data:

- Full backend suite: 613 passing tests, using the pinned FFmpeg 8.0.1 dependency.
- Client: 82 passing tests; lint has no errors and 12 existing warnings;
  TypeScript/Vite build succeeds with the existing bundle-size warning.
- Full Chromium browser suite: 161 passing tests, including keyboard-accessible
  Account settings, safe retry, draft retention, unsupported status and continued
  playback/capture while viewing Account settings.
- Actual compiled desktop host, with Photino disabled and an isolated new profile:
  loopback-only listener, fully configured-but-unimplemented cloud remaining
  Guest, playlist create/browse, rejection of foreign Origin and unmarked commands,
  and no unsolicited installation identity file.
- The real HTTP/browser warmed-cache upgrade check passes with the protected
  host: current UI loads through the release-key URL and preferences are retained.
- Guarded isolated API fixtures exercise local library dates, audio streaming and
  seeking, rename recovery/downloads, cues, playlist membership, analysis,
  synthetic capture/review/exports and USB device/export entry points. The full
  existing suite also retains local export format regression coverage.

No installer was built, real account was created or Azure resource was provisioned.
No working personal database, credentials, music or USB was modified. Browser
capture uses mock state and backend recording tests use synthetic sources; this
is not a new physical-mixer or CDJ hardware verification. The new Settings view
was visually inspected in Chromium; a new manual native Photino check remains
appropriate when reviewing the PR.

Phase 2 still needs owner approval for development infrastructure and a provider
proof. Before mapping desktop and website identities, prove the same WISP user is
resolved from each validated API token: provider subjects can differ by client
registration. Entra's tenant/object identity may be appropriate within the same
trusted tenant; never join accounts by email or an unvalidated claim. Confirm
this in the provider proof using Microsoft's
[ID-token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference).
Actual login belongs to Phase 3; community, backup and billing remain later work.
