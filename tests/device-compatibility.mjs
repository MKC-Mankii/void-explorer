import { finishWithEvidence } from './failure-evidence.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deviceBrowser } from './device-browser.mjs';
const out = process.env.VOID_REPORT_DIR ?? 'test-results/engineering-03/compatibility';
await mkdir(out, { recursive: true });
const report = { status: 'running', checks: [], errors: [], expectedAssetErrors: [], devices: [] };
let browser;
let originalFailure = null;
try {
  const launched = await deviceBrowser();
  browser = launched.browser;
  report.browser = {
    name: launched.name,
    version: await browser.version(),
    forcedSoftware: launched.software,
  };
  for (const dpr of [1, 1.5, 2]) {
    const page = await browser.newPage({
      viewport: { width: 960, height: 600 },
      deviceScaleFactor: dpr,
    });
    page.on('pageerror', (e) => report.errors.push(e.stack));
    page.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(m.text());
    });
    await page.addInitScript(() => {
      window.__audioContexts = [];
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        constructor(...args) {
          super(...args);
          window.__audioContexts.push(this);
        }
      };
    });
    await page.goto(`${process.env.VOID_URL ?? 'http://127.0.0.1:5173'}/?test=1`);
    await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
      timeout: 120000,
    });
    await page.locator('[data-action=start]').click();
    await page.evaluate(() => window.__VOID__.freeze(true));
    const audio = await page.evaluate(() => window.__audioContexts.map((c) => c.state));
    assert(audio.includes('running'), 'user gesture did not unlock AudioContext');
    await page.locator('[data-action=settings]').click();
    for (const quality of ['low', 'medium', 'high']) {
      await page.locator('#quality-setting').selectOption(quality);
      for (const viewport of [
        { width: 960, height: 600 },
        { width: 1280, height: 800 },
      ]) {
        await page.setViewportSize(viewport);
        const f = await page.evaluate(() => window.__VOID__.snapshot().rendering.frames);
        await page.waitForFunction((f) => window.__VOID__.snapshot().rendering.frames >= f + 3, f, {
          timeout: 120000,
        });
        const s = await page.evaluate(() => window.__VOID__.snapshot());
        assert.deepEqual(s.rendering.viewport, [viewport.width, viewport.height]);
        assert.equal(
          s.rendering.pixelRatio,
          quality === 'low' ? 0.75 : quality === 'medium' ? Math.min(dpr, 1.35) : dpr,
        );
        assert(s.rendering.drawCalls > 0);
        report.devices.push({ dpr, quality, viewport, rendering: s.rendering, audio });
      }
    }
    await page.locator('[data-action=close]').click();
    await page.mouse.click(640, 400);
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.mouse.click(640, 400, { button: 'right' });
    assert(await page.evaluate(() => !!document.pointerLockElement));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.pointerLockElement);
    // Browser-level blur event tests key cleanup. Actual OS focus/Control-click still
    // require the physical-device checklist; synthetic events are not that evidence.
    await page.evaluate(() => dispatchEvent(new Event('blur')));
    report.checks.push(
      `DPR ${dpr}: quality, resize, audio unlock, pointer capture/release, right click, blur handler`,
    );
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', (e) => report.errors.push(e.stack));
  await page.goto(`${process.env.VOID_URL ?? 'http://127.0.0.1:5173'}/?test=1`);
  await page.locator('[data-action=start]').click();
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__VOID__.snapshot().score === 100);
  const supported = await page.evaluate(() => {
    const gl = document.querySelector('#universe').getContext('webgl2');
    const lose = gl.getExtension('WEBGL_lose_context');
    if (!lose) return false;
    lose.loseContext();
    return true;
  });
  assert(supported, 'WEBGL_lose_context unavailable: loss recovery not tested');
  await page.waitForFunction(() =>
    document.querySelector('#notification')?.textContent.includes('图形设备连接中断'),
  );
  await page.reload();
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => window.__VOID__.snapshot().score), 100);
  report.checks.push(
    'context loss: stops render loop; refresh restores scene and progress (no automatic live restoration claimed)',
  );
  await page.close();
  const failure = await browser.newPage({ viewport: { width: 960, height: 600 } });
  failure.on('pageerror', (e) => report.errors.push(e.stack));
  failure.on('console', (m) => {
    if (m.type() === 'error') report.expectedAssetErrors.push(m.text());
  });
  await failure.route('**/*.glb', (route) => route.abort('failed'));
  await failure.goto(`${process.env.VOID_URL ?? 'http://127.0.0.1:5173'}/?test=1`);
  await failure.waitForFunction(() =>
    document.querySelector('#start-button')?.textContent.includes('加载失败'),
  );
  assert(await failure.locator('#start-button').isDisabled());
  await failure.unroute('**/*.glb');
  await failure.reload();
  await failure.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
    timeout: 120000,
  });
  assert(!(await failure.locator('#start-button').isDisabled()));
  report.checks.push(
    'GLB network failure blocks start with recovery text; reload after network recovery succeeds',
  );
  await failure.close();
  assert(report.expectedAssetErrors.length > 0);
  assert(report.expectedAssetErrors.every((message) => message.includes('net::ERR_FAILED')));
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
  console.log('PASS', report.checks);
} catch (error) {
  originalFailure = error;
  report.status = 'failed';
  report.failure = error.stack;
  throw error;
} finally {
  await finishWithEvidence(
    originalFailure,
    () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)),
    async () => browser?.close(),
  );
}
