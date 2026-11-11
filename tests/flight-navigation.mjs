import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { assertAlignmentBound } from './navigation-observation.mjs';
import { failWithEvidence } from './failure-evidence.mjs';

const base = process.env.VOID_URL ?? 'http://127.0.0.1:5173';
const output = 'test-results/round2';
await mkdir(output, { recursive: true });
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
  checks = [],
  actions = [],
  observations = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const snapshot = () => page.evaluate(() => window.__VOID__.snapshot());
const observe = async (label) => {
  const state = await snapshot();
  observations.push({ label, wallTime: Date.now(), state });
  return state;
};
const press = async (code) => {
  actions.push({ type: 'keyboard', code, wallTime: Date.now() });
  await page.keyboard.press(code);
};
const check = (name) => {
  checks.push(name);
  console.log('PASS', name);
};
const screenshot = async (name) => {
  const before = await snapshot();
  await page.waitForFunction(
    (frame) => window.__VOID__.snapshot().rendering.frames > frame,
    before.rendering.frames,
    { timeout: 20000 },
  );
  await page.screenshot({ path: `${output}/${name}.png` });
  await observe(name);
};
let tracing = false,
  traceTask = Promise.resolve();
let selectionBound = null,
  failed = false;
try {
  await page.goto(`${base}/?test=1`);
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  await page.locator('[data-action=settings]').click();
  await page.locator('#quality-setting').selectOption('low');
  await page.locator('[data-action=close]').click();
  await page.locator('[data-action=start]').click();
  assert.equal((await snapshot()).scenario, 'player');
  check('Normal player route begins at the real fresh-game spawn');
  await press('Tab');
  assert.equal((await snapshot()).target, 1);
  actions.push({ type: 'mouse', button: 'right', purpose: 'reticle lock' });
  await page.mouse.click(640, 400, { button: 'right' });
  assert.equal((await snapshot()).target, 0);
  check('Right mouse locks the actual planet under the camera reticle');
  await press('KeyM');
  actions.push({ type: 'star-map', target: 'PYRA' });
  const guideTurnRate = await page.evaluate(
    async () => (await import('/src/navigation.ts')).FLIGHT.guideTurnRate,
  );
  const beforeMap = await observe('map-before');
  await page.locator('[data-action=navigate][data-value="1"]').click();
  const chosen = await observe('map-selected');
  assert.equal(chosen.target, 1);
  assert.equal(chosen.navigation.guidance, 'align');
  selectionBound = assertAlignmentBound(beforeMap, chosen, guideTurnRate);
  await press('KeyF');
  assert.equal((await snapshot()).score, 0);
  assert.match(await page.locator('#notification').textContent(), /PYRA/);
  check(
    'Star-map selection starts bounded steering; scanning cannot silently hit a different planet',
  );
  await screenshot('navigation-departure');
  tracing = true;
  traceTask = (async () => {
    while (tracing) {
      await observe('player-route-sample');
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  await press('KeyG');
  await page.waitForFunction(() => window.__VOID__.snapshot().actualSpeed > 700, undefined, {
    timeout: 60000,
  });
  await screenshot('navigation-midflight');
  const middle = await snapshot();
  assert(middle.navigation.distance < chosen.navigation.distance);
  // AURORA is 18 m long; the chase rig moved from the old ~170 m offset to
  // ~47 m. Keep checking a usable, stable distance against the loaded ship.
  const shipLengths =
    middle.camera.shipDistance / (middle.ship.sizeMetres[2] * middle.ship.scaleToGame);
  assert(shipLengths > 2.4 && shipLengths < 2.8);
  await page.waitForFunction(
    () => window.__VOID__.snapshot().navigation.status === 'arrived',
    undefined,
    { timeout: 180000 },
  );
  tracing = false;
  await traceTask;
  const arrived = await observe('player-arrived');
  assert.equal(arrived.scenario, 'player');
  assert.equal(arrived.nearest.id, '0-1');
  assert.equal(arrived.navigation.guidance, 'off');
  assert(arrived.navigation.distance > arrived.navigation.arrivalClearance - 80);
  assert(arrived.navigation.distance < arrived.navigation.arrivalClearance + 60);
  assert(arrived.actualSpeed < 3);
  const path = observations.filter((o) => o.label === 'player-route-sample').map((o) => o.state);
  assert(path.length > 12);
  assert(Math.max(...path.map((s) => s.actualSpeed)) > 1000);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      travel = Math.hypot(...b.position.map((v, j) => v - a.position[j]));
    assert(travel <= 2200 * (b.playTime - a.playTime) + 1, 'continuous speed-bounded movement');
    assert(
      b.camera.shipDistance > 4.5 && b.camera.shipDistance < 5,
      'camera remains at the AURORA chase distance during high-speed travel',
    );
    assert(b.camera.shipProjection.onScreen, 'ship remains visible in the chase camera');
  }
  assert(Math.hypot(...arrived.position.map((v, i) => v - chosen.position[i])) > 20000);
  check(
    'Real-time player flight travels continuously to PYRA and brakes to a stable near-space arrival',
  );
  await screenshot('navigation-arrival');
  await press('KeyF');
  assert((await snapshot()).discoveries['0-1'].scan);
  assert.equal((await snapshot()).discoveries['0-0'], undefined);
  check('Actual arrival and selected-body orbital scan agree');
  await press('Escape');
  const saved = await snapshot();
  await page.reload();
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  const loaded = await snapshot();
  assert.equal(loaded.target, 1);
  assert.deepEqual(loaded.position, saved.position);
  assert.deepEqual(loaded.velocity, saved.velocity);
  assert.equal(loaded.speed, saved.speed);
  await page.locator('[data-action=start]').click();
  check('Reload preserves the selected destination and real flight velocity');
  const stored = await page.evaluate(() => localStorage.getItem('void-explorer-save-v1'));
  // The remaining checks are explicit fixtures, kept separate from the player journey above.
  await page.evaluate(() => window.__VOID__.scenario('high-speed'));
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const boosted = await observe('fixture-high-speed');
  assert(boosted.input.keys.includes('KeyW'));
  assert(boosted.input.keys.includes('ShiftLeft'));
  await page.keyboard.up('ShiftLeft');
  await page.waitForFunction((t) => window.__VOID__.snapshot().playTime > t, boosted.playTime);
  const released = await observe('fixture-boost-release');
  assert(released.input.keys.includes('KeyW'));
  assert(released.speed > 320);
  assert(boosted.speed - released.speed <= 160 * (released.playTime - boosted.playTime) + 1);
  await page.keyboard.up('KeyW');
  check('Boost release with W held is acceleration-bounded rather than an instant speed clamp');
  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyX');
  await page.waitForFunction(() => window.__VOID__.snapshot().actualSpeed < 0.03, undefined, {
    timeout: 40000,
  });
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyX');
  check('Real X input stops lateral as well as forward motion');
  const newScene = await page.evaluate(() => window.__VOID__.scenario('behind'));
  assert.equal(newScene.rendering.ready, false);
  await page.waitForFunction(() => window.__VOID__.snapshot().rendering.ready);
  const painted = await snapshot();
  assert.equal(painted.rendering.sceneGeneration, painted.rendering.renderedScene);
  assert.equal(painted.playTime, painted.rendering.simulationTime);
  check('A loaded scene becomes ready only after its current pose has actually rendered');
  await screenshot('navigation-behind');
  assert.match(await page.locator('#offscreen').textContent(), /后半球/);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(
    () => window.__VOID__.snapshot().navigation.headingError < 78,
    undefined,
    { timeout: 20000 },
  );
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction(() =>
    window.__VOID__.snapshot().angularVelocity.every((v) => Math.abs(v) < 0.01),
  );
  assert.match(await page.locator('#offscreen').textContent(), /视野边缘/);
  await screenshot('navigation-front-edge');
  check('Real steering updates front/rear direction cues and ship-relative radar');
  await page.evaluate(() => window.__VOID__.scenario('occluded'));
  await press('KeyG');
  assert.equal((await snapshot()).navigation.status, 'blocked');
  assert.equal((await snapshot()).navigation.blockedBy, 'VESPER');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__VOID__.snapshot().speed > 1);
  await page.keyboard.up('KeyW');
  assert.equal((await snapshot()).navigation.status, 'manual');
  await screenshot('navigation-occluded');
  check('Occluded route is explained, and manual controls can take over');
  await page.evaluate(() => window.__VOID__.scenario('transfer'));
  await press('KeyG');
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => window.__VOID__.snapshot().input.pointerLocked);
  await page.mouse.move(700, 415);
  await page.waitForFunction(() => window.__VOID__.snapshot().navigation.guidance === 'off');
  assert.equal((await snapshot()).navigation.status, 'manual');
  await press('Escape');
  await page.locator('[data-action=resume]').click();
  check('Real pointer-locked mouse steering immediately takes over from cruise');
  await page.evaluate(() => window.__VOID__.scenario('approach'));
  await press('KeyG');
  await page.waitForFunction(
    () => window.__VOID__.snapshot().navigation.status === 'arrived',
    undefined,
    { timeout: 60000 },
  );
  const approach = await observe('fixture-approach-arrived');
  assert(approach.altitude > 350);
  assert(approach.actualSpeed < 3);
  check('Reproducible high-speed approach brakes above the surface using real time and inputs');
  assert.equal(await page.evaluate(() => localStorage.getItem('void-explorer-save-v1')), stored);
  check('Diagnostic scenes do not overwrite the player save');
  await page.evaluate(() => {
    const s = window.__VOID__.snapshot();
    s.position[0] = 999999;
  });
  assert.notEqual((await snapshot()).position[0], 999999);
  assert.equal(await page.evaluate(() => window.__VOID__.sim), undefined);
  check('State observation returns detached copies without exposing live game internals');
  assert.deepEqual(errors, []);
  check('No JavaScript or console errors');
  await writeFile(
    `${output}/navigation-report.json`,
    JSON.stringify(
      {
        schemaVersion: 2,
        browser: await browser.version(),
        renderer: 'Chromium/SwiftShader',
        playerJourney:
          'fresh spawn → star map → G cruise → PYRA near-space arrival → scan → reload; no scenario placement or simulated stepping',
        fixtureChecks:
          'high-speed, behind, occluded, approach; real keyboard and rendering after named setup',
        checks,
        actions,
        observations,
        selectionBound,
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  failed = true;
  tracing = false;
  await traceTask.catch(() => {});
  await failWithEvidence(error, {
    context: { actions, observations, selectionBound },
    checks,
    errors,
    snapshot,
    screenshot: async () => {
      const path = `${output}/navigation-failure.png`;
      await page.screenshot({ path, timeout: 5000 });
      return path;
    },
    writeReport: (report) =>
      writeFile(`${output}/navigation-failure.json`, JSON.stringify(report, null, 2)),
  });
} finally {
  try {
    await browser.close();
  } catch (error) {
    console.error('Additional browser cleanup failure:', error);
    if (!failed) throw error;
  }
}
