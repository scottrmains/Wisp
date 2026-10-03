import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { validateManifest } from "./production.mjs";
import { mediaFiles } from "./media.mjs";
import { waitForDeployment } from "./deployment-readiness.mjs";

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
  const site = await waitForDeployment({
    manifest: expected,
    siteUrl,
    request,
    onRetry: ({ attempt, attempts, intervalMs, error }) =>
      console.log(
        `Deployment not ready (${attempt}/${attempts}): ${error.message}. Retrying in ${intervalMs / 1000}s.`,
      ),
  });
  for (const [path, mime] of [
    ["/site.css", "text/css"],
    ["/site.mjs", "javascript"],
    ["/motion.mjs", "javascript"],
    ["/release.mjs", "javascript"],
    ["/assets/wispa.svg", "image/svg+xml"],
    ...mediaFiles.map((file) => [
      `/assets/${file}`,
      file.endsWith(".webp") ? "image/webp" : "video/mp4",
    ]),
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
