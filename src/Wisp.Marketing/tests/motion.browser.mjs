import { expect, test } from "@playwright/test";

async function setup(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
  });
  return errors;
}
const demo = (page, name = "library") => page.locator(`[data-demo=${name}]`);

test("demos fetch only on arrival, play once, pause offscreen and have keyboard pause/resume/replay", async ({
  page,
}) => {
  const requested = [];
  page.on("request", (request) => {
    if (request.url().includes("/demos/")) requested.push(request.url());
  });
  const errors = await setup(page);
  expect(requested).toEqual([]);
  const figure = demo(page),
    video = figure.locator("video"),
    button = figure.getByRole("button");
  await figure.scrollIntoViewIfNeeded();
  await expect(video).toHaveAttribute("data-ready", "");
  await expect(button).toHaveAccessibleName("Pause Library demonstration");
  await button.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(true);
  await expect(button).toHaveAccessibleName(/Resume Library/);
  await button.press("Enter");
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(false);
  await page.locator(".site-header").scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(true);
  await figure.scrollIntoViewIfNeeded();
  expect(await video.evaluate((el) => el.paused)).toBe(true);
  await button.click();
  await video.evaluate((el) => {
    el.currentTime = el.duration - 0.1;
  });
  await expect(button).toHaveAccessibleName("Replay Library demonstration");
  await button.click();
  await expect
    .poll(() => video.evaluate((el) => el.currentTime))
    .toBeLessThan(2);
  expect(await video.evaluate((el) => el.loop)).toBe(false);
  expect(requested.every((url) => url.includes("library.mp4"))).toBe(true);
  expect(errors).toEqual([]);
});

test("all four encoded demos load and play, with only one active at a time", async ({
  page,
}) => {
  const errors = await setup(page);
  for (const name of ["library", "dig", "plan", "mix"]) {
    const figure = demo(page, name),
      video = figure.locator("video");
    await figure.scrollIntoViewIfNeeded();
    await expect(video).toHaveAttribute("data-ready", "");
    const metadata = await video.evaluate((el) => ({
      duration: el.duration,
      width: el.videoWidth,
      height: el.videoHeight,
      muted: el.muted,
    }));
    expect(metadata.duration).toBeGreaterThan(2);
    expect(metadata.duration).toBeLessThan(15);
    expect(metadata.width).toBeGreaterThan(500);
    expect(metadata.height).toBeGreaterThan(300);
    expect(metadata.muted).toBe(true);
    expect(
      await page
        .locator("video")
        .evaluateAll((elements) => elements.filter((el) => !el.paused).length),
    ).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test("reduced motion keeps posters until explicitly played and a live preference change stops playback", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  const figure = demo(page),
    video = figure.locator("video");
  await figure.scrollIntoViewIfNeeded();
  await expect(video).not.toHaveAttribute("src", /.+/);
  await expect(figure.locator("img")).toBeVisible();
  await figure.getByRole("button").click();
  await expect(video).toHaveAttribute("data-ready", "");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => video.evaluate((el) => el.paused)).toBe(true);
  await expect(video).not.toHaveAttribute("data-ready", "");
  expect(
    await figure.evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

for (const connection of [
  { saveData: true, effectiveType: "4g" },
  { saveData: false, effectiveType: "2g" },
])
  test(`data-saving connection ${JSON.stringify(connection)} does not auto-load videos`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => Object.defineProperty(navigator, "connection", { value }),
      connection,
    );
    await setup(page);
    const figure = demo(page);
    await figure.scrollIntoViewIfNeeded();
    await expect(figure.locator("video")).not.toHaveAttribute("src", /.+/);
    await figure.getByRole("button").click();
    await expect(figure.locator("video")).toHaveAttribute("data-ready", "");
  });

test("video errors preserve the real poster and a retry actually reloads the source", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let fail = true;
  await page.route("**/assets/demos/library.mp4", (route) =>
    fail ? route.abort() : route.continue(),
  );
  await setup(page);
  const figure = demo(page),
    button = figure.getByRole("button");
  await figure.scrollIntoViewIfNeeded();
  await button.click();
  await expect(button).toHaveAccessibleName("Retry Library demonstration");
  await expect(figure.locator(".demo-feedback")).toBeVisible();
  await expect(figure.locator("img")).toBeVisible();
  await expect(figure.locator("video")).not.toHaveAttribute("data-ready", "");
  fail = false;
  await button.click();
  await expect(figure.locator("video")).toHaveAttribute("data-ready", "");
  await expect(figure.locator(".demo-feedback")).toBeHidden();
});

test("blocked autoplay offers manual play, not a false broken-media message", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!navigator.userActivation.isActive)
        return Promise.reject(
          new DOMException("Autoplay blocked", "NotAllowedError"),
        );
      return play.call(this);
    };
  });
  await setup(page);
  const figure = demo(page);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure.getByRole("button")).toHaveAccessibleName(
    "Play Library demonstration",
  );
  await expect(figure.locator(".demo-feedback")).toBeHidden();
  await figure.getByRole("button").click();
  await expect(figure.locator("video")).toHaveAttribute("data-ready", "");
});

test("without JavaScript every poster, workflow link and compatibility disclosure still works", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:19600/");
  for (const name of ["library", "dig", "plan", "mix"]) {
    const figure = demo(page, name);
    await figure.scrollIntoViewIfNeeded();
    await expect(figure.locator("img")).toBeVisible();
    await expect(figure.getByRole("button")).toHaveCount(0);
    await expect(figure.locator("video")).not.toHaveAttribute("src", /.+/);
  }
  await page.locator("#compatibility summary").click();
  await expect(page.locator("#compatibility")).toHaveAttribute("open", "");
  await context.close();
});

test("compatibility anchor opens the disclosure and keeps hardware claims qualified", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("link", { name: "Read the compatibility notes" })
    .click();
  await expect(page.locator("#compatibility")).toHaveAttribute("open", "");
  await expect(page.locator("#compatibility")).toContainText("CDJ-900");
  await expect(page.locator("#compatibility")).toContainText(
    "not certification for every CDJ",
  );
  await page.reload();
  await expect(page.locator("#compatibility")).toHaveAttribute("open", "");
});

test("posters reserve their actual aspect ratio and hosting serves local video/image MIME types", async ({
  page,
  request,
}) => {
  await setup(page);
  for (const img of await page.locator("img[src$='.webp']").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    const dimensions = await img.evaluate((el) => ({
      width: el.naturalWidth,
      height: el.naturalHeight,
      w: Number(el.width),
      h: Number(el.height),
      declaredWidth: Number(el.getAttribute("width")),
      declaredHeight: Number(el.getAttribute("height")),
      picture: el.parentElement.tagName === "PICTURE",
    }));
    if (!dimensions.picture) {
      expect(dimensions.width).toBe(dimensions.declaredWidth);
      expect(dimensions.height).toBe(dimensions.declaredHeight);
    }
  }
  for (const [path, mime] of [
    ["/assets/demos/library.mp4", "video/mp4"],
    ["/assets/screenshots/hero-focus.webp", "image/webp"],
  ]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain(mime);
  }
  expect(
    (await request.get("/")).headers()["content-security-policy"],
  ).toContain("media-src 'self'");
  const range = await request.get("/assets/demos/library.mp4", {
    headers: { Range: "bytes=0-31" },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(32);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-31\//);
  expect(
    (
      await request.get("/assets/demos/library.mp4", {
        headers: { Range: "bytes=999999999-" },
      })
    ).status(),
  ).toBe(416);
});
