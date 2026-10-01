import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT ?? 19600);
const securityHeaders = JSON.parse(
  await readFile(resolve(root, "staticwebapp.config.json"), "utf8"),
).globalHeaders;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(resolve(root) + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const body = await readFile(file);
    const headers = {
      ...securityHeaders,
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };
    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      const start = range?.[1]
        ? Number(range[1])
        : range?.[2]
          ? Math.max(0, body.length - Number(range[2]))
          : NaN;
      const end =
        range?.[1] && range[2]
          ? Math.min(Number(range[2]), body.length - 1)
          : body.length - 1;
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        start >= body.length ||
        end < start
      ) {
        response
          .writeHead(416, {
            ...headers,
            "Content-Range": `bytes */${body.length}`,
          })
          .end();
        return;
      }
      const part = body.subarray(start, end + 1);
      response.writeHead(206, {
        ...headers,
        "Content-Length": part.length,
        "Content-Range": `bytes ${start}-${end}/${body.length}`,
      });
      response.end(request.method === "HEAD" ? undefined : part);
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": body.length });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`WISP marketing preview: http://127.0.0.1:${port}`),
);
