// Real HTTP/disk-cache regression. Uses only an owned temporary browser/library
// profile; never clears the user's WebView cache or touches their music/settings.
// Validation uses the tested DLL; production smoke uses the installed executable.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '../src/Wisp.Client/node_modules/playwright/index.mjs';

const { values } = parseArgs({ options: {
  app: { type: 'string' },
  'web-root': { type: 'string' },
  'data-root': { type: 'string' },
} });
assert(values.app && values['data-root'], '--app and --data-root are required');
const appPath = path.resolve(values.app);
const webRoot = path.resolve(values['web-root'] ?? path.join(path.dirname(appPath), 'wwwroot'));
const currentHtml = await readFile(path.join(webRoot, 'index.html'), 'utf8');
const dataRoot = path.resolve(values['data-root']);
await mkdir(dataRoot, { recursive: true });
const testRoot = await mkdtemp(path.join(dataRoot, 'cache-upgrade-'));
const libraryProfile = path.join(testRoot, 'library');
await mkdir(libraryProfile);
await writeFile(path.join(libraryProfile, 'config.json'), JSON.stringify({
  Catalog: { Soulseek: { Url: 'http://127.0.0.1:1', ApiKey: '', ManageSlskd: false } },
}));
const browserProfile = path.join(testRoot, 'browser');
const oldHtml = '<!doctype html><html><body><h1 id="old-wisp">Old WISP UI fixture</h1></body></html>';
let rootRequests = 0;
const fixture = createServer((request, response) => {
  if (request.url === '/') {
    rootRequests++;
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=86400' });
    response.end(oldHtml);
  } else { response.writeHead(404); response.end(); }
});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
const origin = `http://127.0.0.1:${fixture.address().port}`;
let context;
let child;
let appOutput = '';
let spawnError;
const openBrowser = () => chromium.launchPersistentContext(browserProfile, { headless: true });
const closeFixture = () => new Promise((resolve, reject) => {
  if (!fixture.listening) return resolve();
  fixture.close(error => error ? reject(error) : resolve());
  fixture.closeAllConnections();
});

async function healthyApp() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`WISP exited: ${child.exitCode}\n${appOutput}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const health = await response.json();
        if (health.status === 'ok') return health;
      }
    } catch { /* startup/migrations can briefly take time */ }
    await delay(500);
  }
  throw new Error(`WISP did not become healthy\n${appOutput}`);
}

try {
  context = await openBrowser();
  let page = await context.newPage();
  await page.goto(`${origin}/`);
  assert.equal(await page.locator('#old-wisp').count(), 1);
  await page.evaluate(() => localStorage.setItem('wisp-upgrade-test-draft', 'preserve me'));
  // Closing/reopening the browser forces reuse of the on-disk HTTP cache,
  // matching a subsequent desktop application launch rather than a reload.
  await context.close();
  context = await openBrowser();
  page = await context.newPage();
  await page.goto(`${origin}/`);
  assert.equal(await page.locator('#old-wisp').count(), 1);
  assert.equal(rootRequests, 1, 'Fixture must be served from disk cache on second launch');
  await closeFixture();

  const args = ['--Wisp:LaunchPhotino=false', '--urls', origin];
  if (values['web-root']) args.push('--webroot', webRoot);
  const isDll = appPath.toLowerCase().endsWith('.dll');
  child = spawn(isDll ? 'dotnet' : appPath, isDll ? [appPath, ...args] : args, {
    cwd: testRoot,
    windowsHide: true,
    env: { ...process.env, WISP_DATA_DIR: libraryProfile, DOTNET_ENVIRONMENT: 'Production', ASPNETCORE_ENVIRONMENT: 'Production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', data => { appOutput = (appOutput + data.toString()).slice(-16000); });
  }
  const health = await healthyApp();
  const launchUrl = new URL(health.uiLaunchUrl);
  assert.equal(launchUrl.origin, origin, 'Upgrade must retain the origin and local storage');
  assert(launchUrl.searchParams.get('wisp-ui'), 'Launch must carry the assembly release identity');

  await page.goto('about:blank');
  await page.goto(`${origin}/`);
  assert.equal(await page.locator('#old-wisp').count(), 1,
    'Control must reproduce stale HTML even after the new application has started');

  const htmlRequests = [];
  page.on('request', request => { if (request.isNavigationRequest()) htmlRequests.push(request.url()); });
  const response = await page.goto(launchUrl.href);
  assert(response.ok());
  assert.match(response.headers()['cache-control'], /no-store/);
  assert.equal(await response.text(), currentHtml);
  await page.locator('.app-sidebar').waitFor();
  assert.equal(await page.locator('#old-wisp').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('wisp-upgrade-test-draft')), 'preserve me');
  await readFile(path.join(libraryProfile, 'wisp.db')); // application really initialized
  await context.close();
  context = await openBrowser();
  page = await context.newPage();
  const repeat = await page.goto(launchUrl.href);
  assert.equal(await repeat.text(), currentHtml);
  assert.match(repeat.headers()['cache-control'], /no-store/);
  await page.locator('.app-sidebar').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('wisp-upgrade-test-draft')), 'preserve me');
  console.log('PASS: stale cached UI reproduced; release-key launch serves current UI; subsequent launch stays fresh; browser preferences preserved.');
  console.log(JSON.stringify({ version: health.version, launchUrl: launchUrl.href, fixtureRootRequests: rootRequests, htmlRequests, testRoot }));
} catch (error) {
  if (appOutput) console.error(appOutput);
  throw error;
} finally {
  await context?.close();
  await closeFixture();
  if (child && child.exitCode === null && !spawnError) {
    const exited = once(child, 'exit');
    child.kill(); // only the process created by this test
    await exited;
  }
}
