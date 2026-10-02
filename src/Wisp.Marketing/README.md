# WISP marketing site

A separate, pre-rendered static site: warm paper, condensed display type, flat
purple, restrained hard edges and real WISP screenshots. No frontend framework,
runtime dependencies, tracking, cookies, external font requests or desktop-app
changes. Small progressive enhancements handle the latest-release download,
on-arrival reveals and four silent, user-controllable product demonstrations.

## Preview and verify

From this directory, with Node 22:

```powershell
npm ci
npm run build
npm run dev
```

Open `http://127.0.0.1:19600`. The server binds to loopback only and serves `dist`,
not the repository or your music. Stop it with Ctrl+C.

```powershell
npm test
npx playwright install chromium
npm run test:browser
```

Browser checks intercept GitHub API requests. No credentials or actual downloads
are involved. Screenshots/test traces go to ignored `artifacts` directories.
CI validates this site independently. PRs, develop pushes and manual runs never
publish installers or deploy the site; only a successful push to main can do so.

## Focused media and provenance

Eight WebP posters and four H.264 MP4 demonstrations are intentional site assets,
not test reports. They capture the actual redesigned client—not reconstructed
interface artwork. The workflow is Library → Crate Digger/Wanted → Mix Plans →
USB → Mix Review. Soulseek is optional background functionality, not a main pitch.

Posters are captured at 2x pixel density with lossless WebP compression. Wide,
rounded product stages show legible function-focused regions rather than tall
thumbnail-sized windows. Library and plan posters are landscape crops; the Wanted
crop retains track titles and waiting/found states without unrelated actions.

The owner approved public artist/title labels from their Garage / Old Skool House
playlist and the actual waveform of Robin S — Show Me Love (Tonka's 2002 Club Mix).
The capture uses a read-only SQLite connection for these selected tracks and reads
their active audio files. FFmpeg decodes audio in memory; the real WISP client
calculates its library waveform. The review example uses min/max peaks from the
same real song, **not a recording of a DJ mix**. Notes, sources, discovery results,
USB and dates are illustrative. No account, real file path, database, credentials,
or track audio is published. The script never starts the backend/native shell,
changes library/cue data, queries a provider or writes to a USB.

To refresh, first run `npm run build` in `../Wisp.Client`, then explicitly supply
an owner-approved library and an existing FFmpeg binary (Node 22.16+):

```powershell
npm run capture:app -- --library "C:/path/to/approved/wisp.db" --ffmpeg "C:/path/to/ffmpeg.exe"
```

The existing project `tools/get-ffmpeg.ps1` can provide FFmpeg when needed. Paths
can alternatively be supplied via `WISP_CAPTURE_LIBRARY_PATH` and
`WISP_FFMPEG_PATH`. There is no automatic private-library discovery or synthetic
waveform fallback. The capture launches an isolated client preview on port 19601
and always stops it. Intermediate PNGs/WebMs go to ignored `artifacts/marketing-capture`;
no intermediate audio file is written. Inspect posters **and decoded video frames**
before committing. Update HTML width/height attributes if capture sizes change.

`assets/capture-provenance.json` records the client Git tree, approved waveform,
dimensions, durations, SHA-256 and byte sizes. Build/tests verify all 12 assets,
reject an MP4 with an audio stream, and enforce a 2 MB individual / 3 MB total
media budget. Production deployment verifies the new WebP/MP4 MIME types too.
The existing Wispa SVG/fonts are retained.

The app currently omits a separately stored track version from some tracklist
titles. The capture explicitly combines title/version so the Tonka mix is correctly
identified; **this marketing PR does not fix that separate app defect**.

### Motion behaviour

Use the HTTP preview (`npm run build`, then `npm run dev`) rather than opening
index.html directly: browsers can block JavaScript module imports from file URLs,
leaving a valid static page but no fades or demo controls. Do not disable browser
security to work around this. The hosted site serves modules with the correct MIME.

- Hero and feature content have a one-time 650 ms opacity/16 px entrance, triggered
  inside the viewport rather than before the viewer reaches it. Reduced motion
  reveals pending content immediately and suppresses all entrance motion.
- A finished demonstration restores its lossless poster, keeping idle text sharp.

- Each demo loads near the viewport, plays once, never loops, and has accessible
  keyboard Play/Pause/Resume/Replay controls. Only one demo plays at a time.
- Leaving the viewport, hiding the tab or enabling reduced motion pauses playback.
  Reduced motion, Save-Data and slow connections retain posters until explicit play.
- Without JavaScript the complete page and posters remain usable. Failed media
  retains the poster with a working retry; blocked autoplay offers manual play.
- Layout and media tests cover 360–1920 px, 200% text, no-JS, reduced motion,
  data-saving, failed media, byte-range seeking and keyboard controls.

## Production release and deployment

The main-push workflow validates the app and site, builds the versioned installer,
smoke-tests fresh install/launch/upgrade/uninstall in an isolated runner profile,
and uploads the installer artifact. A separate contents-write job verifies its
checksum and uploads both files to a **draft** GitHub Release. GitHub's uploaded
asset digests/sizes must match before publishing. Existing published assets are
never overwritten; a retry can complete a matching partial draft. Obsolete main
runs cannot publish or deploy, and main runs are not cancelled mid-release.

The published installer is downloaded anonymously and hashed again before
building the production homepage. The build embeds its exact public URL/version
and emits `release.json` with commit, version, SHA-256 and asset URLs. Production
does not query GitHub from visitors' browsers: the download works without JS,
GitHub sign-in, API availability or an API rate-limit allowance.

The final job uses Azure OIDC (no permanent client secret/deployment token),
downloads this exact website artifact and deploys to the production slot. It
checks the actual Azure hostname, then verifies the live commit, manifest,
download link, assets, MIME types and security headers. Failed validation,
packaging, smoke tests, publication or public-download verification prevent
replacement of the existing site. A failed deployment/verification fails CI;
there is no claim of automatic rollback after an Azure upload succeeds.

Versioning remains `0.1.<GitHub workflow run number>`. Installers are unsigned;
the homepage/release notes disclose potential Windows SmartScreen warnings.
Code-signing was not part of the initial release. Custom-domain setup is
documented below.

### Hosting and identity bootstrap

- Subscription: PulseLTV (`fa9dfca3-f9c4-4859-a0c8-665c59380a3d`).
- Resource group: `rg-wisp-prod` (UK South).
- Static Web App: `wisp-web-prod` (West Europe, **Free** tier).
- Custom URL: https://wisp.physiqo.app (HTTPS verified 2026-10-02).
- Azure origin URL: https://zealous-smoke-0124a0503.4.azurestaticapps.net
- Managed identity: `id-wisp-github-production`, Contributor on this **single
  WISP site**, with no permissions on Pulse/Physiqo resources.
- Federation: `repo:scottrmains/Wisp:environment:production`, Azure audience.
- GitHub `production` environment permits the `main` branch only and contains
  two nonsecret variables: `AZURE_CLIENT_ID` and `WISP_SITE_URL`.

An authenticated owner can repeat the additive bootstrap with
`pwsh tools/setup-marketing-production.ps1` from the repository root. It verifies
the subscription/tenant, creates only WISP resources, does not select a paid SKU,
does not request a repository deployment token, and never changes DNS. Free
hosting has service limits and is not an SLA-backed hosting commitment.

The owner configured Porkbun DNS for `wisp.physiqo.app` as a CNAME pointing to
the Azure origin hostname. Azure manages its HTTPS certificate. This additive
binding does not change `physiqo.app` or its email records. Production deployment
verification continues using the original Azure hostname; do not replace the
`WISP_SITE_URL` environment variable with the custom URL without updating the
Azure-hostname validation in the deployment-readiness checker.

### Retry and recovery

Re-run **failed jobs** on the current successful-main push workflow. This keeps
the smoke-tested artifact/version and avoids rebuilding an already-published
installer with different bytes. Published-byte mismatches are an explicit hard
failure: never use `--clobber` or delete a public release to force the retry.
If the artifact expired, promote a new reviewed main commit for a new version.
An obsolete run must not be re-run to deploy an old site. Restore a previous site
through a reviewed revert/promotion producing a new release, not by bypassing
the main-tip guard. Check the public `/release.json` against the successful run.

## Local prototype download states

The browser anonymously queries the latest stable public GitHub Release for
`scottrmains/Wisp`, with a six-second timeout. It accepts a Windows installer only
from that repository's HTTPS release-download path. Canonical
`Wisp-Setup-win-x64.exe` and a single versioned
`Wisp-Setup-<version>-win-x64.exe` are supported. Draft/prerelease/ambiguous assets
are not offered. Version text is inserted as text, never HTML.

No public release yet: show the Actions build page, with explicit sign-in guidance.
Rate limit/network/JSON error: show the Releases page and recovery instructions.
JavaScript disabled: the same build and release links remain usable.

`dist` is ready for static hosting; `staticwebapp.config.json` defines security
headers, MIME types and conservative asset caching for Azure Static Web Apps.

Body/display fonts are self-hosted Latin subsets of DM Sans and Barlow Condensed.
Their SIL Open Font License files ship with the built site. Both font packages
and browser testing dependencies are pinned in the lockfile.

USB copy intentionally states only the documented user-confirmed CDJ-900
playback/overview-waveform/Memory Cue baseline, not universal CDJ compatibility.
Mobile screenshots are browser-emulated, not physical phone acceptance tests.
