export const repository = "scottrmains/Wisp";
export const buildsUrl = `https://github.com/${repository}/actions/workflows/windows-installer.yml`;
export const releasesUrl = `https://github.com/${repository}/releases`;
export const releaseApi = `https://api.github.com/repos/${repository}/releases/latest`;

/** Only accept Windows installers published to WISP's own public releases. */
export function selectInstaller(release) {
  if (
    !release ||
    release.draft ||
    release.prerelease ||
    !Array.isArray(release.assets)
  )
    return null;
  const candidates = release.assets.filter((asset) => {
    if (
      !/^Wisp-Setup-(?:win-x64|[0-9][A-Za-z0-9._-]*-win-x64)\.exe$/.test(
        asset?.name ?? "",
      )
    )
      return false;
    try {
      const url = new URL(asset.browser_download_url);
      return (
        url.protocol === "https:" &&
        url.hostname === "github.com" &&
        !url.username &&
        !url.password &&
        url.pathname.startsWith(`/${repository}/releases/download/`) &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  });
  const asset =
    candidates.find((a) => a.name === "Wisp-Setup-win-x64.exe") ??
    (candidates.length === 1 ? candidates[0] : null);
  if (!asset) return null;
  return {
    url: asset.browser_download_url,
    version: String(release.tag_name ?? "Latest release").slice(0, 100),
    notesUrl: releasesUrl,
    size:
      typeof asset.size === "number" && asset.size > 0
        ? Math.round(asset.size / 1024 / 1024)
        : null,
  };
}

export async function latestInstaller(fetcher = fetch, signal) {
  const response = await fetcher(releaseApi, {
    signal,
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) return { state: "unpublished", installer: null };
  if (!response.ok) return { state: "unavailable", installer: null };
  const installer = selectInstaller(await response.json());
  return { state: installer ? "ready" : "unpublished", installer };
}
