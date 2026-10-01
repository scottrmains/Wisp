import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  validateMedia,
  mediaFiles,
  assertSilentDemo,
} from "../scripts/media.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
test("every focused capture/demo has provenance, matching bytes and a small delivery budget", async () => {
  const manifest = await validateMedia(root);
  assert.equal(manifest.media.length, 12);
  assert.match(manifest.source, /owner-approved/);
  assert.match(
    manifest.source,
    /No private paths, credentials, database or audio published/,
  );
  assert.equal(manifest.waveform.audioPublished, false);
  assert.match(manifest.presentation, /Lossless WebP captured at 2x/);
  for (const item of manifest.media.filter((item) =>
    item.file.endsWith(".webp"),
  ))
    assert.equal(item.captureScale, 2);
  for (const name of ["library", "plan"]) {
    const item = manifest.media.find(
      (item) => item.file === `screenshots/${name}-focus.webp`,
    );
    assert.ok(
      item.width / item.height > 2,
      `${name} should be a focused landscape capture`,
    );
  }
  assert.match(
    manifest.waveform.track,
    /Show Me Love \(Tonka's 2002 Club Mix\)/,
  );
  assert.match(manifest.waveform.library, /Real WISP audio\/peaks.ts/);
});
test("recordings are silent MP4s and the build rejects any audio track", async () => {
  const bytes = await readFile(
    new URL("../assets/demos/library.mp4", import.meta.url),
  );
  assert.doesNotThrow(() => assertSilentDemo(bytes));
  const invalid = Buffer.from(bytes);
  const index = invalid.indexOf(Buffer.from("vide"));
  assert.ok(index > 0);
  invalid.write("soun", index);
  assert.throws(() => assertSilentDemo(invalid), /NO audio/);
});
test("page references every current capture and no obsolete full-window PNG", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  for (const file of mediaFiles)
    assert.ok(html.includes(`./assets/${file}`), file);
  assert.doesNotMatch(html, /screenshots\/(?:library|search|plan|mix)\.png/);
  assert.doesNotMatch(html, /Sunday Club|Moving Through|Nina Vale/);
  const manifest = await validateMedia(root);
  for (const item of manifest.media.filter(
    (item) => item.file.endsWith(".webp") && !item.file.includes("hero-mobile"),
  )) {
    const tag = html.match(
      new RegExp(`<img[^>]+src="\\./assets/${item.file}"[^>]*>`),
    )?.[0];
    assert.ok(tag, item.file);
    assert.ok(
      tag.includes(`width="${item.width}"`) &&
        tag.includes(`height="${item.height}"`),
      `Incorrect reserved aspect ratio: ${item.file}`,
    );
  }
});
