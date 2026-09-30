// Captures the REAL WISP client with fictional, browser-intercepted API data.
// No backend, user profile, peer login, library database or native bridge is used.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

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
const catalog = [
  ["Sunday Club", "Moving Through", 124, "8A"],
  ["Nina Vale", "Back To You (Dub)", 125, "9A"],
  ["Side Room", "After Hours", 126, "9A"],
  ["The North Line", "Let It Breathe", 126, "10A"],
  ["Lena Grey", "Half Past Midnight", 127, "10A"],
  ["Soft Signal", "Deep End", 128, "11A"],
  ["The Late Shift", "Something Good", 128, "11A"],
  ["Common Ground", "On & On", 129, "12A"],
  ["Blue Avenue", "Feeling This", 130, "12A"],
  ["The Loop Theory", "Stay A Little Longer", 130, "1A"],
  ["Room Two", "If You Know", 131, "1A"],
  ["Local Motion", "Open Late", 131, "2A"],
  ["Violet Hours", "The Way It Was", 132, "2A"],
  ["New Perspective", "Soft Landing", 132, "3A"],
  ["Off The Record", "One More", 133, "3A"],
  ["Analog People", "All Night", 133, "4A"],
  ["Second Nature", "Free Flow", 134, "4A"],
  ["Wide Open", "Tomorrow", 134, "5A"],
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
  name: "Sunday session",
  notes: "Start deep. Build slowly. Leave space for the unexpected.",
  scope: "All",
  trackCount: 5,
  createdAt: "2026-09-26T12:00:00Z",
  updatedAt: "2026-09-26T12:00:00Z",
  tracks: tracks
    .slice(0, 5)
    .map((track, i) => ({
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
  title: "Sunday session / Take 03",
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
const samples = 8000 * 600;
const audio = Buffer.alloc(44 + samples * 2);
audio.write("RIFF", 0);
audio.writeUInt32LE(audio.length - 8, 4);
audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write("data", 36);
audio.writeUInt32LE(samples * 2, 40);
const errors = [];
try {
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
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path === "/api/tracks")
      body = { items: tracks, total: tracks.length, size: 500, page: 1 };
    if (path === "/api/playlists")
      body = [
        "Sunday warm-up",
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
    if (path === "/api/settings/soulseek")
      body = { isConfigured: true, hasUsername: true, hasPassword: true };
    if (path === "/api/soulseek/connection")
      body = {
        isConfigured: true,
        daemonAvailable: true,
        isConnected: true,
        isLoggedIn: true,
        username: "demo-digger",
      };
    if (path === "/api/soulseek/searches") body = { id: "demo-search" };
    if (path === "/api/soulseek/searches/demo-search")
      body = {
        id: "demo-search",
        isComplete: true,
        responseCount: 4,
        hits: tracks
          .slice(0, 5)
          .map((t, i) => ({
            username: `demo-collector-${i + 1}`,
            filename: `Music\\${tracks[0].artist} - ${tracks[0].title}${i ? " (Extended)" : ""}.mp3`,
            size: 13000000 + i * 1000000,
            bitRate: 320,
            sampleRate: 44100,
            length: 360,
            locked: false,
            uploadSpeed: 1024000,
            queueLength: 0,
            hasFreeUploadSlot: true,
          })),
      };
    if (path === "/api/recording-workspace/mixes")
      body = [{ session, rating: 4, duration: 600, missing: false }];
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
    if (path.endsWith("/thumbnail"))
      body = Array.from(
        { length: 100 },
        (_, i) => 0.2 + Math.abs(Math.sin(i * 0.3)) * 0.6,
      );
    if (path.endsWith("/peaks"))
      body = {
        duration: 600,
        levels: [
          {
            secondsPerBucket: 1,
            min: Array.from(
              { length: 600 },
              (_, i) =>
                -0.1 -
                Math.abs(Math.sin(i * 2.23) * Math.cos(i * 0.035)) * 0.55,
            ),
            max: Array.from(
              { length: 600 },
              (_, i) =>
                0.1 + Math.abs(Math.sin(i * 2.33) * Math.cos(i * 0.032)) * 0.6,
            ),
          },
        ],
      };
    if (path.endsWith("/audio")) {
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
    await route.fulfill({ json: body });
  });
  const output = join(root, "assets/screenshots");
  await mkdir(output, { recursive: true });
  await page.goto(origin);
  await page.getByText("Moving Through", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "library.png") });
  await page.getByRole("button", { name: "Soulseek", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Soulseek search query" })
    .fill("Sunday Club Moving Through");
  await page
    .getByRole("button", { name: "Search Soulseek", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Select Sunday Club - Moving Through.mp3 from demo-collector-1",
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: join(output, "search.png") });
  await page.getByRole("button", { name: "Mix Plans", exact: true }).click();
  await page
    .getByRole("button", { name: /Sunday session/ })
    .first()
    .click();
  await page.getByPlaceholder("Transition notes…").first().waitFor();
  await page.screenshot({ path: join(output, "plan.png") });
  await page.getByRole("button", { name: "Mixes", exact: true }).click();
  await page
    .getByRole("region", { name: "Mix history" })
    .getByRole("button", { name: /Sunday session/ })
    .click();
  await page
    .getByRole("slider", { name: "Recording waveform position", exact: true })
    .waitFor();
  await page
    .getByText("Good blend — keep this pairing", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "mix.png") });
  if (errors.length)
    throw new Error(`Capture client errors: ${errors.join("; ")}`);
  console.log("Captured four real WISP workspaces using fictional demo data.");
} finally {
  await browser?.close();
  server.kill();
}
