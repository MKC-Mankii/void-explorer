import { finishWithEvidence } from './failure-evidence.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deviceBrowser } from './device-browser.mjs';
const out = 'test-results/engineering-03/save-browser';
await mkdir(out, { recursive: true });
const report = { checks: [], errors: [], status: 'running' };
const { browser } = await deviceBrowser();
const url = process.env.VOID_URL ?? 'http://127.0.0.1:5173';
const key = 'void-explorer-save-v1';
let originalFailure = null;
try {
  const seedPage = await browser.newPage();
  await seedPage.goto(`${url}/?test=1`);
  const saved = await seedPage.evaluate(async () => {
    const { Simulation } = await import('/src/simulation.ts');
    const s = new Simulation();
    s.scan();
    return s.save();
  });
  await seedPage.close();
  const cases = [
    ['current', saved, 100],
    [
      'early-v1',
      Object.fromEntries(
        Object.entries(saved).filter(([k]) => !['velocity', 'speed', 'target'].includes(k)),
      ),
      100,
    ],
    ['missing-transform', { ...saved, shipPosition: undefined, shipRotation: undefined }, 100],
    ['unknown-system', { ...saved, system: 999 }, 100],
    ['contradictory-walking', { ...saved, mode: 'walking', landedPlanet: null }, 100],
    ['invalid-json', '{broken', 0],
    ['future-version', { ...saved, version: 9 }, 0],
  ];
  for (const [name, value, score] of cases) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', (e) => report.errors.push(e.stack));
    await page.goto(`${url}/?test=1`);
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
    await page.reload();
    await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
      timeout: 120000,
    });
    assert.equal(await page.evaluate(() => window.__VOID__.snapshot().score), score);
    await page.locator('[data-action=start]').click();
    await page.reload(); // actual pagehide save, then another boot
    await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
      timeout: 120000,
    });
    assert.equal(await page.evaluate(() => window.__VOID__.snapshot().score), score);
    if (name === 'future-version')
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), raw);
    else if (name !== 'current')
      assert.equal(await page.evaluate((key) => localStorage.getItem(`${key}-recovery`), key), raw);
    await page.reload();
    await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
      timeout: 120000,
    });
    assert.equal(await page.evaluate(() => window.__VOID__.snapshot().score), score);
    report.checks.push(name);
    await page.close();
  }
  for (const operation of ['getItem', 'setItem']) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', (e) => report.errors.push(e.stack));
    await page.addInitScript((op) => {
      const original = Storage.prototype[op];
      Storage.prototype[op] = function (key, ...rest) {
        if (key === 'void-explorer-save-v1') throw new DOMException('denied', 'SecurityError');
        return original.call(this, key, ...rest);
      };
    }, operation);
    await page.goto(`${url}/?test=1`);
    await page.locator('[data-action=start]').click();
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => window.__VOID__.snapshot().score === 100);
    await page.reload();
    await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
      timeout: 120000,
    });
    report.checks.push(`${operation}-failure-playable`);
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log('PASS', report.checks.join(', '));
} catch (error) {
  originalFailure = error;
  report.status = 'failed';
  report.failure = error.stack;
  throw error;
} finally {
  await finishWithEvidence(
    originalFailure,
    () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)),
    async () => browser.close(),
  );
}
