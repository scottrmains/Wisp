import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  productionContext,
  assertCurrentMain,
  publishRelease,
  validateManifest,
  renderProductionPage,
  githubApi,
} from "../scripts/production.mjs";

const commit = "a".repeat(40);
const version = "0.1.42";
const name = `Wisp-Setup-${version}-win-x64.exe`;
const url = `https://github.com/scottrmains/Wisp/releases/download/v${version}/${name}`;
const manifest = {
  version,
  commit,
  sha256: "b".repeat(64),
  size: 104857600,
  installerUrl: url,
  checksumUrl: `${url}.sha256`,
  notesUrl: `https://github.com/scottrmains/Wisp/releases/tag/v${version}`,
};
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "scottrmains/Wisp",
  GITHUB_RUN_NUMBER: "42",
  GITHUB_SHA: commit,
};
const files = [
  { name, size: 123, sha256: "b".repeat(64) },
  { name: `${name}.sha256`, size: 100, sha256: "c".repeat(64) },
];
const asset = (f) => ({
  ...f,
  state: "uploaded",
  digest: `sha256:${f.sha256}`,
});

function mock({
  existing,
  failUpload = false,
  corrupt = false,
  obsoleteAfterUpload = false,
} = {}) {
  let release = existing ? structuredClone(existing) : null;
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === "/git/ref/heads/main")
      return {
        object: {
          sha:
            obsoleteAfterUpload && release?.assets.length
              ? "d".repeat(40)
              : commit,
        },
      };
    if (method === "GET") return release;
    if (method === "POST") release = { id: 123, ...body, assets: [] };
    else Object.assign(release, body);
    return release;
  };
  const upload = async (_, file) => {
    calls.push({ method: "UPLOAD", path: file.name });
    if (failUpload) throw new Error("Network failed");
    const result = asset(file);
    if (corrupt) result.digest = "sha256:incorrect";
    release.assets.push(result);
    return result;
  };
  return { api, upload, calls, state: () => release };
}
const publish = (m) => publishRelease({ ...m, version, commit, files });

test("production context rejects local runs, PRs, develop, manual and wrong repositories", () => {
  assert.deepEqual(productionContext(env), { version, commit });
  for (const change of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/develop" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { GITHUB_REPOSITORY: "other/Wisp" },
    { GITHUB_RUN_NUMBER: "42\n" },
    { GITHUB_SHA: "invalid" },
  ])
    assert.throws(() => productionContext({ ...env, ...change }));
});
test("an obsolete run cannot publish or deploy", async () => {
  await assert.rejects(
    assertCurrentMain(async () => ({ object: { sha: "old" } }), commit),
    /obsolete/,
  );
});
test("production manifest pins own-repo installer, notes, digest, size and commit", () => {
  assert.equal(validateManifest(manifest), manifest);
  for (const change of [
    { version: "<script>" },
    { commit: "" },
    { size: -1 },
    { sha256: "bad" },
    { installerUrl: "https://evil.example/a.exe" },
    { installerUrl: `${url}?x=1` },
    { checksumUrl: url },
    { notesUrl: "https://example.com" },
  ])
    assert.throws(() => validateManifest({ ...manifest, ...change }));
});
test("production HTML has a real download without JS and discloses signing status", async () => {
  const html = renderProductionPage(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    manifest,
  );
  assert.ok(html.includes(`data-release-version="${version}"`));
  assert.match(
    html,
    /id="installer-link"[\s\S]*?href="https:\/\/github.com\/scottrmains\/Wisp\/releases\/download\/v0.1.42\/Wisp-Setup-0.1.42-win-x64.exe"/,
  );
  assert.match(html, /Download for Windows/);
  assert.match(html, /Unsigned installer/);
  assert.ok(html.includes(manifest.notesUrl));
  assert.ok(!html.includes("require GitHub sign-in"));
});
test("first release uploads and verifies both draft assets before publication", async () => {
  const m = mock();
  const result = await publish(m);
  assert.equal(result.draft, false);
  assert.equal(m.calls.find((c) => c.method === "POST").body.draft, true);
  assert.deepEqual(
    m.calls.filter((c) => c.method === "UPLOAD").map((c) => c.path),
    files.map((f) => f.name),
  );
  assert.deepEqual(m.calls.at(-1).body, { draft: false, make_latest: "true" });
});
test("upload failure leaves a draft and does not touch the current public release", async () => {
  const m = mock({ failUpload: true });
  await assert.rejects(publish(m), /Network failed/);
  assert.equal(m.state().draft, true);
  assert.equal(m.calls.filter((c) => c.method === "PATCH").length, 0);
});
test("GitHub digest mismatch prevents draft publication", async () => {
  const m = mock({ corrupt: true });
  await assert.rejects(publish(m), /integrity mismatch/);
  assert.equal(m.state().draft, true);
});
test("partial draft retry uploads only the missing verified asset", async () => {
  const m = mock({
    existing: {
      id: 123,
      target_commitish: commit,
      draft: true,
      assets: [asset(files[0])],
    },
  });
  await publish(m);
  assert.deepEqual(
    m.calls.filter((c) => c.method === "UPLOAD").map((c) => c.path),
    [files[1].name],
  );
});
test("published retry is idempotent and never reuploads or resets latest", async () => {
  const m = mock({
    existing: {
      id: 123,
      target_commitish: commit,
      draft: false,
      assets: files.map(asset),
    },
  });
  await publish(m);
  assert.equal(m.calls.filter((c) => c.method !== "GET").length, 0);
});
test("published missing/corrupt assets are never overwritten", async () => {
  for (const assets of [
    [],
    [asset(files[0])],
    [{ ...asset(files[0]), digest: "bad" }, asset(files[1])],
  ]) {
    const m = mock({
      existing: { id: 123, target_commitish: commit, draft: false, assets },
    });
    await assert.rejects(publish(m));
    assert.equal(m.calls.filter((c) => c.method !== "GET").length, 0);
  }
});
test("foreign commits, prereleases and unexpected assets cannot be repurposed", async () => {
  for (const change of [
    { target_commitish: "other" },
    { prerelease: true },
    { assets: [{ name: "unknown.exe" }] },
  ]) {
    const m = mock({
      existing: {
        id: 123,
        target_commitish: commit,
        draft: true,
        assets: [],
        ...change,
      },
    });
    await assert.rejects(publish(m));
    assert.equal(m.calls.filter((c) => c.method !== "GET").length, 0);
  }
});
test("main changing during upload leaves the completed draft unpublished", async () => {
  const m = mock({ obsoleteAfterUpload: true });
  await assert.rejects(publish(m), /obsolete/);
  assert.equal(m.state().draft, true);
});
test("API errors fail closed, except an explicitly allowed missing release", async () => {
  assert.throws(() => githubApi(""), /Missing/);
  const api = githubApi("test-only-not-a-real-token", async (url, opts) => {
    assert.ok(url.startsWith("https://api.github.com/repos/scottrmains/Wisp/"));
    assert.equal(
      opts.headers.Authorization,
      "Bearer test-only-not-a-real-token",
    );
    return { ok: false, status: 404 };
  });
  assert.equal(await api("GET", "/releases/tags/v0.1.42", null, true), null);
  await assert.rejects(api("GET", "/git/ref/heads/main"), /failed \(404\)/);
});
