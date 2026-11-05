import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const url = process.env.VOID_PRODUCTION_URL ?? 'http://127.0.0.1:4173/';
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
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('requestfailed', (r) => errors.push(`Request failed: ${r.url()}`));
try {
  const assetResponse = page.waitForResponse((response) => response.url().endsWith('.glb'));
  await page.goto(`${url}?test=1&scenario=approach`);
  const model = await assetResponse;
  assert.equal(model.status(), 200);
  const glbSha256 = createHash('sha256')
    .update(await model.body())
    .digest('hex');
  assert.equal(
    glbSha256,
    createHash('sha256')
      .update(await readFile('assets/aurora/aurora.glb'))
      .digest('hex'),
  );
  await page.waitForSelector('#start-button');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => typeof window.__VOID__), 'undefined');
  assert.equal(await page.locator('#target-name').textContent(), 'VESPER');
  assert((await page.locator('.idle-footer').textContent()).includes('AURORA'));
  await page.locator('[data-action=start]').click();
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('#target-name').textContent === 'PYRA');
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => document.querySelector('#target-name').textContent === 'VESPER');
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('#target-name').textContent === 'PYRA');
  await page.mouse.click(640, 400, { button: 'right' });
  await page.waitForFunction(() => document.querySelector('#target-name').textContent === 'VESPER');
  assert(await page.evaluate(() => !!document.pointerLockElement));
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => document.querySelector('#score').textContent === '0100');
  await page.keyboard.press('KeyG');
  await page.waitForSelector('#cruise-button.engaged');
  // Braking is sampled by the flight update. A zero-duration press can fall
  // entirely between rendered frames on software graphics; hold until observed.
  await page.keyboard.down('KeyX');
  await page.waitForFunction(
    () => !document.querySelector('#cruise-button').classList.contains('engaged'),
  );
  await page.keyboard.up('KeyX');
  await page.keyboard.press('KeyM');
  await page.waitForSelector('.map-modal');
  await mkdir('test-results/round2', { recursive: true });
  await page.screenshot({ path: 'test-results/round2/production.png' });
  assert.deepEqual(errors, []);
  const checks = [
    'Production WebGL scene renders',
    'Delivered Blender GLB matches the source export SHA-256',
    'AURORA identity shown in the production interface',
    'V selects the reticle planet in the production build',
    'Captured right-click selects the planet without losing mouse capture',
    'Development API absent',
    'Scenario query ignored by production',
    'Selected-body scan awards score',
    'G cruise engages and real X takes over',
    'Star map opens',
    'No failed requests or JavaScript/console errors',
  ];
  await writeFile(
    'test-results/round2/production-report.json',
    JSON.stringify({ url, browser: await browser.version(), glbSha256, checks, errors }, null, 2),
  );
  checks.forEach((c) => console.log('PASS', c));
} finally {
  await browser.close();
}
