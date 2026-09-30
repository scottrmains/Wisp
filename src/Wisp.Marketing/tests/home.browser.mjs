import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { renderProductionPage } from "../scripts/production.mjs";

for (const javascriptEnabled of [true, false]) {
  test(`production download survives unavailable GitHub API (JavaScript ${javascriptEnabled})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: javascriptEnabled,
    });
    const page = await context.newPage();
    const url =
      "https://github.com/scottrmains/Wisp/releases/download/v0.1.42/Wisp-Setup-0.1.42-win-x64.exe";
    const html = renderProductionPage(
      await readFile(new URL("../index.html", import.meta.url), "utf8"),
      {
        version: "0.1.42",
        commit: "a".repeat(40),
        sha256: "b".repeat(64),
        size: 104857600,
        installerUrl: url,
        checksumUrl: `${url}.sha256`,
        notesUrl: "https://github.com/scottrmains/Wisp/releases/tag/v0.1.42",
      },
    );
    let apiRequests = 0;
    await page.route("https://api.github.com/**", (route) => {
      apiRequests++;
      return route.abort();
    });
    await page.route("http://127.0.0.1:19600/", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.goto("/");
    await expect(page.locator("#installer-link")).toHaveAttribute("href", url);
    await expect(page.locator("#installer-link")).toContainText(
      "Download for Windows",
    );
    await expect(page.getByRole("status")).toContainText("v0.1.42");
    expect(apiRequests).toBe(0);
    await context.close();
  });
}

async function setup(
  page,
  response = { status: 404, json: { message: "Not Found" } },
) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill(response),
  );
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

test("navigation reaches workflow, USB and an honest unpublished download fallback", async ({
  page,
}) => {
  const errors = await setup(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "LESS ADMIN.",
  );
  await expect(page.getByRole("status")).toContainText(
    "Public releases are being set up",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "The workflow" })
    .click();
  await expect(page).toHaveURL(/#workflow$/);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "USB prep" })
    .click();
  await expect(page).toHaveURL(/#usb$/);
  await page.getByRole("link", { name: "Get WISP" }).click();
  await expect(page).toHaveURL(/#download$/);
  await expect(
    page.getByRole("link", { name: "View current builds" }),
  ).toHaveAttribute("href", /actions\/workflows\/windows-installer.yml$/);
  expect(errors).toEqual([]);
});

test("a published installer updates the button, version and size without injecting HTML", async ({
  page,
}) => {
  await setup(page, {
    json: {
      tag_name: "<b>v0.1.42</b>",
      assets: [
        {
          name: "Wisp-Setup-0.1.42-win-x64.exe",
          browser_download_url:
            "https://github.com/scottrmains/Wisp/releases/download/v0.1.42/Wisp-Setup-0.1.42-win-x64.exe",
          size: 104857600,
        },
      ],
    },
  });
  await expect(page.locator("#installer-link")).toHaveText(
    "Download for Windows↓",
  );
  await expect(page.locator("#installer-link")).toHaveAttribute(
    "href",
    /releases\/download\/v0.1.42\//,
  );
  await expect(page.getByRole("status")).toContainText("100 MB");
  await expect(page.locator("#release-message b")).toHaveCount(0);
});

test("a GitHub outage keeps a release-page link, not a broken executable URL", async ({
  page,
}) => {
  await setup(page, { status: 503, json: {} });
  await expect(page.getByRole("status")).toContainText("unavailable");
  await expect(page.locator("#installer-link")).toHaveAttribute(
    "href",
    "https://github.com/scottrmains/Wisp/releases",
  );
});

test("a network failure is handled", async ({ page }) => {
  await page.route("https://api.github.com/**", (route) => route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("unavailable");
  expect(errors).toEqual([]);
});

test("keyboard navigation has a visible skip link and focus indicator", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeInViewport();
  await page.keyboard.press("Tab");
  const outline = await page
    .getByRole("link", { name: "WISP home", exact: true })
    .evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(outline).toBe("3px");
});

test("the complete page remains usable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:19600");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#installer-link")).toHaveAttribute(
    "href",
    /actions\/workflows/,
  );
  await expect(page.locator("#release-notes")).toHaveAttribute(
    "href",
    "https://github.com/scottrmains/Wisp/releases",
  );
  await expect(page.getByRole("status")).toContainText(
    "Public releases are being set up",
  );
  await context.close();
});

test("a stalled release lookup times out to a working GitHub fallback", async ({
  page,
}) => {
  await page.route("https://api.github.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.fulfill({ status: 404, json: {} }).catch(() => {});
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("unavailable", {
    timeout: 7500,
  });
  await expect(page.locator("#installer-link")).toHaveAttribute(
    "href",
    "https://github.com/scottrmains/Wisp/releases",
  );
});

test("the preview enforces the hosting security policy and correct module MIME type", async ({
  request,
}) => {
  const document = await request.get("/");
  expect(document.headers()["content-security-policy"]).toContain(
    "connect-src 'self' https://api.github.com",
  );
  expect(document.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  const script = await request.get("/site.mjs");
  expect(script.headers()["content-type"]).toContain("text/javascript");
  expect(script.headers()["x-content-type-options"]).toBe("nosniff");
});

for (const width of [360, 390, 768, 1440, 1920])
  test(`layout and assets are intact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = await setup(page);
    await page.locator(".site-footer").scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page
          .locator("img")
          .evaluateAll((imgs) =>
            imgs.every((img) => img.complete && img.naturalWidth > 0),
          ),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.goto("/");
    if ([390, 1440].includes(width))
      await page.screenshot({
        path: `../../artifacts/marketing-${width}.png`,
        fullPage: true,
      });
    if (width === 1440)
      await page.screenshot({ path: "../../artifacts/marketing-hero.png" });
  });

test("200% text size does not crop navigation or the download area", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await setup(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole("link", { name: "Get WISP" })).toBeVisible();
});

test("reduced-motion preference disables spatial button motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.locator("#installer-link").hover();
  expect(
    await page
      .locator("#installer-link")
      .evaluate((el) => getComputedStyle(el).transform),
  ).toBe("none");
});
