import test from "node:test";
import assert from "node:assert/strict";
import { selectInstaller, latestInstaller, releaseApi } from "../release.mjs";

const asset = (
  name = "Wisp-Setup-win-x64.exe",
  url = `https://github.com/scottrmains/Wisp/releases/download/v0.1.42/${name}`,
) => ({ name, browser_download_url: url, size: 104857600 });
const release = (...assets) => ({
  tag_name: "v0.1.42",
  assets,
  prerelease: false,
  draft: false,
});
test("selects the canonical Windows installer and exact versioned release URL", () => {
  assert.deepEqual(selectInstaller(release(asset())), {
    url: asset().browser_download_url,
    version: "v0.1.42",
    notesUrl: "https://github.com/scottrmains/Wisp/releases",
    size: 100,
  });
});
test("supports a single versioned installer from the existing naming convention", () => {
  assert.ok(selectInstaller(release(asset("Wisp-Setup-0.1.42-win-x64.exe"))));
});
test("prefers the stable asset name when multiple Windows installers exist", () => {
  assert.equal(
    selectInstaller(release(asset("Wisp-Setup-0.1.42-win-x64.exe"), asset()))
      .url,
    asset().browser_download_url,
  );
});
test("never offers ambiguous assets, draft releases or prereleases", () => {
  assert.equal(
    selectInstaller(
      release(
        asset("Wisp-Setup-0.1.42-win-x64.exe"),
        asset("Wisp-Setup-0.1.43-win-x64.exe"),
      ),
    ),
    null,
  );
  for (const flag of ["draft", "prerelease"])
    assert.equal(selectInstaller({ ...release(asset()), [flag]: true }), null);
});
test("rejects other repositories, insecure URLs, script URLs and credentials", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://github.com/scottrmains/Wisp/releases/download/v1/file.exe",
    "https://example.com/file.exe",
    "https://github.com/other/repo/releases/download/v1/file.exe",
    "https://user:pass@github.com/scottrmains/Wisp/releases/download/v1/file.exe",
  ])
    assert.equal(selectInstaller(release(asset(undefined, url))), null);
});
test("rejects other platforms, non-installer files and malformed data", () => {
  for (const name of [
    "Wisp-Setup-linux-x64.exe",
    "Wisp-Setup-win-x64.exe.zip",
    "Wisp-Setup-win-x64.exe.sha256",
  ])
    assert.equal(selectInstaller(release(asset(name))), null);
  for (const data of [null, {}, [], { assets: null }, { assets: [null] }])
    assert.equal(selectInstaller(data), null);
});
test("queries latest release anonymously without GitHub tokens", async () => {
  const result = await latestInstaller(async (url, options) => {
    assert.equal(url, releaseApi);
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, status: 200, json: async () => release(asset()) };
  });
  assert.equal(result.state, "ready");
});
test("no published release or installer is represented honestly", async () => {
  assert.equal(
    (await latestInstaller(async () => ({ status: 404 }))).state,
    "unpublished",
  );
  assert.equal(
    (
      await latestInstaller(async () => ({
        status: 200,
        ok: true,
        json: async () => release(),
      }))
    ).state,
    "unpublished",
  );
});
test("rate limits and outages leave a useful fallback", async () => {
  for (const status of [403, 429, 500, 503])
    assert.equal(
      (await latestInstaller(async () => ({ status, ok: false }))).state,
      "unavailable",
    );
});
test("network and malformed JSON failures propagate to the page fallback", async () => {
  await assert.rejects(
    latestInstaller(async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  await assert.rejects(
    latestInstaller(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid JSON");
      },
    })),
    /invalid JSON/,
  );
});
