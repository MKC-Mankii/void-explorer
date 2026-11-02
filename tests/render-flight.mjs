import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
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
  trace = [];
let sampling = true;
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const snapshot = () => page.evaluate(() => window.__VOID__.snapshot());
let task = Promise.resolve();
try {
  await mkdir('test-results/round3', { recursive: true });
  await page.goto((process.env.VOID_URL ?? 'http://127.0.0.1:5173') + '/?test=1');
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  await page.locator('[data-action=settings]').click();
  await page.locator('#quality-setting').selectOption('low');
  await page.locator('[data-action=close]').click();
  await page.locator('[data-action=start]').click();
  const start = await snapshot();
  assert.equal(start.scenario, 'player');
  task = (async () => {
    while (sampling) {
      trace.push(await snapshot());
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landing');
  await page.waitForFunction((t) => window.__VOID__.snapshot().playTime - t > 6, start.playTime, {
    timeout: 60000,
  });
  await page.screenshot({ path: 'test-results/round3/real-descent.png' });
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landed', undefined, {
    timeout: 120000,
  });
  await page.screenshot({ path: 'test-results/round3/real-landed.png' });
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
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'landed');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__VOID__.snapshot().mode === 'flight', undefined, {
    timeout: 60000,
  });
  sampling = false;
  await task;
  assert(trace.length > 10);
  assert(trace.some((s) => s.rendering.terrain.some((t) => t.transitioning > 0)));
  assert(trace.every((s) => s.rendering.terrain.every((t) => t.generatedLastFrame <= 8)));
  assert.deepEqual(errors, []);
  await writeFile(
    'test-results/round3/real-flight-report.json',
    JSON.stringify(
      {
        browser: await browser.version(),
        quality: 'low',
        method:
          'Fresh player spawn; real L landing, E disembark/reboard and Space takeoff, no fixture placement or simulated time stepping',
        probe,
        trace,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS real-time descent, continuous terrain coverage, morph budget, ground clearance, disembark, reboard and takeoff',
  );
} catch (e) {
  sampling = false;
  await task.catch(() => {});
  await page.screenshot({ path: 'test-results/round3/real-flight-failure.png' });
  await writeFile(
    'test-results/round3/real-flight-failure.json',
    JSON.stringify({ error: String(e), final: await snapshot(), trace, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
