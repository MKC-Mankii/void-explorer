import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const coherence = process.env.VOID_VISUAL_SUITE === 'coherence';
const suite = coherence ? 'coherence' : 'round3';
const base = process.env.VOID_URL ?? 'http://127.0.0.1:5173',
  stage = process.env.VOID_VISUAL_STAGE ?? 'after',
  out = `test-results/${suite}/${stage}`;
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
  if (m.type() === 'error') {
    errors.push(m.text());
    console.error(m.text());
  }
});
const scenes = coherence
  ? [
      'coherence-orbit',
      'coherence-air-out',
      'coherence-air-in',
      'coherence-cloud-out',
      'coherence-cloud-in',
      'coherence-coast',
      'coherence-water',
      'coherence-ground',
      'coherence-night',
      'coherence-dry',
    ]
  : [
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
      (frame) => window.__VOID__.snapshot().rendering.frames >= frame,
      start.rendering.frames + (coherence ? 30 : 12),
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
  if (stage === 'after' && existsSync(`test-results/${suite}/before/report.json`)) {
    const before = JSON.parse(await readFile(`test-results/${suite}/before/report.json`, 'utf8'));
    for (const result of results) {
      const b = before.results.find((s) => s.scene === result.scene);
      assert.deepEqual(result.snapshot.position, b.snapshot.position);
      assert.deepEqual(result.snapshot.rotation, b.snapshot.rotation);
      assert.deepEqual(result.snapshot.camera.position, b.snapshot.camera.position);
      assert.deepEqual(result.snapshot.camera.rotation, b.snapshot.camera.rotation);
      assert(Math.abs(result.snapshot.rendering.fov - b.snapshot.rendering.fov) < 1e-7);
    }
  }
  let boundaryDelta = null;
  if (coherence) {
    const pngs = await Promise.all(
      ['out', 'in'].map(async (side) =>
        (await readFile(`${out}/coherence-air-${side}.png`)).toString('base64'),
      ),
    );
    boundaryDelta = await page.evaluate(async (pngs) => {
      const canvas = document.createElement('canvas');
      canvas.width = 930;
      canvas.height = 95;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }),
        pixels = [];
      for (const png of pngs) {
        const bitmap = await createImageBitmap(
          await (await fetch('data:image/png;base64,' + png)).blob(),
        );
        ctx.drawImage(bitmap, 70, 555, 930, 95, 0, 0, 930, 95);
        pixels.push(ctx.getImageData(0, 0, 930, 95).data);
        bitmap.close();
      }
      let total = 0;
      for (let i = 0; i < pixels[0].length; i++)
        if (i % 4 !== 3) total += Math.abs(pixels[0][i] - pixels[1][i]);
      return { region: [70, 555, 930, 95], meanAbsoluteRgb: total / (930 * 95 * 3), scale: 255 };
    }, pngs);
    if (stage === 'after')
      assert(
        boundaryDelta.meanAbsoluteRgb < 12,
        `atmosphere boundary surface pop: ${boundaryDelta.meanAbsoluteRgb}`,
      );
  }
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        stage,
        boundaryDelta,
        browser: await browser.version(),
        renderer: 'Chromium / ANGLE SwiftShader (forced software)',
        viewport: [1280, 800],
        quality: 'medium',
        sampling: `Frozen deterministic poses, ${coherence ? 30 : 12} warmup frames, last 8 samples; CPU/submission and RAF timing, not hardware GPU timings`,
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
