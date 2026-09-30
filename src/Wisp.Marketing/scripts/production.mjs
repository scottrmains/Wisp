import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const repo = "scottrmains/Wisp";
export const apiRoot = `https://api.github.com/repos/${repo}`;

export function productionContext(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REPOSITORY !== repo ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_NUMBER ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    throw new Error("Only a WISP main-push Actions run may publish or deploy.");
  return { version: `0.1.${env.GITHUB_RUN_NUMBER}`, commit: env.GITHUB_SHA };
}

export async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function assertCurrentMain(api, commit) {
  const branch = await api("GET", "/git/ref/heads/main");
  if (branch.object.sha !== commit)
    throw new Error(
      "This run is no longer current main; refusing an obsolete release/deployment.",
    );
}

export function validateManifest(data) {
  const version = data?.version;
  const name = `Wisp-Setup-${version}-win-x64.exe`;
  const base = `https://github.com/${repo}/releases/download/v${version}/${name}`;
  if (
    !/^0\.1\.[1-9]\d*$/.test(version ?? "") ||
    !/^[a-f0-9]{40}$/.test(data?.commit ?? "") ||
    !/^[a-f0-9]{64}$/.test(data?.sha256 ?? "") ||
    !Number.isSafeInteger(data?.size) ||
    data.size <= 0 ||
    data.installerUrl !== base ||
    data.checksumUrl !== `${base}.sha256` ||
    data.notesUrl !== `https://github.com/${repo}/releases/tag/v${version}`
  )
    throw new Error("Invalid production release manifest.");
  return data;
}

export function renderProductionPage(html, manifest) {
  const m = validateManifest(manifest);
  if (
    !html.includes('id="installer-link"') ||
    !html.includes('id="release-message"')
  )
    throw new Error("Missing production download markup.");
  return html
    .replace("<body>", `<body data-release-version="${m.version}">`)
    .replace(
      /(<a\s+id="installer-link"[\s\S]*?href=")[^"]*("[\s\S]*?>)[\s\S]*?<\/a/,
      `$1${m.installerUrl}$2Download for Windows <span aria-hidden="true">↓</span></a`,
    )
    .replace(
      /(<p id="release-message"[^>]*>)[\s\S]*?<\/p>/,
      `$1v${m.version} · Windows 64-bit · ${Math.round(m.size / 1024 / 1024)} MB. Download served by GitHub. Unsigned installer; Windows may show a warning.</p>`,
    )
    .replace(/(id="release-notes"\s+href=")[^"]*/, `$1${m.notesUrl}`)
    .replace(
      /<noscript[\s\S]*?<\/noscript>/,
      `<noscript><p>The download above works without JavaScript.</p></noscript>`,
    );
}

/** Draft first; never replace published assets. API and uploads are injectable for offline tests. */
export async function publishRelease({ api, upload, version, commit, files }) {
  await assertCurrentMain(api, commit);
  const tag = `v${version}`;
  let release = await api("GET", `/releases/tags/${tag}`, null, true);
  if (!release)
    release = await api("POST", "/releases", {
      tag_name: tag,
      target_commitish: commit,
      name: `WISP ${version}`,
      draft: true,
      prerelease: false,
      body: `Windows 10/11 x64 installer from main commit ${commit}.\n\nPassed backend, client and marketing validation, plus fresh install, launch, upgrade and uninstall smoke tests.\n\nVerify the included SHA-256 checksum. The installer is not code-signed; Windows SmartScreen may warn. User libraries are retained on upgrade/uninstall. See the repository implementation status for feature limitations.`,
    });
  if (release.target_commitish !== commit || release.prerelease)
    throw new Error(
      "Existing release belongs to a different commit or is a prerelease.",
    );
  if ((release.assets ?? []).some((a) => !files.some((f) => f.name === a.name)))
    throw new Error(
      "Unexpected release assets; refusing to alter the release.",
    );
  for (const file of files) {
    const matches = (release.assets ?? []).filter((a) => a.name === file.name);
    if (matches.length > 1) throw new Error("Duplicate release asset.");
    let asset = matches[0];
    if (!asset) {
      if (!release.draft)
        throw new Error(
          "Published release is incomplete; refusing to change it.",
        );
      asset = await upload(release, file);
    }
    if (
      asset.state !== "uploaded" ||
      asset.size !== file.size ||
      asset.digest !== `sha256:${file.sha256}`
    )
      throw new Error(`Release asset integrity mismatch: ${file.name}`);
  }
  // Re-fetch to verify the entire draft before making anything public.
  release = await api("GET", `/releases/${release.id}`);
  if (
    release.assets.length !== files.length ||
    files.some(
      (f) =>
        !release.assets.some(
          (a) =>
            a.name === f.name &&
            a.state === "uploaded" &&
            a.size === f.size &&
            a.digest === `sha256:${f.sha256}`,
        ),
    )
  )
    throw new Error("Release verification failed; draft remains unpublished.");
  await assertCurrentMain(api, commit);
  if (release.draft)
    release = await api("PATCH", `/releases/${release.id}`, {
      draft: false,
      make_latest: "true",
    });
  if (release.draft || release.prerelease)
    throw new Error("Release was not published.");
  return release;
}

export function githubApi(token, fetcher = fetch) {
  if (!token) throw new Error("Missing scoped GitHub Actions token.");
  return async (method, path, body, allow404 = false) => {
    const response = await fetcher(`${apiRoot}${path}`, {
      method,
      signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `GitHub ${method} ${path} failed (${response.status}). Re-run the main push after resolving the failure.`,
      );
    return response.json();
  };
}
