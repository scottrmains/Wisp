# Wisp

> Local-first DJ prep assistant. Turns a chaotic folder of analysed tracks into a smart, playable mix plan.

Reads BPM / Camelot key / energy from existing Mixed in Key tags — no audio analysis. Recommends compatible tracks, builds drag-and-drop mix chains, previews two-deck blends with crossfade and waveforms, manages cue points (manual + phrase markers from BPM), and cleans up dirty filenames / tags safely with full undo.

## Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind v4 + TanStack Query/Table/Virtual + Zustand + dnd-kit + Web Audio API
- **Backend**: ASP.NET Core 10 minimal API + EF Core 10 + SQLite + TagLibSharp + Serilog
- **Desktop shell**: Photino.NET (WebView2 on Windows). Single .NET process hosts both Kestrel and the embedded window.

## Requirements

- .NET 10 SDK (preview channel — `dotnet --version` ≥ 10.0)
- Node 20+ and npm 10+
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

```powershell
npm run build
```

This runs the SPA build (output → `src/Wisp.Api/wwwroot/`) and `dotnet publish -r win-x64 -c Release --self-contained` to `./publish/`. The result is a self-contained ~117 MB folder containing `Wisp.exe` plus runtime files. Double-click `Wisp.exe` to launch.

## Tests

```powershell
dotnet test
```

103 tests across `Wisp.Core.Tests` (filename parser, Camelot wheel, BPM scoring, recommendation modes, fractional ordering, phrase markers, name normalizer, cleanup suggestions) and `Wisp.Infrastructure.Tests` (file fingerprint, library scanner integration, cleanup applier round-trip against a real MP3).

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

## License

Personal project. Ask before redistributing.
