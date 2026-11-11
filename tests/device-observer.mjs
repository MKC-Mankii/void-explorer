import { finishWithEvidence } from './failure-evidence.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { deviceBrowser, installGLCounters } from './device-browser.mjs';
// A bounded, read-only recorder for a real 30–60 minute human exploration session.
// It never selects fixtures, freezes the simulation, steps time, or generates inputs.
const minutes = Number(process.env.VOID_SOAK_MINUTES ?? 30);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60)
  throw new Error('Choose 1–60 minutes; only >=30 qualifies as long exploration.');
process.env.VOID_HEADED = '1';
const out = process.env.VOID_REPORT_DIR ?? 'test-results/engineering-03/device-exploration';
await mkdir(out, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  requestedMinutes: minutes,
  status: 'recording',
  samples: [],
  errors: [],
};
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
  const page = await browser.newPage({ viewport: null });
  await page.addInitScript(installGLCounters);
  page.on('pageerror', (e) => report.errors.push(e.stack));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  await page.goto(`${process.env.VOID_URL ?? 'http://127.0.0.1:5173'}/?test=1`);
  console.log(
    'Play normally in the opened isolated browser. Follow docs/ENGINEERING-03.md. Results checkpoint every 10 seconds.',
  );
  const start = Date.now();
  while (Date.now() - start < minutes * 60000 && !page.isClosed()) {
    const sample = await page.evaluate(() =>
      window.__VOID__
        ? {
            snapshot: window.__VOID__.snapshot(),
            gl: window.__glCounters,
            heap: performance.memory?.usedJSHeapSize ?? null,
            visibility: document.visibilityState,
          }
        : null,
    );
    report.samples.push({ elapsedMs: Date.now() - start, ...sample });
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  report.elapsedMs = Date.now() - start;
  report.status = report.errors.length
    ? 'errors-recorded'
    : 'recording-complete-not-manually-accepted';
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
