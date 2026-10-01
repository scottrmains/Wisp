import assert from "node:assert/strict";
import { validateManifest } from "./production.mjs";

/** Azure may propagate the manifest and HTML separately. Accept neither in isolation. */
export async function waitForDeployment({
  manifest,
  siteUrl,
  request,
  attempts = 60,
  intervalMs = 5000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry = () => {},
}) {
  const expected = validateManifest(manifest);
  const site = new URL(siteUrl);
  if (
    site.protocol !== "https:" ||
    !site.hostname.endsWith(".azurestaticapps.net") ||
    site.username ||
    site.password
  )
    throw new Error(
      "Expected the configured HTTPS Azure Static Web Apps hostname.",
    );
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    !Number.isFinite(intervalMs) ||
    intervalMs < 0
  )
    throw new Error("Invalid deployment retry budget.");

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Recheck both in every attempt; even a previously matching manifest can
      // become stale again if a subsequent request reaches another edge node.
      const release = await request(
        new URL(`/release.json?verify=${expected.commit}`, site),
      );
      const actual = validateManifest(await release.json());
      for (const [key, value] of Object.entries(expected))
        assert.equal(actual[key], value, `Release manifest mismatch: ${key}`);
      assert.match(
        release.headers.get("cache-control") ?? "",
        /no-store/,
        "Release manifest must not be cached",
      );

      // Check the ordinary homepage users receive, not just a cache-busted URL.
      const response = await request(new URL("/", site));
      const html = await response.text();
      assert.ok(
        html.includes(`data-release-version="${expected.version}"`),
        "Homepage release version has not caught up",
      );
      assert.ok(
        html.includes(expected.installerUrl),
        "Homepage installer link does not match the release",
      );
      assert.equal(
        response.headers.get("x-content-type-options"),
        "nosniff",
        "Homepage is missing nosniff",
      );
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /object-src 'none'/,
        "Homepage is missing the required CSP",
      );
      return site;
    } catch (error) {
      if (attempt === attempts)
        throw new Error(
          `Deployment did not become ready after ${attempts} checks: ${error.message}`,
          { cause: error },
        );
      onRetry({ attempt, attempts, intervalMs, error });
      await sleep(intervalMs);
    }
  }
}
