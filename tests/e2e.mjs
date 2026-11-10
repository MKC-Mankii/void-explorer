import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { failWithEvidence } from './failure-evidence.mjs';
const base = process.env.VOID_URL ?? 'http://127.0.0.1:5173';
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
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
const snapshot = () => page.evaluate(() => window.__VOID__.snapshot());
const check = (name) => {
  checks.push(name);
  console.log('PASS', name);
};
const step = (seconds) => page.evaluate((s) => window.__VOID__.step(s), seconds);
const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test-results/${name}.png` });
};
let failed = false;
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(`${base}/?test=1`);
  await page.waitForFunction(() => window.__VOID__);
  await shot('01-title');
  assert.equal((await snapshot()).mode, 'flight');
  check('WebGL scene boots');
  await page.getByRole('button', { name: '开始航行' }).click();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  assert.equal((await snapshot()).score, 100);
  check('Keyboard orbital scan awards discovery once');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__VOID__.snapshot().speed > 20, undefined, {
    timeout: 20000,
  });
  await page.keyboard.up('KeyW');
  const accelerated = await page.evaluate(() => window.__VOID__.snapshot().speed);
  assert(accelerated > 0);
  await page.keyboard.down('KeyX');
  await page.waitForFunction(
    (speed) => window.__VOID__.snapshot().speed < speed * 0.3,
    accelerated,
    {
      timeout: 20000,
    },
  );
  await page.keyboard.up('KeyX');
  assert((await page.evaluate(() => window.__VOID__.snapshot().speed)) < accelerated);
  check('Throttle and inertial brake respond to real keyboard input');
  await page.keyboard.press('KeyL');
  assert.equal((await snapshot()).mode, 'landing');
  await step(6.5);
  await shot('02-descent');
  await step(7);
  assert.equal((await snapshot()).mode, 'landed');
  assert(Math.abs((await snapshot()).altitude - 0.61) < 0.05);
  await shot('03-landed');
  check('Landing reaches the shared terrain surface');
  await page.keyboard.press('KeyE');
  assert.equal((await snapshot()).mode, 'walking');
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  assert.equal((await snapshot()).score, 500);
  await shot('04-surface');
  check('Disembark and surface sampling complete the discovery loop');
  const before = await snapshot();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1400);
  await page.keyboard.up('KeyW');
  const after = await snapshot();
  assert.notDeepEqual(before.position, after.position);
  assert(Math.abs(after.altitude - 0.18) < 0.03);
  check('WASD walks on curved ground at astronaut eye height');
  await page.mouse.click(700, 450);
  await page.waitForTimeout(300);
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  assert(locked);
  const quat = await page.evaluate(() => window.__VOID__.snapshot().rotation);
  await page.mouse.move(760, 450);
  await page.waitForTimeout(600);
  assert.notDeepEqual(await page.evaluate(() => window.__VOID__.snapshot().rotation), quat);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal((await snapshot()).modal, 'pause');
  check('Pointer lock rotates view and Escape releases into pause');
  const paused = await snapshot();
  await page.waitForTimeout(500);
  assert.deepEqual((await snapshot()).position, paused.position);
  await page.getByRole('button', { name: '继续航行' }).click();
  await page.keyboard.press('KeyE');
  assert.equal((await snapshot()).mode, 'landed');
  await page.keyboard.press('Space');
  assert.equal((await snapshot()).mode, 'takeoff');
  await step(5.5);
  assert.equal((await snapshot()).mode, 'flight');
  check('Reboarding and takeoff return to free flight');
  await page.keyboard.press('KeyC');
  assert.equal((await snapshot()).cockpit, true);
  await shot('05-cockpit');
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyM');
  assert.equal((await snapshot()).modal, 'map');
  await shot('06-map');
  await page.locator('[data-action="navigate"][data-value="1"]').click();
  assert.equal((await snapshot()).modal, null);
  assert.equal(await page.evaluate(() => window.__VOID__.snapshot().target), 1);
  check('Star chart selects and aligns local destinations');
  await page.keyboard.press('KeyM');
  await page.locator('[data-action="map-select"][data-value="1"]').click();
  await page.locator('[data-action="jump"]').click();
  await page.waitForFunction(() => window.__VOID__.snapshot().system === 1, { timeout: 15000 });
  check('Hyperspace transfers into a separately generated system');
  await shot('07-new-system');
  await page.locator('[data-action="log"]').click();
  assert.equal(await page.locator('.log-card').count(), 15);
  assert.equal(await page.locator('.log-card.discovered').count(), 1);
  check('Journal retains discoveries across systems');
  await page.locator('[data-action="close"]').click();
  await page.locator('[data-action="settings"]').click();
  await page.locator('#quality-setting').selectOption('low');
  assert.equal((await snapshot()).quality, 'low');
  await page.locator('[data-action="close"]').click();
  await page.keyboard.press('KeyP');
  assert(await page.locator('#interface').evaluate((el) => el.classList.contains('photo-mode')));
  await page.keyboard.press('KeyP');
  check('Quality settings and photo mode are interactive');
  await page.keyboard.press('KeyM');
  await page.reload();
  await page.waitForFunction(() => window.__VOID__);
  await page.getByRole('button', { name: '继续旅程' }).click();
  assert.equal((await snapshot()).system, 1);
  assert.equal((await snapshot()).score, 500);
  assert.equal((await snapshot()).quality, 'low');
  check('Reload restores location, discoveries and preferences');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(500);
  assert(await page.locator('.telemetry').isVisible());
  const outside = await page.locator('.telemetry').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.right > innerWidth || r.bottom > innerHeight;
  });
  assert.equal(outside, false);
  check('Desktop HUD fits 1280 × 720');
  assert.deepEqual(errors, []);
  check('No JavaScript or browser console errors');
  await writeFile(
    'test-results/browser-report.json',
    JSON.stringify(
      {
        browser: await browser.version(),
        renderer: 'Chromium headless / SwiftShader',
        checks,
        errors,
        final: await snapshot(),
      },
      null,
      2,
    ),
  );
} catch (e) {
  failed = true;
  await failWithEvidence(e, {
    context: { url: base, renderer: 'Chromium headless / SwiftShader' },
    checks,
    errors,
    snapshot,
    screenshot: async () => {
      const path = 'test-results/failure.png';
      await page.screenshot({ path, timeout: 5000 });
      return path;
    },
    writeReport: (report) =>
      writeFile('test-results/browser-failure-report.json', JSON.stringify(report, null, 2)),
  });
} finally {
  try {
    await browser.close();
  } catch (error) {
    console.error('Additional browser cleanup failure:', error);
    if (!failed) throw error;
  }
}
