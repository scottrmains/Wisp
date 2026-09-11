# WISP contributor workflow

- `develop` is the integration branch; `main` is production.
- Start normal feature/fix work from current `origin/develop` on a `codex/<description>` branch.
- Push feature branches and open PRs into `develop`. Do not push changes directly to `develop` or `main`.
- The owner promotes reviewed work with a `develop` -> `main` PR and decides when to merge/release. Do not merge or enable auto-merge without explicit authorization.
- Development pushes and PRs run validation only. Installers are packaged, smoke-tested and uploaded only on a successful push-to-`main` pipeline.
- Do not generate standalone executables, run `dotnet publish`, run the root `npm run build`, or build installers for routine changes unless the user specifically asks for a local package. Use `dotnet test` and client test/lint/build commands for normal verification.
- Keep credentials, databases, music, recovery backups and generated artifacts out of Git. Preserve working library/cue data during tests by using isolated profiles.
- Document material changes and verified limitations in `WISP_IMPLEMENTATION_STATUS.md`. Do not claim CDJ compatibility without hardware evidence.
