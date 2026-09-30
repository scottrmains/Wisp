import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const fonts = [
  "barlow-condensed-latin-900-normal.woff2",
  "dm-sans-latin-400-normal.woff2",
  "dm-sans-latin-600-normal.woff2",
];
await mkdir(join(root, "assets/fonts"), { recursive: true });
for (const font of fonts) {
  const family = font.startsWith("barlow") ? "barlow-condensed" : "dm-sans";
  await cp(
    join(root, `node_modules/@fontsource/${family}/files/${font}`),
    join(root, "assets/fonts", font),
  );
}
await cp(
  join(root, "../../src/Wisp.Client/public/branding/wispa.svg"),
  join(root, "assets/wispa.svg"),
);
for (const name of ["library", "search", "plan", "mix"]) {
  await stat(join(root, `assets/screenshots/${name}.png`)).catch(() => {
    throw new Error(
      `Missing ${name} screenshot. See README.md for the isolated capture procedure.`,
    );
  });
}
await mkdir(join(root, "dist"), { recursive: true });
for (const name of [
  "index.html",
  "site.css",
  "site.mjs",
  "release.mjs",
  "assets",
  "staticwebapp.config.json",
]) {
  await cp(join(root, name), join(root, "dist", name), { recursive: true });
}
for (const family of ["barlow-condensed", "dm-sans"]) {
  await cp(
    join(root, `node_modules/@fontsource/${family}/LICENSE`),
    join(root, `dist/assets/fonts/${family}-LICENSE.txt`),
  );
}
const html = await readFile(join(root, "dist/index.html"), "utf8");
if (/http:\/\//.test(html))
  throw new Error("Insecure link in marketing output");
console.log(
  "Built static marketing site in src/Wisp.Marketing/dist. No desktop app or installer was built.",
);
