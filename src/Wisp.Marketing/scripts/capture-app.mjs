// Captures the REAL WISP client with isolated API responses.
// Explicit --library permission reads approved playlist metadata and audio only.
// Database opened read-only; real paths never reach the browser or site assets.
// Actual song audio is decoded in RAM for waveforms; videos have NO audio stream.
// Notes, sources, availability results and USB are illustrative, never live.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("../", import.meta.url));
const client = join(root, "../Wisp.Client");
const origin = "http://127.0.0.1:19601";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "19601",
    "--strictPort",
  ],
  { cwd: client, windowsHide: true, stdio: "pipe" },
);
let browser;
// Public artist/title labels selected with the owner's approval from their playlist.
// No library identifiers, account data, real paths or recording notes are published.
const catalog = [
  ["Robin S", "Show Me Love", 127, "7A"],
  ["Chicago", "Street Player (House Mix)", 126, "7A"],
  [
    "Phil Fuldner & Dan Dinsing",
    "Regulate (Ian Pooley Mix) (Original Mix)",
    125,
    "7A",
  ],
  [
    "Ny's Finest",
    "Do You Feel Me (gerd's No Kick Re-Interpretation)",
    122,
    "7A",
  ],
  [
    "Paradox",
    "Feel So Good (Junior Jack and Kid Creme vocal remix)",
    127,
    "7B",
  ],
  ["Justin Harris", "Things (May Not Be The Way You Think)", 125, "8A"],
  [
    "Stacy Kidd, Peven Everett",
    "Body Jerkin (Stacy Kidd Lake Street. Mix)",
    126,
    "8A",
  ],
  ["Studio 45", "Freak it (Pete Heller Mix)", 129, "8A"],
  [
    "N'n'G feat. Kallaghan",
    "Right Before My Eyes (Grant Nelson Bumpin' Remix)",
    126,
    "9A",
  ],
  ["Livin' Large", "Anytime, Anywhere", 127, "9A"],
  ["Rhythm Street", "Answer My Prayer", 128, "9A"],
  ["Bump", "Bump - I'm Rushing (Tonka's Anthem Mix)", 128, "4A"],
  ["Dominica", "Gotta Let You Go", 129, "2A"],
  ["Crystal Waters", "Gypsy Woman (Rave Yard Mix)", 135, "7A"],
  ["Tuff Jam, Mike Sharon", "Thank You House Music", 125, "4A"],
  ["Swing 52", "Color Of My Skin (Swing Remix)", 121, "9A"],
  ["Secret Service", "Give Me the Night (Original Mix)", 126, "5A"],
  ["Soul Avengerz", "Love You Feel", 126, "6A"],
];
const tracks = catalog.map(([artist, title, bpm, musicalKey], i) => ({
  id: `demo-track-${i}`,
  artist,
  title,
  bpm,
  musicalKey,
  filePath: `D:/Demo Music/${title}.mp3`,
  fileName: `${title}.mp3`,
  album: "Demo collection",
  genre: i < 8 ? "Deep House" : "UK Garage",
  version: null,
  energy: Math.min(9, 4 + Math.floor(i / 3)),
  releaseYear: 2025,
  durationSeconds: 330 + i * 11,
  isMissingMetadata: false,
  isDirtyName: false,
  isUnavailable: false,
  addedAt: "2026-09-26T12:00:00Z",
  fileModifiedAt: "2026-09-26T12:00:00Z",
  notes: null,
  isArchived: false,
}));
const plan = {
  id: "demo-plan",
  name: "Garage session",
  notes: "Start deep. Build slowly. Leave space for the unexpected.",
  scope: "All",
  trackCount: 5,
  createdAt: "2026-09-26T12:00:00Z",
  updatedAt: "2026-09-26T12:00:00Z",
  tracks: tracks.slice(0, 5).map((track, i) => ({
    id: `entry-${i}`,
    trackId: track.id,
    track,
    position: i,
    cueInSeconds: 30,
    cueOutSeconds: track.durationSeconds - 30,
    isAnchor: i === 0,
    transitionNotes:
      i === 0
        ? "Let the intro breathe"
        : i === 2
          ? "Swap bass on the phrase"
          : null,
  })),
};
const session = {
  id: "demo-mix",
  title: "Garage session / Take 03",
  directoryPath: "D:/Demo Mixes",
  endpointId: "demo-input",
  deviceName: "Mixer stereo input",
  sampleRate: 44100,
  startedAt: "2026-09-26T17:00:00Z",
  state: "Ready",
  audioBytes: 44100 * 8 * 600,
  issue: null,
  previousTakeId: null,
  relinkedPath: null,
};
const argument = (name) => {
  const value = process.argv[process.argv.indexOf(name) + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}`);
  return value;
};
const libraryPath = process.argv.includes("--library")
  ? argument("--library")
  : process.env.WISP_CAPTURE_LIBRARY_PATH;
const audioCache = new Map();
const approvedPaths = new Map();
let reviewPeaks;
async function loadApprovedLibrary() {
  if (!libraryPath)
    throw new Error(
      "Capture needs explicit --library <database> permission. It never falls back to synthetic waveforms.",
    );
  const db = new DatabaseSync(libraryPath, { readOnly: true });
  try {
    const lookup = db.prepare(
      "SELECT t.Artist,t.Title,t.Version,t.Bpm,t.MusicalKey,t.Energy,t.ReleaseYear,t.Duration,t.FilePath FROM Tracks t JOIN PlaylistTracks pt ON pt.TrackId=t.Id JOIN Playlists p ON p.Id=pt.PlaylistId WHERE p.Name=? AND t.Artist=? AND t.Title=? AND t.IsUnavailable=0 AND t.IsArchived=0",
    );
    for (const [i, [artist, title]] of catalog.entries()) {
      const row = lookup.get("Garage / Old Skool House", artist, title);
      if (!row)
        throw new Error(
          `Approved playlist track not found: ${artist} — ${title}`,
        );
      const seconds = row.Duration.split(":").reduce(
        (total, part) => total * 60 + Number(part),
        0,
      );
      Object.assign(tracks[i], {
        title:
          row.Version &&
          !title.toLowerCase().includes(row.Version.toLowerCase())
            ? `${title} (${row.Version})`
            : title,
        version: row.Version,
        bpm: row.Bpm ? Number(row.Bpm) : null,
        musicalKey: row.MusicalKey,
        energy: row.Energy,
        releaseYear: row.ReleaseYear,
        durationSeconds: seconds,
      });
      approvedPaths.set(tracks[i].id, row.FilePath);
    }
  } finally {
    db.close();
  }
}
function approvedAudio(id) {
  if (audioCache.has(id)) return audioCache.get(id);
  const file = approvedPaths.get(id);
  if (!file)
    throw new Error("Audio request is outside the approved demo tracks.");
  // Mono PCM is an in-memory decode of the real file, not an invented signal.
  const pcm = execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "22050",
      "pipe:1",
    ],
    { windowsHide: true, maxBuffer: 256 * 1024 * 1024 },
  );
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24);
  wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  const duration = pcm.length / 2 / 22050;
  const perBucket = Math.floor(22050 / 20),
    count = Math.ceil(pcm.length / 2 / perBucket);
  let min = Array(count).fill(Infinity),
    max = Array(count).fill(-Infinity);
  for (let i = 0; i < pcm.length / 2; i++) {
    const bucket = Math.floor(i / perBucket),
      value = pcm.readInt16LE(i * 2) / 32768;
    min[bucket] = Math.min(min[bucket], value);
    max[bucket] = Math.max(max[bucket], value);
  }
  const levels = [{ secondsPerBucket: perBucket / 22050, min, max }];
  while (min.length > 512) {
    const nextMin = [],
      nextMax = [];
    for (let i = 0; i < min.length; i += 4) {
      nextMin.push(Math.min(...min.slice(i, i + 4)));
      nextMax.push(Math.max(...max.slice(i, i + 4)));
    }
    levels.push({
      secondsPerBucket: levels.at(-1).secondsPerBucket * 4,
      min: nextMin,
      max: nextMax,
    });
    min = nextMin;
    max = nextMax;
  }
  const result = { wav, duration, peaks: { duration, levels } };
  audioCache.set(id, result);
  return result;
}
const errors = [];
const output = join(root, "assets/screenshots");
const demos = join(root, "assets/demos");
const intermediate = join(root, "../../artifacts/marketing-capture");
const ffmpeg = process.argv.includes("--ffmpeg")
  ? argument("--ffmpeg")
  : process.env.WISP_FFMPEG_PATH || join(root, "../../tools/ffmpeg/ffmpeg.exe");
const media = [];
const sources = [
  {
    id: "demo-source",
    name: "Garage vinyl selections",
    sourceType: "YouTubeChannel",
    sourceUrl: "https://www.youtube.com/@fictional",
    importedCount: 18,
    lastScannedAt: "2026-09-26T12:00:00Z",
  },
];
const discovered = tracks.map((t, i) => ({
  id: `discovered-${i}`,
  discoverySourceId: "demo-source",
  sourceVideoId: "fictional00",
  sourceUrl: "https://www.youtube.com/watch?v=fictional00",
  rawTitle: `${t.artist} - ${t.title}`,
  parsedArtist: t.artist,
  parsedTitle: t.title,
  mixVersion: null,
  releaseYear: 2025,
  status: i === 1 ? "Want" : "New",
  isAlreadyInLibrary: i === 1,
  thumbnailUrl: null,
  publishedAt: "2026-09-26T12:00:00Z",
  importedAt: "2026-09-26T12:00:00Z",
}));
let matched = false;
const wishlist = [
  {
    id: "wanted-0",
    artist: "Robin S",
    title: "Show Me Love",
    source: "CrateDigger",
    matchedLocalTrackId: null,
    thumbnailUrl: null,
    sourceUrl: null,
    addedAt: "2026-09-26T12:00:00Z",
  },
  {
    id: "wanted-1",
    artist: "Chicago",
    title: "Street Player (House Mix)",
    source: "CrateDigger",
    matchedLocalTrackId: "demo-track-1",
    thumbnailUrl: null,
    sourceUrl: null,
    addedAt: "2026-09-26T12:00:00Z",
  },
];
const demoMatches = [
  "Discogs",
  "Bandcamp",
  "Beatport",
  "Juno",
  "Traxsource",
].map((source, i) => ({
  id: `match-${i}`,
  source,
  url: "https://example.com/demo",
  artist: "Robin S",
  title: "Show Me Love",
  version: null,
  year: 2025,
  availability: i ? "SearchLink" : "Unknown",
  confidenceScore: 0.92,
  matchedAt: "2026-09-26T12:00:00Z",
}));
let page;
async function box(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Missing capture region");
  const viewport = page.viewportSize();
  return {
    x: Math.ceil(b.x / 2) * 2,
    y: Math.ceil(b.y / 2) * 2,
    width: Math.floor(Math.min(b.width, viewport.width - b.x) / 2) * 2,
    height: Math.floor(Math.min(b.height, viewport.height - b.y - 8) / 2) * 2,
  };
}
async function still(name, locator, maxHeight) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const clip = await box(locator);
  if (maxHeight) clip.height = Math.min(clip.height, maxHeight);
  const png = join(intermediate, `${name}.png`);
  await page.screenshot({ path: png, clip });
  const file = join(output, `${name}.webp`);
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      png,
      "-quality",
      "88",
      file,
    ],
    { windowsHide: true },
  );
  media.push({
    file: `screenshots/${name}.webp`,
    width: clip.width,
    height: clip.height,
  });
}
async function demo(name, locator, action) {
  const clip = await box(locator);
  const start = (Date.now() - videoStart) / 1000;
  await page.waitForTimeout(900);
  await action();
  await page.waitForTimeout(1500);
  clips.push({
    name,
    clip,
    start,
    duration: (Date.now() - videoStart) / 1000 - start,
  });
}
const clips = [];
let videoStart;
try {
  await loadApprovedLibrary();
  const firstAudio = approvedAudio("demo-track-0");
  reviewPeaks = firstAudio.peaks;
  tracks[0].durationSeconds = firstAudio.duration;
  session.title = "Garage session / Review example";
  session.audioBytes = Math.round(firstAudio.duration * 44100 * 8);
  for (const track of discovered) {
    const local = tracks.find(
      (t) => t.id === `demo-track-${track.id.split("-").at(-1)}`,
    );
    const originalTitle = catalog[Number(track.id.split("-").at(-1))][1];
    track.parsedTitle = originalTitle;
    track.rawTitle = `${local.artist} - ${local.title}`;
    track.mixVersion =
      local.version &&
      !originalTitle.toLowerCase().includes(local.version.toLowerCase())
        ? local.version
        : null;
    track.releaseYear = local.releaseYear;
  }
  wishlist[0].title = tracks[0].title;
  wishlist[1].title = tracks[1].title;
  demoMatches.forEach((match) => {
    match.title = tracks[0].title;
    match.version = tracks[0].version;
    match.year = tracks[0].releaseYear;
  });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null)
      throw new Error(
        "Isolated client preview failed to start (is port 19601 occupied?).",
      );
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* startup */
    }
    if (attempt > 100)
      throw new Error(
        "Client preview did not start. Build src/Wisp.Client first.",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  await mkdir(output, { recursive: true });
  await mkdir(demos, { recursive: true });
  await mkdir(intermediate, { recursive: true });
  page = await browser.newPage({
    viewport: { width: 1420, height: 840 },
    deviceScaleFactor: 1,
    recordVideo: { dir: intermediate, size: { width: 1420, height: 840 } },
  });
  videoStart = Date.now();
  await page.addInitScript(() => {
    localStorage.setItem(
      "wisp.uiPrefs",
      JSON.stringify({
        version: 0,
        state: {
          libraryPrepHeight: 300,
          inspectorWidth: 470,
          libraryFiltersVisible: false,
        },
      }),
    );
    let receive;
    window.external = {
      receiveMessage: (callback) => {
        receive = callback;
      },
      sendMessage: (message) => {
        const { id, method } = JSON.parse(message);
        const result =
          method === "desktopCapabilities"
            ? {
                externalFileDrag: false,
                unifiedTrackDrag: false,
                maxDragTracks: 1000,
              }
            : method === "ping"
              ? "pong"
              : null;
        setTimeout(() => receive?.(JSON.stringify({ id, result })), 0);
      },
    };
  });
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head><meta charset="utf-8"></head><body style="margin:0;background:#17141d;color:#bdb7c5;display:grid;place-items:center;height:100vh;font:14px sans-serif">Illustrative source · YouTube preview</body></html>',
    }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path === "/api/tracks")
      body = { items: tracks, total: tracks.length, size: 500, page: 1 };
    if (path === "/api/playlists")
      body = [
        "Garage / Old Skool House",
        "Late night grooves",
        "New finds",
        "Vinyl favourites",
      ].map((name, i) => ({
        id: `playlist-${i}`,
        name,
        trackCount: 18 - i * 3,
      }));
    if (path === "/api/mix-plans") body = [plan];
    if (path === "/api/mix-plans/demo-plan") body = plan;
    if (path === "/api/settings/soulseek") body = { isConfigured: false };
    if (path === "/api/soulseek/connection")
      body = {
        isConfigured: false,
        daemonAvailable: false,
        isConnected: false,
        isLoggedIn: false,
      };
    if (path === "/api/recording-workspace/mixes")
      body = [
        { session, rating: 4, duration: reviewPeaks.duration, missing: false },
      ];
    if (
      path === "/api/recording-workspace/job" ||
      path === "/api/recording-exports/job"
    )
      body = null;
    if (path === "/api/recordings/status")
      body = { session: null, busy: false };
    if (path === "/api/recording-input/test")
      body = { state: "Idle", id: null, seconds: 0 };
    if (path === "/api/recording-workspace/demo-mix/review")
      body = {
        revision: 1,
        rating: 4,
        markers: [
          { id: "m1", seconds: 120, label: "Good blend — keep this pairing" },
          { id: "m2", seconds: 265, label: "Bass swap a little early" },
        ],
      };
    if (path === "/api/recording-feedback/demo-mix")
      body = {
        revision: 1,
        notes:
          "The opening felt right. Give the second transition a little more room.",
        status: "Practice",
        rating: 4,
        ratingRevision: 1,
        annotations: [
          {
            id: "a1",
            seconds: 120,
            endSeconds: null,
            text: "Good blend — keep this pairing",
            category: "Keep this",
            resolved: false,
            occurrenceId: null,
            toOccurrenceId: null,
            associationLabel: null,
          },
          {
            id: "a2",
            seconds: 265,
            endSeconds: 280,
            text: "Bass swap a little early. Wait for the next phrase.",
            category: "Phrasing",
            resolved: false,
            occurrenceId: null,
            toOccurrenceId: null,
            associationLabel: null,
          },
        ],
        detachedAnnotationIds: [],
      };
    if (path === "/api/recording-tracklists/demo-mix")
      body = {
        revision: 1,
        entries: [],
        snapshots: [],
        activeSnapshotId: null,
        timesDisagree: false,
        missingTrackIds: [],
      };
    if (path.endsWith("/thumbnail")) {
      const peaks = reviewPeaks.levels.at(-1).max;
      body = Array.from({ length: 100 }, (_, i) =>
        Math.abs(
          peaks[
            Math.min(peaks.length - 1, Math.floor((i * peaks.length) / 100))
          ],
        ),
      );
    }
    if (path.endsWith("/peaks")) body = reviewPeaks;
    if (path.endsWith("/audio")) {
      const id = path.startsWith("/api/tracks/")
        ? path.split("/")[3]
        : "demo-track-0";
      const audio = approvedAudio(id).wav;
      const range = route
        .request()
        .headers()
        .range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? +range[1] : 0,
        end = range?.[2]
          ? Math.min(+range[2], audio.length - 1)
          : audio.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: "audio/wav",
        body: audio.subarray(start, end + 1),
        headers: {
          "Accept-Ranges": "bytes",
          ...(range
            ? { "Content-Range": `bytes ${start}-${end}/${audio.length}` }
            : {}),
        },
      });
    }
    const request = route.request(),
      url = new URL(request.url());
    if (path === "/api/tracks") {
      const q = (url.searchParams.get("search") || "").toLowerCase();
      const rows = tracks.filter((t) =>
        (t.title + " " + t.artist).toLowerCase().includes(q),
      );
      body = { items: rows, total: rows.length, size: 500, page: 1 };
    }
    if (/^\/api\/tracks\/demo-track-\d+$/.test(path))
      body = tracks.find((t) => path.endsWith(t.id));
    if (path.endsWith("/cues"))
      body = [
        {
          id: "cue-1",
          trackId: "demo-track-0",
          timeSeconds: 30,
          type: "FirstBeat",
          label: "Intro — first phrase",
          isAutoSuggested: false,
          createdAt: "2026-09-26T12:00:00Z",
        },
      ];
    if (path.endsWith("/device-cues"))
      body = [
        {
          id: "memory-1",
          trackId: "demo-track-0",
          kind: "MemoryCue",
          startSeconds: 30,
          endSeconds: null,
          comment: "Intro — first phrase",
          sourceCuePointId: "cue-1",
          createdAt: "2026-09-26T12:00:00Z",
          updatedAt: "2026-09-26T12:00:00Z",
        },
      ];
    if (path === "/api/settings/soulseek") body = { isConfigured: false };
    if (path === "/api/discovery/sources") body = sources;
    if (path === "/api/discovery/sources/demo-source/tracks")
      body = {
        items: discovered,
        total: 18,
        undatedCount: 0,
        page: 1,
        size: 500,
      };
    if (/^\/api\/discovery\/tracks\/discovered-\d+$/.test(path))
      body = {
        track: discovered.find((t) => path.endsWith(t.id)),
        matches: matched ? demoMatches : [],
      };
    if (path.endsWith("/status") && path.includes("/discovery/tracks/")) {
      const track = discovered.find((t) => path.includes("/" + t.id + "/"));
      track.status = request.postDataJSON().status;
      body = track;
    }
    if (path.endsWith("/match") && path.includes("/discovery/tracks/")) {
      matched = true;
      body = { ok: true };
    }
    if (path === "/api/wanted-tracks") body = wishlist;
    if (path === "/api/cdj-export/devices")
      body = [
        {
          deviceId: "fictional-usb",
          rootPath: "F:\\",
          label: "GARAGE SESSION",
          model: "Demo USB",
          sizeBytes: 32000000000,
          freeBytes: 28000000000,
          fileSystem: "FAT32",
          partitionStyle: "MBR",
          partitionCount: 1,
          canExport: true,
          compatibilityProblem: null,
        },
      ];
    if (
      /^\/api\/mix-plans\/demo-plan\/tracks\/entry-\d+$/.test(path) &&
      request.method() === "PATCH"
    ) {
      const patch = request.postDataJSON(),
        index = plan.tracks.findIndex((t) => path.endsWith(t.id)),
        row = plan.tracks[index];
      Object.assign(row, patch);
      if (Object.hasOwn(patch, "afterMixPlanTrackId")) {
        plan.tracks.splice(index, 1);
        const after = plan.tracks.findIndex(
          (t) => t.id === patch.afterMixPlanTrackId,
        );
        plan.tracks.splice(after + 1, 0, row);
        plan.tracks.forEach((t, i) => (t.position = i));
      }
      body = row;
    }
    await route.fulfill({ json: body });
  });
  await page.goto(origin);
  await page.getByText(tracks[0].title, { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  // The real client decodes approved song audio and renders its actual waveform.
  // Browser recording is silent; no music is saved to site output.
  await page
    .locator('[data-track-id="demo-track-0"]')
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await page
    .getByText(/computing waveform/i)
    .first()
    .waitFor({ state: "hidden", timeout: 45000 });
  await page.waitForTimeout(500);
  await still("hero-focus", page.locator(".library-workspace"), 620);
  await still("hero-mobile", page.locator(".library-inspector-host"), 550);
  await still("library-focus", page.locator(".library-main"));
  await demo("library", page.locator(".library-main"), async () => {
    await page
      .getByRole("textbox", { name: "Search tracks" })
      .fill("Show Me Love");
    await page.waitForTimeout(1500);
    await page.getByRole("textbox", { name: "Search tracks" }).fill("");
    await page.waitForTimeout(1000);
  });
  const navigate = async (name) => {
    await page
      .locator(".app-sidebar")
      .getByRole("button", { name, exact: true })
      .click();
    await page.waitForTimeout(700);
  };
  await navigate("Crate Digger");
  await page.getByRole("button", { name: /^Garage vinyl selections/ }).click();
  await page
    .locator('[data-discovery-track="discovered-0"]')
    .getByRole("button")
    .click();
  await page.getByLabel("Discovery track details").waitFor();
  await demo("dig", page.locator(".crate-workspace"), async () => {
    await page
      .getByLabel("Discovery track details")
      .getByRole("button", { name: "Want", exact: true })
      .click();
    await page.waitForTimeout(1100);
    await page
      .getByRole("button", { name: "Check availability", exact: true })
      .click();
    await page.waitForTimeout(1100);
  });
  await still("dig-focus", page.locator(".crate-workspace"));
  await navigate("Wanted");
  await still("wanted-focus", page.locator(".wanted-workspace"), 340);
  await navigate("Mix Plans");
  await page
    .getByRole("button", { name: /Garage session/ })
    .first()
    .click();
  await page.getByText("Energy, key and BPM journey", { exact: true }).click();
  await demo(
    "plan",
    page.getByLabel("Plan workspace", { exact: true }),
    async () => {
      const grip = page
        .getByRole("button", { name: "Drag to reorder", exact: true })
        .nth(2);
      await grip.focus();
      await page.keyboard.press("Space");
      await page.waitForTimeout(500);
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(500);
      await page.keyboard.press("Space");
      await page.waitForTimeout(900);
      await page
        .getByRole("button", { name: "Transition 1 → 2", exact: true })
        .click();
      await page.waitForTimeout(1300);
      await page
        .getByRole("button", { name: "Chain view", exact: true })
        .click();
    },
  );
  await still("plan-focus", page.getByLabel("Plan workspace", { exact: true }));
  await page
    .getByRole("button", { name: "Export to CDJ USB", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByLabel("Connected USB", { exact: true })
    .selectOption("fictional-usb");
  await page.waitForTimeout(500);
  await still("usb-focus", page.getByRole("dialog"));
  await page.keyboard.press("Escape");
  await navigate("Mixes");
  await page
    .getByRole("region", { name: "Mix history" })
    .getByRole("button", { name: /Garage session/ })
    .click();
  await page
    .getByRole("slider", { name: "Recording waveform position", exact: true })
    .waitFor();
  await page
    .getByText("Good blend — keep this pairing", { exact: true })
    .waitFor();
  await still("mix-focus", page.locator(".wm-mix-detail"));
  await demo("mix", page.locator(".wm-mix-detail"), async () => {
    await page
      .getByRole("article", {
        name: "Comment: Good blend — keep this pairing",
        exact: true,
      })
      .getByRole("button", { name: "0:02:00.00", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Mix position"]').value === "117",
    );
    await page.waitForTimeout(1200);
  });
  if (errors.length)
    throw new Error(`Capture client errors: ${errors.join("; ")}`);
  const recording = page.video();
  await page.close();
  const input = await recording.path();
  for (const { name, clip, start, duration } of clips) {
    const file = join(demos, `${name}.mp4`);
    execFileSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(start),
        "-i",
        input,
        "-t",
        String(duration),
        "-vf",
        `crop=${clip.width}:${clip.height}:${clip.x}:${clip.y},scale='min(1100,iw)':-2,fps=24`,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        file,
      ],
      { windowsHide: true },
    );
    media.push({
      file: `demos/${name}.mp4`,
      duration,
      action: {
        library: "Search then return",
        dig: "Want then check availability",
        plan: "Reorder then inspect transition",
        mix: "Seek from feedback",
      }[name],
    });
  }
  for (const item of media) {
    const bytes = await readFile(join(root, "assets", item.file));
    item.bytes = bytes.length;
    item.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  await writeFile(
    join(root, "assets/capture-provenance.json"),
    JSON.stringify(
      {
        clientTree: execFileSync("git", ["rev-parse", "HEAD:src/Wisp.Client"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        capturedAt: new Date().toISOString(),
        source:
          "Actual WISP client, owner-approved tracks from Garage / Old Skool House. Real song waveform generated by WISP; illustrative notes/sources/results/USB. No private paths, credentials, database or audio published.",
        waveform: {
          track: tracks[0].artist + " — " + tracks[0].title,
          duration: reviewPeaks.duration,
          library: "Real WISP audio/peaks.ts analysis of approved local audio",
          review:
            "Real min/max waveform of the same track in an illustrative imported review, not a recorded DJ mix",
          audioPublished: false,
        },
        media,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Captured current WISP workspaces, focused posters and four silent real-interface demonstrations.",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(intermediate, "capture-failure.png") });
    console.error(await page.locator("body").innerText());
  }
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
