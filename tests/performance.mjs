import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { deviceBrowser, installGLCounters } from './device-browser.mjs';

const out = process.env.VOID_REPORT_DIR ?? 'test-results/engineering-03/performance';
await mkdir(out, { recursive: true });
const seconds = Number(process.env.VOID_SAMPLE_SECONDS ?? 30);
const repeats = Number(process.env.VOID_REPEATS ?? 2);
assert(seconds > 0 && seconds <= 60 && repeats >= 1 && repeats <= 10);
const scenes = (
  process.env.VOID_SCENES ??
  'coherence-orbit,coherence-air-out,coherence-air-in,coherence-cloud-out,coherence-cloud-in,coherence-coast,coherence-water,coherence-ground,coherence-night,coherence-dry'
).split(',');
const viewport = {
  width: Number(process.env.VOID_WIDTH ?? 960),
  height: Number(process.env.VOID_HEIGHT ?? 600),
};
const dpr = Number(process.env.VOID_DPR ?? 1);
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  status: 'running',
  source:
    process.env.VOID_SOURCE_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  host: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    logicalCPUs: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  },
  settings: { viewport, dpr, quality: 'medium', seconds, repeats, warmupFrames: 30 },
  limitations: [
    'RAF includes scheduling and software rendering; submission is CPU wall time, not GPU time.',
    'Heap is Chromium JS heap only; GL counters are API objects, not GPU memory.',
    'Fixed poses are fixtures, not flown journeys. Timing instrumentation is development-only.',
    'GPU timing not collected; no disjoint query results are claimed.',
  ],
  runs: [],
  errors: [],
};
const persist = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
function stats(values) {
  const a = [...values].sort((a, b) => a - b);
  const p = (n) => a[Math.min(a.length - 1, Math.ceil(a.length * n) - 1)];
  return { samples: a.length, median: p(0.5), p95: p(0.95), worst: a.at(-1), min: a[0] };
}
let browser;
try {
  const launched = await deviceBrowser();
  browser = launched.browser;
  report.browser = {
    name: launched.name,
    version: await browser.version(),
    forcedSoftware: launched.software,
    executable: launched.executablePath,
  };
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => report.errors.push(e.stack));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  await page.addInitScript(installGLCounters);
  await page.goto(`${process.env.VOID_URL ?? 'http://127.0.0.1:5173'}/?test=1`);
  await page.waitForFunction(() => window.__VOID__?.snapshot().rendering.ready, null, {
    timeout: 120000,
  });
  await page.locator('[data-action=start]').click();
  await page.evaluate(() => window.__VOID__.freeze(true));
  for (let repeat = 0; repeat < repeats; repeat++)
    for (const scene of scenes) {
      await page.evaluate((name) => {
        window.__VOID__.scenario(name);
        window.__VOID__.step(0);
      }, scene);
      const initial = await page.evaluate(() => window.__VOID__.snapshot().rendering.frames);
      await page.waitForFunction(
        (f) => window.__VOID__.snapshot().rendering.frames >= f + 30,
        initial,
        { timeout: 120000 },
      );
      const before = await page.evaluate(() => window.__VOID__.snapshot());
      const started = Date.now();
      const samples = await page.evaluate(async (seconds) => {
        window.__VOID__.beginSampling();
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return window.__VOID__.endSampling();
      }, seconds);
      const after = await page.evaluate(() => ({
        snapshot: window.__VOID__.snapshot(),
        heap: performance.memory
          ? {
              used: performance.memory.usedJSHeapSize,
              total: performance.memory.totalJSHeapSize,
              limit: performance.memory.jsHeapSizeLimit,
            }
          : null,
        gl: window.__glCounters,
      }));
      assert(samples.length > 0);
      assert.deepEqual(after.snapshot.position, before.position);
      assert.equal(after.snapshot.playTime, before.playTime);
      assert.equal(after.snapshot.quality, 'medium');
      const metrics = Object.fromEntries(
        ['frameMs', 'updateMs', 'simulationMs', 'sceneMs', 'submissionMs'].map((key) => [
          key,
          stats(samples.map((s) => s[key])),
        ]),
      );
      report.runs.push({
        scene,
        repeat,
        elapsedMs: Date.now() - started,
        metrics,
        gpuMs: null,
        before,
        after,
        samples,
      });
      report.device = after.snapshot.rendering.device;
      await persist();
      console.log(
        `PASS ${repeat + 1} ${scene}: n=${samples.length}, RAF median=${metrics.frameMs.median.toFixed(1)} p95=${metrics.frameMs.p95.toFixed(1)} ms`,
      );
    }
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack;
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await persist();
  await browser?.close();
}
