import test from "node:test";
import assert from "node:assert/strict";
import { waitForDeployment } from "../scripts/deployment-readiness.mjs";

const siteUrl = "https://wisp-fixture.azurestaticapps.net";
function manifestFor(version = "0.1.42", commit = "a".repeat(40)) {
  const installerUrl = `https://github.com/scottrmains/Wisp/releases/download/v${version}/Wisp-Setup-${version}-win-x64.exe`;
  return {
    version,
    commit,
    installerUrl,
    checksumUrl: `${installerUrl}.sha256`,
    notesUrl: `https://github.com/scottrmains/Wisp/releases/tag/v${version}`,
    sha256: "b".repeat(64),
    size: 104857600,
  };
}
const manifest = manifestFor();
const oldManifest = manifestFor("0.1.41", "c".repeat(40));
const htmlFor = (m) =>
  `<body data-release-version="${m.version}"><a href="${m.installerUrl}">Download</a></body>`;
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "object-src 'none'",
};

function fixture(states) {
  const requests = [],
    waits = [],
    retries = [];
  let attempt = -1;
  return {
    requests,
    waits,
    retries,
    options: {
      manifest,
      siteUrl,
      attempts: states.length,
      intervalMs: 5000,
      sleep: async (ms) => {
        waits.push(ms);
      },
      onRetry: (retry) => {
        retries.push(retry);
      },
      request: async (url) => {
        requests.push(url);
        if (url.pathname === "/release.json") attempt++;
        const state = states[attempt];
        if (url.pathname === "/release.json") {
          if (state.releaseError) throw state.releaseError;
          return new Response(JSON.stringify(state.manifest ?? manifest), {
            headers: { "cache-control": state.cacheControl ?? "no-store" },
          });
        }
        assert.equal(url.pathname, "/");
        assert.equal(url.search, "");
        if (state.homepageError) throw state.homepageError;
        return new Response(state.html ?? htmlFor(manifest), {
          headers: state.headers ?? securityHeaders,
        });
      },
    },
  };
}

test("matching manifest, normal homepage and security headers succeed without a delay", async () => {
  const f = fixture([{}]);
  const result = await waitForDeployment(f.options);
  assert.equal(result.origin, siteUrl);
  assert.equal(f.requests[0].searchParams.get("verify"), manifest.commit);
  assert.deepEqual(
    f.requests.map((url) => url.pathname),
    ["/release.json", "/"],
  );
  assert.deepEqual(f.waits, []);
  assert.deepEqual(f.retries, []);
});

test("regression: a current manifest with stale homepage retries instead of failing deployment", async () => {
  const f = fixture([{ html: htmlFor(oldManifest) }, {}]);
  await waitForDeployment(f.options);
  assert.equal(
    f.requests.filter((url) => url.pathname === "/release.json").length,
    2,
  );
  assert.equal(f.requests.filter((url) => url.pathname === "/").length, 2);
  assert.deepEqual(f.waits, [5000]);
  assert.match(f.retries[0].error.message, /Homepage release version/);
});

test("manifest is rechecked on every attempt, including after it previously matched", async () => {
  const f = fixture([
    { html: htmlFor(oldManifest) },
    { manifest: oldManifest },
    {},
  ]);
  await waitForDeployment(f.options);
  assert.equal(
    f.requests.filter((url) => url.pathname === "/release.json").length,
    3,
  );
  assert.equal(f.requests.filter((url) => url.pathname === "/").length, 2);
  assert.deepEqual(f.waits, [5000, 5000]);
  assert.match(
    f.retries[1].error.message,
    /Release manifest mismatch: version/,
  );
});

test("correct version with an obsolete installer link is not accepted", async () => {
  const f = fixture([
    { html: htmlFor({ ...manifest, installerUrl: oldManifest.installerUrl }) },
    {},
  ]);
  await waitForDeployment(f.options);
  assert.match(f.retries[0].error.message, /Homepage installer link/);
  assert.equal(f.waits.length, 1);
});

test("transient failures of either endpoint are retryable", async () => {
  const f = fixture([
    { releaseError: new Error("Anonymous request failed (503)") },
    { homepageError: new Error("Anonymous request timed out") },
    {},
  ]);
  await waitForDeployment(f.options);
  assert.equal(f.waits.length, 2);
  assert.match(f.retries[0].error.message, /503/);
  assert.match(f.retries[1].error.message, /timed out/);
});

test("retry exhaustion fails closed with the last mismatch and no extra wait", async () => {
  const f = fixture([
    { html: htmlFor(oldManifest) },
    { html: htmlFor(oldManifest) },
  ]);
  await assert.rejects(
    waitForDeployment(f.options),
    /after 2 checks: Homepage release version/,
  );
  assert.equal(f.waits.length, 1);
  assert.equal(f.requests.length, 4);
});

test("a correct version never bypasses manifest identity, cache or security checks", async () => {
  for (const state of [
    { manifest: { ...manifest, commit: oldManifest.commit } },
    { manifest: { ...manifest, sha256: "d".repeat(64) } },
    {
      manifest: {
        ...manifest,
        installerUrl: "https://example.com/untrusted.exe",
      },
    },
    { cacheControl: "public, max-age=3600" },
    { headers: { ...securityHeaders, "x-content-type-options": "" } },
    {
      headers: {
        ...securityHeaders,
        "content-security-policy": "default-src 'self'",
      },
    },
  ])
    await assert.rejects(
      waitForDeployment(fixture([state]).options),
      /did not become ready/,
    );
});

test("untrusted destinations and invalid retry budgets fail before making any requests", async () => {
  for (const change of [
    { siteUrl: "http://wisp-fixture.azurestaticapps.net" },
    { siteUrl: "https://example.com" },
    { siteUrl: "https://user:password@wisp-fixture.azurestaticapps.net" },
    { manifest: { ...manifest, commit: "invalid" } },
    { attempts: 0 },
    { attempts: Infinity },
    { intervalMs: -1 },
  ]) {
    const f = fixture([{}]);
    await assert.rejects(waitForDeployment({ ...f.options, ...change }));
    assert.deepEqual(f.requests, []);
  }
});
