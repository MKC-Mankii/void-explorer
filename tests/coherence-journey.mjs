import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = 'test-results/coherence/journey';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ??
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
  errors = [],
  trace = [],
  shots = [],
  qualityChecks = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const snapshot = () => page.evaluate(() => window.__VOID__.snapshot());
async function shot(name, s) {
  await page.screenshot({ path: `${out}/${name}.png` });
  const state = s ?? (await snapshot());
  shots.push({ name, snapshot: state });
  console.log(`CAPTURE ${name}: ${state.mode}, ${Math.round(state.altitude * 10)} m above surface`);
}
async function keyUntil(code, predicate, timeout = 120000) {
  await page.keyboard.down(code);
  try {
    await page.waitForFunction(predicate, undefined, { timeout });
  } finally {
    await page.keyboard.up(code);
  }
}
try {
  await page.goto((process.env.VOID_URL ?? 'http://127.0.0.1:5173') + '/?test=1');
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  await page.locator('[data-action=settings]').click();
  for (const [quality, steps] of [
    ['medium', 3],
    ['high', 6],
    ['low', 2],
  ]) {
    await page.locator('#quality-setting').selectOption(quality);
    const frame = (await snapshot()).rendering.frames;
    await page.waitForFunction((f) => window.__VOID__.snapshot().rendering.frames >= f + 3, frame, {
      timeout: 60000,
    });
    const s = await snapshot();
    assert.equal(s.rendering.environment.samples, steps);
    assert.equal(s.quality, quality);
    qualityChecks.push({ quality, steps, rendering: s.rendering });
  }
  await page.setViewportSize({ width: 960, height: 600 });
  let frame = (await snapshot()).rendering.frames;
  await page.waitForFunction((f) => window.__VOID__.snapshot().rendering.frames >= f + 3, frame, {
    timeout: 60000,
  });
  assert.deepEqual((await snapshot()).rendering.viewport, [960, 600]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-action=close]').click();
  await page.locator('[data-action=start]').click();
  assert.equal((await snapshot()).scenario, 'player');
  await shot('01-space');
  // Every transition uses normal player inputs. No fixtures, pose injection, freeze or step API.
  const start = (await snapshot()).playTime;
  await page.keyboard.down('KeyW');
  await page.waitForFunction((t) => window.__VOID__.snapshot().playTime > t + 1, start, {
    timeout: 30000,
  });
  await page.keyboard.up('KeyW');
  await keyUntil('KeyX', () => window.__VOID__.snapshot().actualSpeed < 0.5);
  // Observe every rendered frame in the page. PNG readback occurs in the same RAF as
  // its snapshot, avoiding screenshot RPC latency skipping short altitude bands.
  await page.evaluate(() => {
    const observed = { active: true, frames: [], images: [], captured: new Set(), handle: 0 };
    window.__coherenceObserver = observed;
    const observe = () => {
      if (!observed.active) return;
      const s = window.__VOID__.snapshot();
      observed.frames.push({
        mode: s.mode,
        scenario: s.scenario,
        position: s.position,
        altitude: s.altitude,
        playTime: s.playTime,
        camera: s.camera,
        rendering: {
          ready: s.rendering.ready,
          environment: s.rendering.environment,
          terrain: s.rendering.terrain,
          drawCalls: s.rendering.drawCalls,
          triangles: s.rendering.triangles,
          frames: s.rendering.frames,
          lastFrameMs: s.rendering.lastFrameMs,
        },
      });
      if (s.mode === 'landing' && s.rendering.ready) {
        const air = s.rendering.environment.planets.find((p) => p.id === s.nearest.id),
          h = air.radialAltitude;
        const name =
          h > air.height
            ? '02-approach'
            : h > air.height * 0.55
              ? '03-air'
              : s.altitude > 20
                ? '04-low'
                : '05-ground-approach';
        if (!observed.captured.has(name)) {
          observed.captured.add(name);
          const canvas = document.querySelector('#universe');
          observed.images.push({
            name,
            snapshot: s,
            png: canvas.toDataURL('image/png'),
            size: [canvas.width, canvas.height],
          });
        }
      }
      observed.handle = requestAnimationFrame(observe);
    };
    observed.handle = requestAnimationFrame(observe);
  });
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landing');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landed', undefined, {
    timeout: 240000,
  });
  const recorded = await page.evaluate(() => {
    const o = window.__coherenceObserver;
    o.active = false;
    cancelAnimationFrame(o.handle);
    return { frames: o.frames, images: o.images };
  });
  trace.push(...recorded.frames);
  const captured = new Set();
  for (const image of recorded.images) {
    captured.add(image.name);
    const bytes = Buffer.from(image.png.split(',')[1], 'base64');
    assert(bytes.length > 20000);
    await writeFile(`${out}/${image.name}.png`, bytes);
    shots.push({
      name: image.name,
      snapshot: image.snapshot,
      size: image.size,
      capture:
        'Actual game canvas readback immediately after its rendered frame; no HUD, no freeze',
    });
    console.log(
      `CAPTURE ${image.name}: ${Math.round(image.snapshot.altitude * 10)} m (same-frame canvas)`,
    );
  }
  await shot('06-landed');
  await page.waitForFunction(
    () =>
      window.__VOID__
        .snapshot()
        .rendering.terrain.every((t) => t.queued === 0 && t.transitioning === 0),
    undefined,
    { timeout: 90000 },
  );
  const probe = await page.evaluate(() => window.__VOID__.probeTerrain());
  assert(probe.renderedRadius !== null);
  assert(Math.abs(probe.renderedRadius - probe.collisionRadius) < 0.09);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'walking');
  const walkStart = await snapshot();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    (t) => window.__VOID__.snapshot().playTime > t + 1,
    walkStart.playTime,
    { timeout: 30000 },
  );
  await page.keyboard.up('KeyW');
  assert((await snapshot()).position.some((v, i) => Math.abs(v - walkStart.position[i]) > 0.01));
  await page.keyboard.press('KeyF');
  await shot('07-walking');
  await page.keyboard.press('Escape'); // Pause saves through the normal game action.
  const saved = await snapshot();
  await page.reload();
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  await page.locator('[data-action=start]').click();
  assert.equal((await snapshot()).mode, 'walking');
  assert.equal((await snapshot()).score, saved.score);
  await shot('08-restored');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landed');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'flight', undefined, {
    timeout: 90000,
  });
  await shot('09-takeoff');
  // Real lift through the same atmosphere into space, using the flight controls.
  await keyUntil(
    'Space',
    () => {
      const s = window.__VOID__.snapshot(),
        air = s.rendering.environment.planets.find((p) => p.id === s.nearest.id);
      return air.radialAltitude > air.height + 25;
    },
    120000,
  );
  await shot('10-exit-air');
  await keyUntil('KeyX', () => window.__VOID__.snapshot().actualSpeed < 0.5);
  assert(trace.every((s) => s.scenario === 'player' && s.rendering.ready));
  assert(trace.some((s) => s.rendering.terrain.some((t) => t.transitioning > 0)));
  assert(trace.every((s) => s.rendering.terrain.every((t) => t.generatedLastFrame <= 8)));
  for (const band of ['02-approach', '03-air', '04-low', '05-ground-approach'])
    assert(captured.has(band), `missing ${band}`);
  const normalFinal = await snapshot(),
    coast = [];
  // A separate diagnostic starts at a fixed sea location, then uses real continuous W/Space.
  // It supplements the normal journey above; it is not evidence of player travel to this start.
  await page.evaluate(() => window.__VOID__.scenario('coherence-water'));
  await page.waitForFunction(() => window.__VOID__.snapshot().rendering.ready);
  const coastStart = await snapshot();
  coast.push(coastStart);
  await shot('11-coast-start');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  for (const t of [3, 6, 9]) {
    await page.waitForFunction((t) => window.__VOID__.snapshot().playTime > t, t, {
      timeout: 90000,
    });
    coast.push(await snapshot());
    await shot(`12-coast-${t}`);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  const coastEnd = await snapshot();
  assert(Math.hypot(...coastEnd.position.map((v, i) => v - coastStart.position[i])) > 100);
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        renderer: 'ANGLE SwiftShader software',
        method:
          'Normal journey: fresh player start, W/X, L continuous auto-descent, E, actual W walk, F, Escape save/reload, E, Space takeoff/lift, X; no fixtures or stepping. Separate coastal diagnostic: coherence-water fixture then real W/Space, no stepping.',
        normalFinal,
        coast,
        probe,
        qualityChecks,
        trace,
        shots,
        errors,
        final: await snapshot(),
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS normal continuous exploration/return journey, all qualities/resize, and separately seeded real coastal flight',
  );
} catch (e) {
  await shot('failure');
  await writeFile(
    `${out}/failure.json`,
    JSON.stringify({ error: String(e), trace, shots, errors, final: await snapshot() }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
