// Isolated, fictional design preview. Never starts WISP or reads a user profile.
// Install client and marketing dependencies, then run this file with Node.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import React from "../../src/Wisp.Client/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../src/Wisp.Client/node_modules/react-dom/server.node.js";
import * as lucide from "../../src/Wisp.Client/node_modules/lucide-react/dist/cjs/lucide-react.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = new Map([
  ["/", ["design/ui-redesign/index.html", "text/html; charset=utf-8"]],
  [
    "/preview.css",
    ["design/ui-redesign/preview.css", "text/css; charset=utf-8"],
  ],
  [
    "/preview.mjs",
    ["design/ui-redesign/preview.mjs", "text/javascript; charset=utf-8"],
  ],
  [
    "/wispa.svg",
    ["src/Wisp.Client/public/branding/wispa.svg", "image/svg+xml"],
  ],
  [
    "/body.woff2",
    [
      "src/Wisp.Marketing/node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2",
      "font/woff2",
    ],
  ],
  [
    "/body-semibold.woff2",
    [
      "src/Wisp.Marketing/node_modules/@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff2",
      "font/woff2",
    ],
  ],
  [
    "/display.woff2",
    [
      "src/Wisp.Marketing/node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-900-normal.woff2",
      "font/woff2",
    ],
  ],
  [
    "/dm-sans-licence",
    [
      "src/Wisp.Marketing/node_modules/@fontsource/dm-sans/LICENSE",
      "text/plain; charset=utf-8",
    ],
  ],
  [
    "/barlow-licence",
    [
      "src/Wisp.Marketing/node_modules/@fontsource/barlow-condensed/LICENSE",
      "text/plain; charset=utf-8",
    ],
  ],
]);
const names = [
  "Library",
  "ListMusic",
  "AudioLines",
  "Compass",
  "Pickaxe",
  "Heart",
  "Network",
  "PanelLeftClose",
  "PanelLeftOpen",
  "Plus",
  "Search",
  "MoreHorizontal",
  "Settings2",
  "SlidersHorizontal",
  "ChevronDown",
  "ChevronRight",
  "X",
  "Play",
  "Pause",
  "SkipBack",
  "SkipForward",
  "Volume2",
  "ArrowDownToLine",
  "FolderPlus",
  "Usb",
  "Check",
  "Tag",
  "GripVertical",
  "Bookmark",
  "CircleHelp",
  "Folder",
  "ArrowUpDown",
  "Music2",
];
const icons = Object.fromEntries(
  names.map((name) => [
    name,
    renderToStaticMarkup(
      React.createElement(lucide[name], {
        size: 20,
        strokeWidth: 1.7,
        "aria-hidden": true,
      }),
    ),
  ]),
);

export function createPreviewServer() {
  return createServer(async (request, response) => {
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    };
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, headers).end();
        return;
      }
      const path = new URL(request.url, "http://localhost").pathname;
      if (path === "/icons.json") {
        response.writeHead(200, {
          ...headers,
          "Content-Type": "application/json",
        });
        response.end(
          request.method === "HEAD" ? undefined : JSON.stringify(icons),
        );
        return;
      }
      const file = files.get(path);
      if (!file) {
        response.writeHead(404, headers).end("Not found");
        return;
      }
      const data = await readFile(resolve(root, file[0]));
      response.writeHead(200, { ...headers, "Content-Type": file[1] });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch {
      response.writeHead(500, headers).end("Preview asset unavailable");
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.WISP_UI_PREVIEW_PORT ?? 19710);
  createPreviewServer().listen(port, "127.0.0.1", () =>
    console.log(`Fictional WISP UI preview: http://127.0.0.1:${port}`),
  );
}
