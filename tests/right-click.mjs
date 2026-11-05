import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = 'test-results/right-click';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ??
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  checks = [],
  observations = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const state = () => page.evaluate(() => window.__VOID__.snapshot());
const check = async (name) => {
  checks.push(name);
  observations.push({ name, state: await state() });
  console.log('PASS', name);
};
const selectOther = async () => {
  assert.equal((await state()).target, 0);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__VOID__.snapshot().target === 1);
};
try {
  await page.goto(`${process.env.VOID_URL ?? 'http://127.0.0.1:5173'}/?test=1`);
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  await page.locator('[data-action=settings]').click();
  await page.locator('#quality-setting').selectOption('low');
  await page.locator('[data-action=close]').click();
  await page.locator('[data-action=start]').click();
  await selectOther();
  await page.mouse.click(150, 400, { button: 'right' });
  assert.equal((await state()).target, 1);
  assert.match(await page.locator('#notification').textContent(), /鼠标下没有/);
  await check(
    'Free cursor clicking empty sky does not select the planet under the central reticle',
  );
  const start = (await state()).targeting.attempts;
  await page.locator('[data-action=lock][data-value="0"]').click({ button: 'right' });
  await page.waitForFunction(() => window.__VOID__.snapshot().target === 0);
  assert.equal((await state()).targeting.attempts, start + 1);
  assert.equal((await state()).input.pointerLocked, false);
  await check('Right-clicking a planet label selects once, without requiring mouse capture');
  await selectOther();
  await page.mouse.click(815, 350, { button: 'right' });
  await page.waitForFunction(() => window.__VOID__.snapshot().target === 0);
  assert.equal((await state()).input.pointerLocked, false);
  await check('Free cursor right-click uses the actual planet pixel, beyond its HUD label');
  await selectOther();
  await page.waitForTimeout(800);
  // Explicit platform fallback injection; the normal mouse cases above/below
  // use real browser input, and are not replaced with synthetic DOM events.
  await page.evaluate(() =>
    document.querySelector('#universe').dispatchEvent(
      new MouseEvent('contextmenu', {
        button: 2,
        clientX: 815,
        clientY: 350,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await page.waitForFunction(() => window.__VOID__.snapshot().target === 0);
  assert.equal((await state()).targeting.lastAttempt.input, 'contextmenu');
  await check('A contextmenu-only platform event can lock a visible planet');
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => window.__VOID__.snapshot().input.pointerLocked);
  await selectOther();
  await page.waitForFunction(() =>
    document.querySelector('#lock-candidate').textContent.includes('VESPER'),
  );
  await page.screenshot({ path: `${out}/candidate.png` });
  const before = (await state()).targeting.attempts;
  await page.mouse.click(640, 400, { button: 'right' });
  await page.waitForFunction(() => window.__VOID__.snapshot().target === 0);
  assert.equal((await state()).targeting.attempts, before + 1);
  assert((await state()).input.pointerLocked);
  assert.equal((await state()).modal, null);
  assert.equal(await page.locator('#target-name').textContent(), 'VESPER');
  await check(
    'Captured real right-click locks the reticle candidate once and immediately updates the panel',
  );
  await selectOther();
  await page.keyboard.down('Control');
  await page.mouse.click(640, 400);
  await page.keyboard.up('Control');
  await page.waitForFunction(() => window.__VOID__.snapshot().target === 0);
  assert((await state()).input.pointerLocked);
  await check('Captured Control-click secondary gesture locks the reticle target');
  await selectOther();
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => window.__VOID__.snapshot().target === 0);
  await page.keyboard.press('KeyV');
  assert.match(await page.locator('#notification').textContent(), /已确认当前目标 VESPER/);
  await page.screenshot({ path: `${out}/locked.png` });
  await check(
    'V locks the reticle target and reconfirming the same planet gives explicit feedback',
  );
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(
    () => window.__VOID__.snapshot().targeting.reticleCandidate === null,
    undefined,
    { timeout: 20000 },
  );
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('KeyV');
  assert.equal((await state()).target, 0);
  assert.match(await page.locator('#notification').textContent(), /准星下没有/);
  await check('Looking away gives a miss message and preserves the selected destination');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__VOID__.snapshot().modal === 'pause');
  const paused = (await state()).targeting.attempts;
  await page.keyboard.press('KeyV');
  assert.equal((await state()).targeting.attempts, paused);
  await check('Paused keyboard input cannot change the navigation target');
  await page.locator('[data-action=resume]').click();
  await page.keyboard.press('KeyL');
  // Explicit grounded fixture for eligibility feedback, separate from the
  // normal-spawn mouse journey. Actual descent is covered by existing suites.
  await page.evaluate(() => window.__VOID__.step(14));
  assert.equal((await state()).mode, 'landed');
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => window.__VOID__.snapshot().input.pointerLocked);
  await page.mouse.click(640, 400, { button: 'right' });
  assert.match(await page.locator('#notification').textContent(), /先.*起飞/);
  assert.equal((await state()).mode, 'landed');
  await check(
    'Captured mouse on a landed ship explains Space takeoff instead of silently ignoring lock',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        method:
          'Normal spawn and real keyboard/mouse/pointer capture; one explicitly labeled contextmenu-only fallback injection.',
        checks,
        observations,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  await writeFile(
    `${out}/failure.json`,
    JSON.stringify(
      { error: String(error), observations, final: await state().catch(() => null), errors },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  await browser.close();
}
