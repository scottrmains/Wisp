# WISP marketing prototype

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
CI validates this site independently; it does not deploy it.

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

## Downloads: implemented discovery, publishing still pending

The browser anonymously queries the latest stable public GitHub Release for
`scottrmains/Wisp`, with a six-second timeout. It accepts a Windows installer only
from that repository's HTTPS release-download path. Canonical
`Wisp-Setup-win-x64.exe` and a single versioned
`Wisp-Setup-<version>-win-x64.exe` are supported. Draft/prerelease/ambiguous assets
are not offered. Version text is inserted as text, never HTML.

No public release yet: show the Actions build page, with explicit sign-in guidance.
Rate limit/network/JSON error: show the Releases page and recovery instructions.
JavaScript disabled: the same build and release links remain usable.

**The installer pipeline has not been changed to publish GitHub Releases.** This
PR is the agreed design-first prototype. A following deployment/release phase
should publish only smoke-tested `main` installers, retain the previous good
release on failure, and verify the actual public download and checksum.

## Hosting follow-up

`dist` is ready for static hosting; `staticwebapp.config.json` defines security
headers, MIME types and conservative asset caching for Azure Static Web Apps.
No Azure resources, deployment identity, DNS records or domains have been created
or changed. After design approval, choose the temporary hostname and provision a
separate `rg-wisp-prod` in PulseLTV, with WISP-only deployment permissions.

Body/display fonts are self-hosted Latin subsets of DM Sans and Barlow Condensed.
Their SIL Open Font License files ship with the built site. Both font packages
and browser testing dependencies are pinned in the lockfile.

USB copy intentionally states only the documented user-confirmed CDJ-900
playback/overview-waveform/Memory Cue baseline, not universal CDJ compatibility.
Mobile screenshots are browser-emulated, not physical phone acceptance tests.
