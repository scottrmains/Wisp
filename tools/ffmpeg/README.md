# Bundled FFmpeg

This folder holds `ffmpeg.exe` — the binary that powers Wisp's
**Convert to MP3** action (Phase 23). Without it, the action surfaces a
"FFmpeg not found" error and conversion is disabled; everything else in
the app keeps working.

The binary itself is **gitignored** because it's ~100 MB. Every fresh
checkout needs to fetch it once before `dotnet publish` produces a build
with conversion enabled:

```
pwsh tools/get-ffmpeg.ps1
```

That downloads gyan.dev's "essentials" Windows-x64 build, extracts
`ffmpeg.exe`, and drops it here. After publish, the same binary lands
next to `Wisp.exe` in the `publish/` folder so end users get one-click
conversion with no extra install.

## Why a static build instead of a NuGet wrapper

NuGet packages around FFmpeg (FFMpegCore, Xabe.FFmpeg, etc.) are
.NET wrappers that still expect a `ffmpeg.exe` binary on disk. Wisp's
needs are simple — shell out + read stderr for progress — so we skip
the wrapper layer and call the binary directly.

## License note

gyan.dev's essentials build is GPL. Redistributing Wisp with this
binary inside means the redistributed build is GPL-bound. If that ever
matters for distribution, swap to an LGPL build (`ffmpeg-shared` from
gyan.dev or BtbN) — same wire format, just slightly smaller `ffmpeg.exe`.
