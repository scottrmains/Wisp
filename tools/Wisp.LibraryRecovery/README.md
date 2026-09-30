# Offline library-link recovery

Close WISP and external tagging applications before applying repairs. Use an
already migrated database from the current WISP version. This tool never runs
schema migrations, tags audio, imports files or removes library rows.

Preview (the default):

```powershell
$env:WISP_FFMPEG_PATH = 'E:\Projects\Wisp\tools\ffmpeg\ffmpeg.exe'
dotnet run --project tools/Wisp.LibraryRecovery -- '<wisp.db>' '<music-root>' '<new-report-directory>'
```

Use a report directory outside the repository. Review `plan.json`, then repeat
with a different new report directory and `--apply` to re-plan and apply. Apply
creates a consistent SQLite backup and rolls back the batch if a planned file
changes. Reports are never overwritten. Keep backup databases and reports private.

Portable identities are initialised by a rescan in the updated application.
FFmpeg is needed to verify audio fingerprints. Without FFmpeg, this tool can
only recover legacy rows using the older conservative matching rules. A sidecar
by itself is never accepted as proof of audio identity.
