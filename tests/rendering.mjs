import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.VOID_URL ?? 'http://127.0.0.1:5173',
  stage = process.env.VOID_VISUAL_STAGE ?? 'after',
  out = `test-results/round3/${stage}`;
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
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  }),
  errors = [],
  results = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const scenes = [
  'render-orbit',
  'render-terminator',
  'render-night',
  'render-desert',
  'render-near',
  'render-atmosphere',
  'render-surface',
  'render-cruise',
];
const percentile = (a, p) =>
  [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
try {
  await page.goto(`${base}/?test=1`);
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready);
  await page.locator('[data-action=start]').click();
  await page.evaluate(() => window.__VOID__.freeze(true));
  // Hide animation and status text only; the game canvas and actual render path remain untouched.
  await page.addStyleTag({ content: '#fps,#notification{visibility:hidden!important}' });
  for (const scene of scenes) {
    await page.evaluate((name) => window.__VOID__.scenario(name), scene);
    await page.evaluate(() => window.__VOID__.step(0));
    await page.waitForFunction(() => window.__VOID__.snapshot().rendering.ready);
    const start = await page.evaluate(() => window.__VOID__.snapshot());
    await page.waitForFunction(
      (frame) => window.__VOID__.snapshot().rendering.frames >= frame + 12,
      start.rendering.frames,
      { timeout: 60000 },
    );
    const snapshot = await page.evaluate(() => window.__VOID__.snapshot());
    assert.deepEqual(snapshot.position, start.position);
    assert.equal(snapshot.playTime, start.playTime);
    assert.equal(snapshot.quality, 'medium');
    assert.equal(snapshot.rendering.pixelRatio, 1);
    assert(snapshot.rendering.drawCalls > 0);
    assert(snapshot.rendering.triangles > 0);
    const samples = snapshot.rendering.performanceSamples.slice(-8);
    await page.screenshot({ path: `${out}/${scene}.png` });
    results.push({
      scene,
      snapshot,
      performance: {
        samples: samples.length,
        rafMedianMs: percentile(
          samples.map((s) => s.frameMs),
          0.5,
        ),
        rafP95Ms: percentile(
          samples.map((s) => s.frameMs),
          0.95,
        ),
        updateMedianMs: percentile(
          samples.map((s) => s.updateMs),
          0.5,
        ),
        submissionMedianMs: percentile(
          samples.map((s) => s.submissionMs),
          0.5,
        ),
      },
    });
    console.log(
      `PASS ${stage} ${scene}: ${Math.round(results.at(-1).performance.rafMedianMs)} ms/frame (software renderer)`,
    );
  }
  assert.deepEqual(errors, []);
  if (stage === 'after' && existsSync('test-results/round3/before/report.json')) {
    const before = JSON.parse(await readFile('test-results/round3/before/report.json', 'utf8'));
    for (const result of results) {
      const b = before.results.find((s) => s.scene === result.scene);
      assert.deepEqual(result.snapshot.position, b.snapshot.position);
      assert.deepEqual(result.snapshot.rotation, b.snapshot.rotation);
      assert(Math.abs(result.snapshot.rendering.fov - b.snapshot.rendering.fov) < 1e-7);
    }
  }
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        stage,
        browser: await browser.version(),
        renderer: 'Chromium / ANGLE SwiftShader (forced software)',
        viewport: [1280, 800],
        quality: 'medium',
        sampling:
          'Frozen deterministic poses, 12 warmup frames, last 8 samples; CPU/submission and RAF timing, not hardware GPU timings',
        results,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
