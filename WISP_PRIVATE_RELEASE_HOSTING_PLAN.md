# WISP private repository and Azure release hosting plan

Status: deferred, low priority, not implemented. Updated 2026-10-03.

This plan separates private WISP development from public installer distribution.
The proposed destination is Azure Blob Storage for verified installers and
checksums, with a release-history page and individual version pages on
`https://wisp.physiqo.app`. Keep the repository public until the replacement
download path is verified and the owner explicitly approves the visibility change.

This document authorises no infrastructure provisioning, expenditure, licence
change or repository-visibility change. The existing pipeline remains in use.

## Current dependencies

The workflow in `.github/workflows/windows-installer.yml` validates development
changes and builds, smoke-tests and publishes installers only after a successful
push to `main`. Preserve that boundary and the owner's control over releases.

Public GitHub dependencies currently include:

- `src/Wisp.Marketing/scripts/publish-release.mjs`: publishes GitHub release assets.
- `scripts/production.mjs`: validates exact GitHub installer and release-note URLs.
- `scripts/verify-production.mjs` and the deployment-readiness checker: verify
  anonymous download integrity and the matching homepage/release manifest.
- `release.mjs`, `site.mjs`, `index.html` and `staticwebapp.config.json`: GitHub
  release lookup, fallback links, source/issues/build links and API permissions.
- Related unit/browser fixtures and public hosting documentation.

Making GitHub private first would break public download and repository links.
The source build can still use authenticated GitHub APIs; visitors must not need
GitHub access or receive a GitHub/Azure credential.

## Proposed release architecture

Keep the existing Static Web App and custom domain. Add a dedicated WISP storage
account in `rg-wisp-prod`, isolated from Pulse and Physiqo resources. Storage
account name, region, redundancy and retention remain implementation decisions.

Use a container holding only intended public distribution files. Proposed paths
are `releases/<version>/Wisp-Setup-<version>-win-x64.exe`, its `.sha256` file and
the version's public metadata. Enable anonymous **blob read**, not anonymous
container enumeration or writes. No databases, music, credentials, CI logs,
source checkout or debug symbols belong in this container. Azure documents the
distinction between blob and container access in its
[anonymous-read configuration guide](https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-configure).

Authenticate pipeline uploads with Azure federation and a narrowly scoped
storage data role. Do not embed account keys or expiring SAS links in the site.
Keep exact approved HTTPS origins/paths in manifest validation rather than
loosening validation to accept arbitrary download URLs.

Published version files must never be silently overwritten. On retry, accept
existing bytes only after their size and SHA-256 match the verified artifact;
otherwise fail. Publish the latest manifest/site only after anonymous downloads
verify successfully, preserving the previous working release if publication fails.

## Public release notes

Proposed URLs are `/releases/` for history and `/releases/<version>/` for a
dedicated, directly linkable version page. Use the marketing site's established
style, with release date, features, fixes, known limitations, installer link,
file size and checksum. Preserve older notes and downloads across deployments.

Summaries should describe the feature/fix PRs included since the previous
production release, not merely the `develop` to `main` promotion PR. Deduplicate
included PRs and exclude unrelated/unreleased changes. Use reviewed public-facing
note fragments or approved summaries; do not automatically expose private PR
bodies, discussions, security details, internal links or personal file paths.
Freeze the final notes with their release version/commit. Render untrusted text
safely and verify historical pages after each site deployment.

## Phase 1 Preconditions

- [ ] Inventory downloads, tags, manifests and repository links, including the
  desktop app, before choosing the migration scope.
- [ ] Check the owner's GitHub plan, private Actions allowance, artifact retention
  and deployment-environment support. The current Azure federation references
  the `production` environment; preserve it where supported or deliberately
  replace it with a `main`-restricted federation/configuration arrangement.
- [ ] Estimate storage, transactions, download bandwidth and private CI usage;
  agree budgets/alerts before creating billable resources. Alerts are not a
  guaranteed spending cap. Do not assume existing public Actions use stays free.
- [ ] Review WISP redistribution terms and bundled dependency obligations,
  including FFmpeg and slskd. Keeping the repo private is separate from changing
  licensing; retain required notices and appropriate corresponding-source access.
- [ ] Agree installer/history retention and the public-summary authoring format.

## Phase 2 Azure publication

- [ ] Add reviewed, repeatable provisioning for dedicated storage and scoped
  upload identity permissions without expanding access to unrelated resources.
- [ ] Replace GitHub public-asset publication with versioned Azure publication;
  retain current-main guards, smoke-test requirements and safe retry behaviour.
- [ ] Set download content type/disposition and appropriate cache headers.
- [ ] Verify anonymous downloads by size and full SHA-256, not just HEAD responses
  or trusted metadata. No visitor token is required.
- [ ] Test interrupted uploads, duplicate versions, changed bytes, stale-main
  runs and failures before latest-release promotion.

## Phase 3 Website and notes

- [ ] Build release history and per-version pages from approved summaries and
  retained version metadata, without requiring visitor GitHub API calls.
- [ ] Update manifest validation, baked-in download links, fallbacks and security
  policy. Replace inaccessible repository/issues/build links with intentional
  public destinations; do not simply leave broken links after privacy changes.
- [ ] Preserve a working download with JavaScript disabled, accessible release
  navigation, mobile layouts and the existing marketing style.
- [ ] Cover notes escaping, missing/unknown versions, older-page retention,
  download failures and homepage/manifest consistency in automated tests.

## Phase 4 Migration and private cutover

- [ ] Copy approved existing installers/checksums without rebuilding or changing
  their bytes. Archive available notes accurately; label missing historical
  information instead of inventing PR summaries.
- [ ] Deploy and verify Azure downloads, latest/history pages and checksums while
  GitHub is still public. Test as an anonymous visitor.
- [ ] Obtain separate owner approval to make the repository private and confirm
  collaborator, environment, federation and branch-protection requirements.
- [ ] Verify authenticated CI/private-source access and anonymous website access
  after cutover. Confirm production-only publication still holds.
- [ ] Update contributor/user documentation and record the completed migration
  and remaining limitations in `WISP_IMPLEMENTATION_STATUS.md`.

## Recovery and limits

Keep the previous verified website/manifest until replacement publication succeeds.
Retain exact version artifacts and checksums so a failed deployment can be retried
without clobbering a public release. Roll back to a verified Azure-hosted release;
after privacy changes, do not restore links that require anonymous GitHub access.

Private source hosting does not provide installer copy protection, code signing,
licence enforcement or an automatic desktop updater. Those are separate features.
Copies and public forks made before the privacy change cannot be made private by
changing this repository's visibility. A dependency review is required before
making proprietary-licensing claims; this plan is not legal advice.

## Reference checks before implementation

Costs and plan capabilities can change. Recheck these official sources when this
deferred work is resumed:

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub deployment environments and plan availability](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub repository visibility changes](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [Azure Blob Storage pricing](https://azure.microsoft.com/en-gb/pricing/details/storage/blobs/)
- [Azure bandwidth pricing](https://azure.microsoft.com/en-gb/pricing/details/bandwidth/)
- [FFmpeg licensing guidance](https://ffmpeg.org/legal.html)
- [Bundled dependency notices](installer/THIRD-PARTY.md)
