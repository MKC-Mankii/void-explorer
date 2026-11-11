import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deviceBrowser, installGLCounters } from './device-browser.mjs';
import { finishWithEvidence } from './failure-evidence.mjs';

const url = process.env.VOID_URL ?? 'http://127.0.0.1:5173';
const out = 'test-results/product-polish-01';
await mkdir(out, { recursive: true });
const report = { url, status: 'running', checks: [], errors: [], captures: [], lifecycle: [] };
const { browser } = await deviceBrowser();
report.browser = await browser.version();
let failure = null;
const snapshot = (page) => page.evaluate(() => window.__VOID__.snapshot());
const ready = (page) =>
  page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
    timeout: 120000,
  });
async function frames(page, count = 5) {
  const start = (await snapshot(page)).rendering.frames;
  await page.waitForFunction(
    (n) => window.__VOID__.snapshot().rendering.frames >= n,
    start + count,
    { timeout: 120000 },
  );
}
const track = (page) => page.on('pageerror', (e) => report.errors.push(e.stack));
const check = (name) => {
  report.checks.push(name);
  console.log('PASS', name);
};
try {
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [1000, 700],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    track(page);
    const started = Date.now();
    await page.goto(`${url}/?test=1`);
    await ready(page);
    const readyMs = Date.now() - started;
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    const state = await snapshot(page);
    assert(state.opening.active && state.opening.reducedMotion);
    assert.equal(state.ship.wings.length, 4);
    assert.equal(state.ship.state, 'ready');
    const welcome = await page.locator('#welcome').boundingBox();
    const bounds = state.opening.bounds;
    assert(bounds.min[0] > (welcome.x + welcome.width) / width, 'ship must clear text column');
    assert(
      bounds.min[1] > 0.12 && bounds.max[0] < 0.98 && bounds.max[1] < 0.88,
      'ship must stay within safe frame',
    );
    for (const selector of [
      '#welcome h1',
      '#start-button',
      '.welcome [data-action=help]',
      '.topbar [data-action=settings]',
    ]) {
      const box = await page.locator(selector).boundingBox();
      assert(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width &&
          box.y + box.height <= height,
      );
    }
    await frames(page, 8);
    const later = await snapshot(page);
    assert.deepEqual(
      later.opening.bounds,
      state.opening.bounds,
      'reduced motion holds display pose',
    );
    assert.deepEqual(later.position, state.position, 'opening must not move simulation');
    assert.equal(later.playTime, state.playTime);
    await page.screenshot({ path: `${out}/${width}x${height}.png` });
    report.captures.push({ width, height, readyMs, state });
    check(`${width}x${height}: complete ship, readable controls, stable reduced-motion pose`);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  track(page);
  await page.addInitScript(installGLCounters);
  await page.goto(`${url}/?test=1`);
  await ready(page);
  await frames(page, 20);
  const initial = await snapshot(page);
  await frames(page, 8);
  assert.notDeepEqual((await snapshot(page)).opening.bounds, initial.opening.bounds);
  assert.deepEqual((await snapshot(page)).position, initial.position);
  check('subtle display motion leaves simulation untouched');
  const resources = async () =>
    page.evaluate(() => {
      const r = window.__VOID__.snapshot().rendering;
      return {
        geometries: r.geometries,
        textures: r.textures,
        programs: r.programs,
        sceneObjects: r.sceneObjects,
        gl: window.__glCounters,
        canvas: document.querySelectorAll('canvas').length,
      };
    });
  const stable = await resources();
  for (let i = 0; i < 6; i++) {
    await page.locator('.welcome [data-action=help]').click();
    await page.waitForSelector('.modal');
    assert.equal((await snapshot(page)).modal, 'help');
    await page.locator('.modal [data-action=close]').click();
    await page.locator('.topbar [data-action=settings]').click();
    await page.waitForSelector('#quality-setting');
    assert.equal(await page.locator('#quality-setting').inputValue(), 'medium');
    await page.locator('.modal [data-action=close]').click();
    await frames(page, 2);
    report.lifecycle.push(await resources());
  }
  assert.deepEqual(
    report.lifecycle.at(-1),
    stable,
    'opening menus must not create WebGL resources',
  );
  assert.equal(stable.canvas, 1);
  check('six guide/settings cycles: unchanged controls, one canvas, no resource growth');
  await page.locator('[data-action=start]').click();
  await frames(page, 3);
  const playing = await snapshot(page);
  assert.equal(playing.opening.active, false);
  assert.equal(playing.rendering.fov, 58);
  assert.deepEqual(playing.position, initial.position);
  assert.deepEqual(playing.rotation, initial.rotation);
  assert.equal(await page.locator('#welcome').isVisible(), false);
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__VOID__.snapshot().score === 100);
  await page.reload();
  await ready(page);
  assert.match(await page.locator('#start-button').textContent(), /继续旅程/);
  assert.equal((await snapshot(page)).score, 100);
  check('start restores original camera/pose; scan, reload and continue retain progress');
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await ready(page);
    await frames(page, 8);
    assert.equal((await snapshot(page)).score, 100);
    report.lifecycle.push({ reload: i, ...(await resources()) });
  }
  const reloads = report.lifecycle.slice(-3).map(({ reload, ...rest }) => rest);
  assert.deepEqual(reloads[0], reloads[1]);
  assert.deepEqual(reloads[1], reloads[2]);
  check('three real reloads: saved opening and resource counts remain stable');
  await page.close();
  const failed = await browser.newPage();
  await failed.route('**/*.glb', (route) => route.abort());
  await failed.goto(`${url}/?test=1`);
  await failed.waitForFunction(() =>
    document.querySelector('#start-button')?.textContent.includes('加载失败'),
  );
  assert(await failed.locator('#start-button').isDisabled());
  await failed.locator('.welcome [data-action=help]').click();
  await failed.waitForSelector('.modal');
  await failed.unroute('**/*.glb');
  await failed.reload();
  await ready(failed);
  assert(!(await failed.locator('#start-button').isDisabled()));
  check('required model failure retains clear error and guide; recovery reload works');
  await failed.close();
  const blocked = await browser.newPage();
  await blocked.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await blocked.goto(url);
  await blocked.waitForSelector('.fatal');
  assert.match(await blocked.locator('.fatal').textContent(), /WebGL 2/);
  assert(await blocked.locator('.fatal button').isVisible());
  check('WebGL unavailable: existing actionable fallback remains visible');
  await blocked.close();
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.failure = error.stack;
  throw error;
} finally {
  await finishWithEvidence(
    failure,
    () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)),
    () => browser.close(),
  );
}
