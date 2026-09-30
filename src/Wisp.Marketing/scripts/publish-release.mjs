import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  productionContext,
  fileHash,
  publishRelease,
  githubApi,
  repo,
  validateManifest,
} from "./production.mjs";

const { version, commit } = productionContext(process.env);
const directory = process.argv[2];
if (!directory)
  throw new Error("Pass the smoke-tested installer artifact directory.");
const name = `Wisp-Setup-${version}-win-x64.exe`;
const files = await Promise.all(
  [name, `${name}.sha256`].map(async (name) => ({
    name,
    path: join(directory, name),
    size: (await stat(join(directory, name))).size,
    sha256: await fileHash(join(directory, name)),
  })),
);
const checksum = (await readFile(files[1].path, "utf8")).trim();
if (checksum.toLowerCase() !== `${files[0].sha256}  ${name}`.toLowerCase())
  throw new Error("Installer does not match its smoke-tested checksum file.");
const token = process.env.GH_TOKEN;
const api = githubApi(token);
await publishRelease({
  api,
  version,
  commit,
  files,
  upload: async (release, file) => {
    const url = new URL(release.upload_url.replace(/\{.*$/, ""));
    if (
      url.origin !== "https://uploads.github.com" ||
      !url.pathname.startsWith(`/repos/${repo}/releases/`)
    )
      throw new Error("Unexpected GitHub upload URL.");
    url.searchParams.set("name", file.name);
    const response = await fetch(url, {
      method: "POST",
      duplex: "half",
      body: createReadStream(file.path),
      signal: AbortSignal.timeout(600000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.size),
      },
    });
    if (!response.ok)
      throw new Error(
        `Upload failed (${response.status}); verified assets remain in a draft for retry.`,
      );
    return response.json();
  },
});
const url = `https://github.com/${repo}/releases/download/v${version}/${name}`;
const manifest = validateManifest({
  version,
  commit,
  sha256: files[0].sha256,
  size: files[0].size,
  installerUrl: url,
  checksumUrl: `${url}.sha256`,
  notesUrl: `https://github.com/${repo}/releases/tag/v${version}`,
});
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/release-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Published verified WISP v${version} (${commit}).`);
