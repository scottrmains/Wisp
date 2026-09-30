import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { validateManifest } from "./production.mjs";

const expected = validateManifest(
  JSON.parse(await readFile(process.argv[2], "utf8")),
);
const siteUrl = process.argv[3];
const request = async (url) => {
  const response = await fetch(url, {
    credentials: "omit",
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(`Anonymous request failed (${response.status}): ${url}`);
  return response;
};
if (siteUrl) {
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
  // Azure edge propagation can take a little time. Never accept an older page.
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await request(
        new URL(`/release.json?verify=${expected.commit}`, site),
      );
      const actual = validateManifest(await response.json());
      for (const [key, value] of Object.entries(expected))
        assert.equal(actual[key], value);
      assert.match(response.headers.get("cache-control"), /no-store/);
      ready = true;
      break;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  assert.ok(ready);
  const response = await request(new URL("/", site));
  const html = await response.text();
  assert.ok(html.includes(`data-release-version="${expected.version}"`));
  assert.ok(html.includes(expected.installerUrl));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-security-policy"),
    /object-src 'none'/,
  );
  for (const [path, mime] of [
    ["/site.css", "text/css"],
    ["/site.mjs", "javascript"],
    ["/release.mjs", "javascript"],
    ["/assets/wispa.svg", "image/svg+xml"],
    ["/assets/screenshots/library.png", "image/png"],
    ["/assets/screenshots/search.png", "image/png"],
    ["/assets/screenshots/plan.png", "image/png"],
    ["/assets/screenshots/mix.png", "image/png"],
    ["/assets/fonts/dm-sans-latin-400-normal.woff2", "font/woff2"],
    ["/assets/fonts/dm-sans-latin-600-normal.woff2", "font/woff2"],
    ["/assets/fonts/barlow-condensed-latin-900-normal.woff2", "font/woff2"],
  ]) {
    const asset = await request(new URL(path, site));
    assert.ok(
      asset.headers.get("content-type")?.includes(mime),
      `Incorrect MIME: ${path}`,
    );
    assert.ok(
      (await asset.arrayBuffer()).byteLength > 0,
      `Empty asset: ${path}`,
    );
  }
  console.log(
    `Verified live homepage, version manifest, assets and security headers: ${site.origin}`,
  );
} else {
  // Verify the actual public binaries before replacing the currently good site.
  const response = await request(expected.installerUrl);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  assert.equal(bytes, expected.size);
  assert.equal(hash.digest("hex"), expected.sha256);
  const checksum = (await (await request(expected.checksumUrl)).text())
    .trim()
    .toLowerCase();
  assert.equal(
    checksum,
    `${expected.sha256}  Wisp-Setup-${expected.version}-win-x64.exe`.toLowerCase(),
  );
  console.log(
    `Verified anonymous installer download and SHA-256: v${expected.version}, ${bytes} bytes.`,
  );
}
