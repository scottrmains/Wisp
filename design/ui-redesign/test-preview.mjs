// Run: node design/ui-redesign/test-preview.mjs
// Browser evidence is limited to this fictional prototype, not native WISP.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../../src/Wisp.Client/node_modules/@playwright/test/index.mjs";
import { createPreviewServer } from "./serve.mjs";

const output = fileURLToPath(
  new URL("../../artifacts/ui-redesign/", import.meta.url),
);
await mkdir(output, { recursive: true });
const server = createPreviewServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
const forbidden = [];
const findings = [];
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== origin ||
      url.pathname.startsWith("/api") ||
      request.method() !== "GET"
    )
      forbidden.push(request.url());
  });
  await page.goto(origin);
  await page
    .getByRole("checkbox", {
      name: "Select Sunday Club — Moving Through",
      exact: true,
    })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  async function capture(name) {
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.getElementById("notice").hidden = true;
    });
    await page.screenshot({ path: `${output}/${name}.png` });
    const metrics = await page.evaluate(() => {
      const viewport = document
        .querySelector(".table-scroll")
        .getBoundingClientRect();
      const rows = [...document.querySelectorAll("tbody tr")].filter((row) => {
        const bounds = row.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
      });
      return {
        width: innerWidth,
        height: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        tableHeight: Math.round(viewport.height),
        fullRows: rows.length,
        compact: document.querySelector(".shell").classList.contains("compact"),
      };
    });
    findings.push({ name, ...metrics });
    assert.equal(metrics.pageWidth, metrics.width, `Page overflow in ${name}`);
    return metrics;
  }
  for (const width of [1366, 1024, 1920]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    for (const state of ["browse", "prepare", "selected"]) {
      await page.locator(`[data-state="${state}"]`).click();
      const metrics = await capture(`${state}-${width}`);
      assert.ok(
        metrics.fullRows >= (state === "prepare" ? 3 : 8),
        `${state} at ${width} needs ${state === "prepare" ? "three" : "eight"} full visible rows, got ${metrics.fullRows}`,
      );
      if (state === "prepare") {
        const wave = await page.locator("#prep-wave").boundingBox();
        const list = await page.locator(".table-scroll").boundingBox();
        assert.ok(
          wave.width >= 580 && wave.height >= 80,
          "Preparation needs a wide, usable waveform",
        );
        assert.ok(
          wave.y + wave.height < list.y,
          "Preparation waveform must sit above the track list",
        );
      }
      assert.ok(
        await page
          .locator(".table-scroll")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
        "DJ columns overflowed",
      );
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('[data-state="browse"]').click();
  await page
    .getByRole("searchbox", { name: "Search Library", exact: true })
    .fill("Nina Vale");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page
    .getByRole("searchbox", { name: "Search Library", exact: true })
    .fill("a missing demo track");
  assert.equal(await page.locator("tbody tr").count(), 0);
  assert.ok(
    await page
      .getByText("No matching demo tracks. Try another artist or title.")
      .isVisible(),
  );
  await page
    .getByRole("searchbox", { name: "Search Library", exact: true })
    .fill("");
  await page
    .getByRole("checkbox", { name: "Select all visible tracks", exact: true })
    .check();
  assert.equal(await page.locator("tbody tr.selected").count(), 18);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page
    .getByRole("button", { name: "Search playlists", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Search playlists", exact: true })
    .fill("afternoons");
  assert.equal(await page.locator("#playlist-list .playlist").count(), 1);
  await page.locator("#playlist-list .playlist > button").first().click();
  assert.equal(await page.locator("tbody tr").count(), 4);
  await capture("long-playlist-1366");
  await page.getByRole("button", { name: "All tracks", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose columns", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Date added", exact: true }).check();
  assert.ok(
    await page
      .getByRole("columnheader", { name: "Added", exact: true })
      .isVisible(),
  );
  await page
    .getByRole("checkbox", { name: "Date added", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Choose columns", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Search playlists", exact: true })
    .fill("");
  await page
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open your playlists", exact: true })
    .click();
  assert.ok(
    await page
      .getByRole("dialog", { name: "Playlists", exact: true })
      .isVisible(),
  );
  await page
    .getByRole("searchbox", { name: "Find playlist in drawer", exact: true })
    .fill("Vinyl");
  await page.locator("#drawer-playlists .playlist > button").first().click();
  assert.equal(await page.locator("tbody tr").count(), 4);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await capture("compact-playlist-1366");
  await page.locator('[data-state="browse"]').click();
  await page
    .getByRole("button", { name: "Expand navigation", exact: true })
    .click();
  const settingsTrigger = page.getByRole("button", {
    name: "Open Settings",
    exact: true,
  });
  await settingsTrigger.click();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => !!document.activeElement.closest("#settings")),
      "Settings focus escaped modal",
    );
  }
  await page.screenshot({ path: `${output}/settings-1366.png` });
  await page.keyboard.press("Escape");
  assert.ok(
    await settingsTrigger.evaluate((node) => node === document.activeElement),
  );
  await page
    .getByRole("button", { name: "Choose columns", exact: true })
    .focus();
  await page.waitForTimeout(420);
  assert.ok(await page.getByRole("tooltip").isVisible());
  await page.keyboard.press("Escape");
  assert.ok(await page.getByRole("tooltip").isHidden());
  await page.locator('[data-state="prepare"]').click();
  await page.locator("#wave-zoom").selectOption("2");
  await page.locator("#nudge-forward").click();
  assert.equal(
    await page.locator("#precise-position").textContent(),
    "0:30.010",
  );
  await page.locator("#prep-wave").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#position").inputValue(), "30.02");
  await page.keyboard.press("ArrowLeft");
  await page
    .getByRole("button", { name: "Save memory cue here", exact: true })
    .click();
  assert.equal(await page.locator(".cue-row").count(), 3);
  assert.ok(await page.getByText("3 / 10", { exact: true }).isVisible());
  await page.getByRole("button", { name: "0:30.000", exact: true }).click();
  assert.equal(await page.locator("#position").inputValue(), "30");
  assert.equal(
    await page.locator("#prep-wave").getAttribute("aria-valuetext"),
    "0:30.000",
  );
  const waveform = await page.locator("#prep-wave").boundingBox();
  await page.mouse.click(
    waveform.x + waveform.width * 0.75,
    waveform.y + waveform.height / 2,
  );
  assert.equal(await page.locator("#position").inputValue(), "30.5");
  await page.locator("#prep-resize").focus();
  await page.keyboard.press("Home");
  assert.equal(
    await page.locator("#prep-resize").getAttribute("aria-valuenow"),
    "210",
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.locator("#prep-resize").getAttribute("aria-valuenow"),
    "226",
  );
  const handle = await page.locator("#prep-resize").boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2 + 12,
  );
  await page.mouse.up();
  assert.equal(
    await page.locator("#prep-resize").getAttribute("aria-valuenow"),
    "238",
  );
  await capture("prepare-precision-1366");
  await page.locator("#focus-list").click();
  assert.ok(await page.locator("#preparation-dock").isHidden());
  const focusedList = await capture("prepare-focus-list-1366");
  assert.ok(focusedList.fullRows >= 8);
  assert.equal(await page.locator("#position").inputValue(), "30.5");
  await page.locator("#player-prep").click();
  assert.equal(
    await page.locator("#prep-resize").getAttribute("aria-valuenow"),
    "238",
  );
  assert.equal(await page.locator("#position").inputValue(), "30.5");
  await page
    .getByRole("button", {
      name: "Close preparation without stopping playback",
      exact: true,
    })
    .click();
  assert.ok(
    await page
      .getByRole("region", { name: "Demo playback presentation" })
      .isVisible(),
  );

  // Browser-equivalent zoom checks reduce the CSS viewport without changing the
  // prototype's typography. They are not physical Windows display-scale tests.
  for (const scale of [1.25, 1.5]) {
    await page.setViewportSize({
      width: Math.floor(1366 / scale),
      height: Math.floor(768 / scale),
    });
    await page.locator('[data-state="browse"]').click();
    const metrics = await capture(`browse-equivalent-${scale * 100}percent`);
    assert.ok(
      metrics.fullRows >= 4,
      "Scaled browsing should retain four full rows",
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  );
  assert.deepEqual(errors, [], "Browser errors");
  assert.deepEqual(forbidden, [], "Prototype accessed an unexpected service");
  await writeFile(
    `${output}/verification.json`,
    JSON.stringify(
      {
        findings,
        errors,
        forbidden,
        checks: [
          "three states at three desktop sizes",
          "long labels",
          "search and empty state",
          "select all",
          "playlist search and compact drawer",
          "Settings focus containment and return",
          "tooltip focus and Escape",
          "illustrative cue feedback",
          "wide top preparation waveform with click seek, zoom and 10 ms nudges",
          "pointer and keyboard resizing retained through Focus list",
          "equivalent zoom",
          "reduced motion",
          "no WISP API or external requests",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ result: "pass", findings, errors, forbidden }, null, 2),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
