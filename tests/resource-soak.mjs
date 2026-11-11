import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deviceBrowser, installGLCounters } from './device-browser.mjs';

const out = process.env.VOID_REPORT_DIR ?? 'test-results/engineering-03/soak';
await mkdir(out, { recursive: true });
const rounds = Number(process.env.VOID_SOAK_ROUNDS ?? 6);
assert(Number.isInteger(rounds) && rounds >= 3 && rounds <= 100);
const started = Date.now();
const report = {
  startedAt: new Date().toISOString(),
  rounds,
  status: 'running',
  scope:
    'Short repeated lifecycle stress. Fixture placement and accelerated simulation steps; not real-time flight or long-term hardware acceptance.',
  stages: [],
  errors: [],
  samples: [],
};
let browser;
try {
  ({ browser } = await deviceBrowser());
  report.browser = await browser.version();
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => report.errors.push(e.stack));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  await page.addInitScript(installGLCounters);
  await page.goto(`${process.env.VOID_URL ?? 'http://127.0.0.1:5173'}/?test=1`);
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
    timeout: 120000,
  });
  await page.locator('[data-action=start]').click();
  await page.evaluate(() => window.__VOID__.freeze(true));
  async function settle(frames = 12) {
    const frame = await page.evaluate(() => window.__VOID__.snapshot().rendering.frames);
    await page.waitForFunction(
      (f) => window.__VOID__.snapshot().rendering.frames >= f + frames,
      frame,
      { timeout: 120000 },
    );
  }
  async function record(round, stage) {
    const sample = await page.evaluate(() => ({
      state: window.__VOID__.snapshot(),
      gl: window.__glCounters,
      heap: performance.memory?.usedJSHeapSize ?? null,
    }));
    report.stages.push({ round, stage, elapsedMs: Date.now() - started, ...sample });
    return sample;
  }
  for (let round = 0; round < rounds; round++) {
    for (const scene of [
      'coherence-orbit',
      'coherence-air-out',
      'coherence-air-in',
      'coherence-cloud-out',
      'coherence-cloud-in',
      'coherence-water',
      'coherence-coast',
      'coherence-dry',
    ]) {
      await page.evaluate((scene) => {
        window.__VOID__.scenario(scene);
        window.__VOID__.step(0);
      }, scene);
      await settle(3);
      await record(round, scene);
    }
    await page.evaluate(() => {
      window.__VOID__.scenario('departure');
      window.__VOID__.step(0);
    });
    await page.keyboard.press('KeyL');
    await page.evaluate(() => window.__VOID__.step(14));
    assert.equal(await page.evaluate(() => window.__VOID__.snapshot().mode), 'landed');
    await page.keyboard.press('KeyE');
    assert.equal(await page.evaluate(() => window.__VOID__.snapshot().mode), 'walking');
    await page.keyboard.press('KeyF');
    await settle(3);
    await record(round, 'sampled-walking');
    await page.keyboard.press('KeyE');
    await page.keyboard.press('Space');
    await page.evaluate(() => window.__VOID__.step(6));
    assert.equal(await page.evaluate(() => window.__VOID__.snapshot().mode), 'flight');
    for (const id of [1 + (round % 4), 0]) {
      await page.keyboard.press('KeyM');
      await page.locator(`[data-action=map-select][data-value="${id}"]`).click();
      await page.locator('[data-action=jump]').click();
      await page.waitForFunction(
        (id) => {
          const s = window.__VOID__.snapshot();
          return s.system === id && s.rendering.ready;
        },
        id,
        { timeout: 120000 },
      );
      await record(round, `jump-${id}`);
    }
    await page.locator('[data-action=settings]').click();
    for (const quality of ['high', 'low', 'medium']) {
      await page.locator('#quality-setting').selectOption(quality);
      await settle(3);
    }
    await page.setViewportSize({ width: 800, height: 500 });
    await settle(3);
    await page.setViewportSize({ width: 960, height: 600 });
    await page.locator('[data-action=close]').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.__VOID__.scenario('coherence-orbit');
      window.__VOID__.step(0);
    });
    await settle(30);
    const final = await record(round, 'settled-orbit');
    const r = final.state.rendering;
    report.samples.push({
      round,
      geometries: r.geometries,
      textures: r.textures,
      programs: r.programs,
      materials: r.materials,
      sceneObjects: r.sceneObjects,
      queued: r.terrain.reduce((n, t) => n + t.queued, 0),
      buffers: final.gl.Buffer.live,
      glTextures: final.gl.Texture.live,
      framebuffers: final.gl.Framebuffer.live,
      renderbuffers: final.gl.Renderbuffer.live,
      heap: final.heap,
      frameMs: r.lastFrameMs,
    });
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    console.log(`ROUND ${round + 1}/${rounds}`, JSON.stringify(report.samples.at(-1)));
  }
  // Compare equivalent settled states after a full warm cycle, not arbitrary transient peaks.
  for (const key of [
    'geometries',
    'textures',
    'programs',
    'materials',
    'sceneObjects',
    'queued',
    'buffers',
    'glTextures',
    'framebuffers',
    'renderbuffers',
  ]) {
    const values = report.samples.slice(1).map((s) => s[key]);
    assert(
      values.every((v) => v === values[0]),
      `${key} not stable after warmup: ${values}`,
    );
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack;
  throw error;
} finally {
  report.elapsedMs = Date.now() - started;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser?.close();
}
