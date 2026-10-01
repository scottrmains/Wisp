import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const posters = [
  "hero-focus",
  "hero-mobile",
  "library-focus",
  "dig-focus",
  "wanted-focus",
  "plan-focus",
  "usb-focus",
  "mix-focus",
];
export const demonstrations = ["library", "dig", "plan", "mix"];
export const mediaFiles = [
  ...posters.map((name) => `screenshots/${name}.webp`),
  ...demonstrations.map((name) => `demos/${name}.mp4`),
];

export function assertSilentDemo(bytes) {
  const handlers = [];
  const walk = (start, end) => {
    for (let offset = start; offset + 8 <= end; ) {
      const size = bytes.readUInt32BE(offset),
        type = bytes.toString("ascii", offset + 4, offset + 8);
      if (size < 8 || offset + size > end) throw new Error("Invalid MP4 box");
      if (["moov", "trak", "mdia"].includes(type))
        walk(offset + 8, offset + size);
      if (type === "hdlr")
        handlers.push(bytes.toString("ascii", offset + 16, offset + 20));
      offset += size;
    }
  };
  walk(0, bytes.length);
  if (handlers.length !== 1 || handlers[0] !== "vide")
    throw new Error("Demo must contain one video track and NO audio");
}

// Intentional site assets are committed. Intermediate browser captures are not.
// A missing/stale file must fail validation rather than ship a broken demo.
export async function validateMedia(root) {
  const provenance = JSON.parse(
    await readFile(join(root, "assets/capture-provenance.json"), "utf8"),
  );
  if (
    !/^[a-f0-9]{40}$/.test(provenance.clientTree) ||
    !provenance.source ||
    !Number.isFinite(Date.parse(provenance.capturedAt))
  )
    throw new Error("Invalid capture provenance");
  if (
    JSON.stringify([...provenance.media.map((item) => item.file)].sort()) !==
    JSON.stringify([...mediaFiles].sort())
  )
    throw new Error("Unexpected or missing marketing media");
  let total = 0;
  for (const item of provenance.media) {
    const bytes = await readFile(join(root, "assets", item.file));
    total += bytes.length;
    if (
      bytes.length !== item.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== item.sha256
    )
      throw new Error(
        `Capture has changed without updating provenance: ${item.file}`,
      );
    if (bytes.length > 2_000_000)
      throw new Error(`Media exceeds its 2 MB budget: ${item.file}`);
    if (item.file.endsWith(".webp") && (!item.width || !item.height))
      throw new Error(`Missing image dimensions: ${item.file}`);
    if (
      item.file.endsWith(".mp4") &&
      !(item.duration > 0 && item.duration <= 15)
    )
      throw new Error(`Demo must be under 15 seconds: ${item.file}`);
    if (item.file.endsWith(".mp4")) assertSilentDemo(bytes);
  }
  if (total > 3_000_000)
    throw new Error("Marketing media exceeds its 3 MB total budget");
  return provenance;
}
