# Wisp

> Local-first DJ prep assistant. Turns a chaotic folder of analysed tracks into a smart, playable mix plan.

Reads BPM / Camelot key / energy from existing Mixed in Key tags — no audio analysis. Recommends compatible tracks, builds drag-and-drop mix chains, previews two-deck blends with crossfade and waveforms, manages cue points (manual + phrase markers from BPM), and cleans up dirty filenames / tags safely with full undo.

## Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind v4 + TanStack Query/Table/Virtual + Zustand + dnd-kit + Web Audio API
- **Backend**: ASP.NET Core 10 minimal API + EF Core 10 + SQLite + TagLibSharp + Serilog
- **Desktop shell**: Photino.NET (WebView2 on Windows). Single .NET process hosts both Kestrel and the embedded window.

## Requirements

- .NET 10 SDK (`dotnet --version` ≥ 10.0) for development
- Node 22+ and npm 10+ for development
- Windows 10/11 with the WebView2 runtime (built into Win11; auto-installs from the evergreen bootstrapper on Win10)

## Run it

There are three launch profiles plus matching root npm scripts.

| Use case | Command | What runs |
|---|---|---|
| **Single-button dev** (recommended) | `npm run devshell` | API + Vite + Photino window with HMR |
| Headless backend dev | `npm run dev:api` | API only on `:5125`, browser yourself |
| Browser-only client dev | `npm run dev:client` | Vite only on `:5173` (proxies `/api → :5125`) |
| Production-shaped shell | `npm run shell` | API + Photino, serves the built `wwwroot/` |

`npm run devshell` is the one-button experience: hit it from a terminal (or set the `DevShell` profile in Visual Studio / Rider and press F5) and you get the API, Vite, and a Photino window all wired together.

## Build & ship

Normal development uses feature branches into `develop`. When ready to release,
open a `develop` -> `main` PR; the owner reviews and merges it. `main` is the
production branch. See [contributor workflow](AGENTS.md).

Routine checks do not package a distributable executable:

```powershell
dotnet test Wisp.slnx -c Release
npm --prefix src/Wisp.Client test
npm --prefix src/Wisp.Client run lint
npm --prefix src/Wisp.Client run build
```

Only if you explicitly need a local standalone package:

```powershell
npm run build
```

This runs the SPA build (output → `src/Wisp.Api/wwwroot/`) and `dotnet publish -r win-x64 -c Release --self-contained` to `./publish/`. Double-click `publish/Wisp.exe` to launch without Visual Studio. Keep the executable together with the rest of the published folder; it contains the runtime, UI and supporting files.

### Windows installer

The **CI and Windows release** GitHub Actions workflow separates validation from
production packaging:

| Event | Validation | Installer and upload |
|---|---|---|
| PR into `develop` or `main` | Yes | No |
| Push/merge into `develop` | Yes | No |
| Push/merge into `main` | Yes | Only after validation passes |
| Manual workflow run (any branch) | Yes | No |

Feature-branch pushes without a PR do not run this workflow. Tests compile the
app, and the client build checks the UI, but neither produces a downloadable
release package. Installer smoke tests run only in the production packaging job.
To retry a failed production build, re-run its existing **push to main** run;
the manual Run workflow action deliberately validates only.

Open the successful production run under
**Actions → CI and Windows release**, download its `Wisp-Setup-…-win-x64` artifact,
extract the downloaded ZIP and run the setup EXE. Artifacts are retained for 90
days. This produces a new installer, not an automatic update of installed apps.

Setup installs into `%LOCALAPPDATA%\Programs\Wisp`, adds a Start menu shortcut
and optionally a desktop shortcut. It includes the .NET runtime, FFmpeg and
slskd. If WebView2 is missing, setup installs it using Microsoft's bootstrapper
(internet access required in that case). Visual Studio, Node and the .NET SDK
are not required to run the installed app. Builds are currently unsigned, so
Windows may show an unknown-publisher/SmartScreen prompt.

Run a newer installer to update. Your existing development library, cues and
settings remain in `%LOCALAPPDATA%\Wisp`; upgrades and uninstall preserve that
directory. Close an existing Wisp session before opening the installed copy.

To build setup locally, install [Inno Setup 6](https://jrsoftware.org/isinfo.php)
alongside the development requirements, then run:

```powershell
pwsh tools/build-installer.ps1 -Version 0.1.0
```

The EXE and SHA-256 checksum appear in `artifacts/installers/`. Packaging fetches
pristine, checksum-verified dependency archives, avoiding any local Soulseek
configuration. Production CI verifies a fresh installation, serves the bundled UI from the
installed executable, reinstalls it, then checks that uninstall preserves data.
That startup test is headless; it does not verify the Photino window or CDJ USB
compatibility. `WISP_DATA_DIR` selects a separate profile for isolated testing.

## Tests

```powershell
dotnet test
```

117 backend tests across `Wisp.Core.Tests` (filename parser, Camelot wheel, BPM scoring, recommendation modes, fractional ordering, phrase markers, name normalizer, cleanup suggestions), `Wisp.Infrastructure.Tests` (file fingerprint, library scanner integration, cleanup applier round-trip and USB sync), and `Wisp.Api.Tests` (HTTP endpoint contracts). The React client also has Vitest coverage for shared UI logic.

## Where things live

- `src/Wisp.Core/` — pure domain logic (no I/O): tracks, mix plans, cue points, recommendations, cleanup
- `src/Wisp.Infrastructure/` — file system, TagLibSharp, EF Core, scan worker, cleanup applier
- `src/Wisp.Api/` — ASP.NET Core minimal API endpoints + Photino host + JS↔.NET bridge
- `src/Wisp.Client/` — React SPA
- `tests/` — xunit projects mirroring the source tree

User data lives at `%LOCALAPPDATA%\Wisp\`:
- `wisp.db` — SQLite database (tracks, mix plans, cue points, audit log)
- `config.json` — last folder, window state
- `logs/wisp-{date}.log` — daily-rotated Serilog output

The built-in **Settings** dialog (gear icon top-right) shows these paths and lets you open them in Explorer.

## Implementation plan & backlog

- `WISP_IMPLEMENTATION_PLAN.md` — phase-by-phase build plan (Phases 0–6 shipped; 7 packaging, 8 Artist Refresh, 9 Crate Digger, 10 Master Tempo are scoped)
- `WISP_BACKLOG_FEATURES.md` — feature backlog with P0–P3 priorities
- `WISP_IMPLEMENTATION_STATUS.md` — current quality remediation and USB/CDJ export status

## License

Personal project. Ask before redistributing.
