import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Vector3, Quaternion } from 'three';
import assert from 'node:assert/strict';

const base = process.env.VOID_URL ?? 'http://127.0.0.1:5173';
const out = 'test-results/aurora';
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
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [],
  checks = [],
  phases = [],
  captures = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('requestfailed', (r) => errors.push(`Request failed: ${r.url()}`));
const snapshot = () => page.evaluate(() => window.__VOID__.snapshot());
const observe = async (tag) => {
  const state = await snapshot();
  phases.push({ tag, state });
  return state;
};
const check = (name) => {
  checks.push(name);
  console.log('PASS', name);
};
const shot = async (name, photo = false) => {
  if (photo) await page.keyboard.press('KeyP');
  const frame = (await snapshot()).rendering.frames;
  await page.waitForFunction((f) => window.__VOID__.snapshot().rendering.frames > f + 2, frame, {
    timeout: 30000,
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  if (photo) await page.keyboard.press('KeyP');
};
try {
  // Negative load scenario is explicitly separate from the normal player journey.
  const broken = await browser.newPage();
  await broken.route('**/*.glb', (route) =>
    route.fulfill({ status: 200, body: 'invalid glTF asset' }),
  );
  await broken.goto(`${base}/?test=1`);
  await broken.waitForFunction(() => window.__VOID__?.snapshot().ship.state === 'error');
  assert(await broken.locator('#start-button').isDisabled());
  assert((await broken.locator('#start-button').textContent()).includes('加载失败'));
  assert.equal(await broken.evaluate(() => window.__VOID__.snapshot().rendering.ready), false);
  await broken.close();
  check('Invalid GLB is observable and blocks start with a recovery message; no old-ship fallback');

  const glbResponse = page.waitForResponse((r) => r.url().endsWith('.glb'));
  await page.goto(`${base}/?test=1`);
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  const response = await glbResponse;
  assert.equal(response.status(), 200);
  const deliveredHash = createHash('sha256')
    .update(await response.body())
    .digest('hex');
  assert.equal(
    deliveredHash,
    createHash('sha256')
      .update(await readFile('assets/aurora/aurora.glb'))
      .digest('hex'),
  );
  const loaded = await observe('loaded-normal-spawn');
  assert.equal(loaded.scenario, 'player');
  assert.equal(loaded.ship.wings.length, 4);
  assert.equal(loaded.ship.engines.length, 2);
  assert.equal(loaded.ship.rendered, true);
  assert(loaded.ship.sizeMetres[0] > 18.5 && loaded.ship.sizeMetres[0] < 18.7);
  assert.equal(loaded.ship.textures, 0);
  check('Normal player spawn loads the exact Blender GLB with four wings and two engines');

  await page.locator('[data-action=settings]').click();
  await page.locator('#quality-setting').selectOption('low');
  await page.locator('[data-action=close]').click();
  await page.locator('[data-action=start]').click();
  // The welcome screen has its own render-only pose. Validate the flight contract
  // after the real start action, once the original simulation pose has rendered.
  const startFrame = (await snapshot()).rendering.frames;
  await page.waitForFunction(
    (frame) => window.__VOID__.snapshot().rendering.frames > frame + 1,
    startFrame,
  );
  const spawned = await observe('started-normal-spawn');
  assert.equal(spawned.opening.active, false);
  assert.deepEqual(spawned.position, loaded.position);
  assert.deepEqual(spawned.rotation, loaded.rotation);
  for (const plume of spawned.ship.plumes) {
    assert(
      new Vector3().fromArray(plume.direction).dot(new Vector3().fromArray(spawned.forward)) <
        -0.99,
    );
  }
  await page.keyboard.press('KeyF');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__VOID__.snapshot().speed > 30);
  await page.keyboard.up('KeyW');
  await shot('real-flight');
  await page.keyboard.down('KeyX');
  await page.waitForFunction(() => window.__VOID__.snapshot().actualSpeed < 0.03, undefined, {
    timeout: 30000,
  });
  await page.keyboard.up('KeyX');
  await page.keyboard.press('KeyC');
  await page.waitForFunction(() => {
    const s = window.__VOID__.snapshot();
    return s.cockpit && !s.ship.visible;
  });
  const cockpit = await observe('real-cockpit');
  assert.equal(cockpit.ship.visible, false);
  const localEye = new Vector3()
    .fromArray(cockpit.camera.position)
    .sub(new Vector3().fromArray(cockpit.position))
    .applyQuaternion(new Quaternion().fromArray(cockpit.rotation).invert());
  assert(localEye.distanceTo(new Vector3().fromArray(cockpit.ship.cockpitOffset)) < 0.01);
  await shot('real-cockpit');
  await page.keyboard.press('KeyC');
  check('Real W/X input and C camera switch use the loaded model and actual cockpit mount');

  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landing');
  const landing = await observe('real-landing-start');
  await page.waitForFunction((t) => window.__VOID__.snapshot().playTime > t + 6, landing.playTime, {
    timeout: 90000,
  });
  await shot('real-descent');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landed', undefined, {
    timeout: 150000,
  });
  const landed = await observe('real-landed');
  assert(landed.ship.gearExtension > 0.99);
  assert(landed.ship.groundClearances.every((h) => Math.abs(h) < 0.025));
  assert(landed.ship.plumes.every((p) => !p.visible));
  await shot('real-landed');
  await shot('real-landed-photo', true);
  await page.keyboard.press('KeyC');
  await page.waitForFunction(() => {
    const state = window.__VOID__.snapshot();
    return state.cockpit && !state.ship.visible;
  });
  const groundCockpit = await observe('real-ground-cockpit');
  const groundEye = new Vector3()
    .fromArray(groundCockpit.camera.position)
    .sub(new Vector3().fromArray(groundCockpit.position))
    .applyQuaternion(new Quaternion().fromArray(groundCockpit.rotation).invert());
  assert(groundEye.distanceTo(new Vector3().fromArray(groundCockpit.ship.cockpitOffset)) < 0.03);
  await page.keyboard.press('KeyC');
  check('Real-time L descent lands on four adapted gear contacts with plumes off');

  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'walking');
  const outside = await observe('real-port-disembark');
  const local = new Vector3()
    .fromArray(outside.position)
    .sub(new Vector3().fromArray(landed.position))
    .applyQuaternion(new Quaternion().fromArray(landed.rotation).invert());
  assert(Math.abs(local.x + 0.325) < 0.025);
  assert(Math.abs(outside.altitude - 0.18) < 0.025);
  await shot('real-disembark');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    (t) => window.__VOID__.snapshot().playTime > t + 1.4,
    outside.playTime,
    { timeout: 30000 },
  );
  await page.keyboard.up('KeyW');
  const blocked = await observe('real-hull-guard');
  const guarded = new Vector3()
    .fromArray(blocked.position)
    .sub(new Vector3().fromArray(landed.position))
    .applyQuaternion(new Quaternion().fromArray(landed.rotation).invert());
  assert(guarded.x < -0.1);
  await page.keyboard.press('KeyF');
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(() => localStorage.getItem('void-explorer-save-v1'));
  assert.equal(JSON.parse(saved).mode, 'walking');
  await page.reload();
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  const restored = await observe('restored-walking');
  assert.equal(restored.mode, 'walking');
  await page.locator('[data-action=start]').click();
  const continuedFrame = (await snapshot()).rendering.frames;
  await page.waitForFunction(
    (frame) => window.__VOID__.snapshot().rendering.frames > frame + 1,
    continuedFrame,
  );
  const continued = await observe('continued-walking');
  assert.equal(continued.opening.active, false);
  assert.equal(continued.mode, 'walking');
  assert(continued.ship.gearExtension > 0.99);
  assert(continued.ship.plumes.every((plume) => !plume.visible));
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landed');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'flight', undefined, {
    timeout: 90000,
  });
  await page.waitForFunction(
    () => window.__VOID__.snapshot().ship.gearExtension < 0.01,
    undefined,
    { timeout: 20000 },
  );
  const takeoff = await observe('real-takeoff');
  assert(takeoff.ship.plumes.every((p) => p.visible));
  await shot('real-takeoff');
  check(
    'Port exit, real walking hull guard, sampling, saved walking reload, E boarding and real takeoff succeed',
  );

  // The remaining images are explicitly labeled fixed-pose inspection, not flown arrivals.
  await page.keyboard.press('Escape');
  await page.locator('#modal-root [data-action=settings]').click();
  await page.locator('#quality-setting').selectOption('medium');
  await page.locator('[data-action=close]').click();
  await page.evaluate(() => window.__VOID__.freeze(true));
  await page.evaluate(() => window.__VOID__.scenario('render-orbit'));
  for (const view of ['top', 'front', 'port', 'quarter', 'rear']) {
    await page.evaluate((v) => window.__VOID__.shipView(v), view);
    const warmupFrame = (await snapshot()).rendering.frames;
    await page.waitForFunction(
      (f) => window.__VOID__.snapshot().rendering.frames >= f + 14,
      warmupFrame,
      { timeout: 60000 },
    );
    await shot(`game-${view}`, true);
    const state = await observe(`fixture-inspection-${view}`);
    const timings = state.rendering.performanceSamples.slice(-8);
    captures.push({
      view,
      state,
      medianRafMs: [...timings.map((t) => t.frameMs)].sort((a, b) => a - b)[4],
    });
  }
  await page.evaluate(() => {
    window.__VOID__.shipView(null);
    window.__VOID__.scenario('render-atmosphere');
  });
  await shot('game-atmosphere');
  await page.evaluate(() => window.__VOID__.scenario('render-surface'));
  await shot('game-surface');
  check('Five asset views plus atmosphere and surface captured in the actual game renderer');
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        backend: 'WebGL2 / forced ANGLE SwiftShader software',
        performanceCaution:
          'RAF/CPU observations are cloud software results, not desktop GPU frame-time acceptance. Inspection views have different scene coverage and are not controlled performance comparisons.',
        glbSha256: deliveredHash,
        checks,
        phases,
        captures,
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await writeFile(
    `${out}/failure.json`,
    JSON.stringify(
      { error: String(error), phases, final: await snapshot().catch(() => null), errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
