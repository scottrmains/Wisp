# WISP marketing site

A separate, pre-rendered static site: warm paper, condensed display type, flat
purple, restrained hard edges and real WISP screenshots. No frontend framework,
runtime dependencies, tracking, cookies, external font requests or desktop-app
changes. JavaScript only enhances the latest-release download area.

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

## Screenshot provenance

The four PNGs under `assets/screenshots` are intentional site content, not test
reports. They show the real WISP client from the integration branch, with
fictional track names, paths, peers, recording peaks and other API responses.
The page identifies the collection as demo data. No user profile, audio or music
database is opened. The existing Wispa SVG is copied during the build.

To refresh them, first run `npm run build` in `../Wisp.Client`, then run
`npm run capture:app` here. The capture script launches its own isolated client
preview on port 19601, intercepts API requests, captures the real components and
stops that child server. It does not launch the WISP API or native desktop shell.
Review the resulting images before committing them.

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
Code-signing and custom-domain registration are not part of this release.

### Hosting and identity bootstrap

- Subscription: PulseLTV (`fa9dfca3-f9c4-4859-a0c8-665c59380a3d`).
- Resource group: `rg-wisp-prod` (UK South).
- Static Web App: `wisp-web-prod` (West Europe, **Free** tier).
- URL: https://zealous-smoke-0124a0503.4.azurestaticapps.net
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
