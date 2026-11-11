import { expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { failWithEvidence } from './failure-evidence.mjs';

it('preserves original identity, partial checks and snapshot when the screenshot fails', async () => {
  const original = new Error('original assertion');
  const screenshotError = new Error('screenshot timeout');
  const writeReport = vi.fn(),
    log = vi.fn();
  await expect(
    failWithEvidence(original, {
      checks: ['already passed'],
      errors: ['earlier console error'],
      snapshot: async () => ({ score: 100 }),
      screenshot: async () => {
        throw screenshotError;
      },
      writeReport,
      log,
    }),
  ).rejects.toBe(original);
  expect(log.mock.calls[0]).toEqual(['Original test failure:', original]);
  const report = writeReport.mock.calls[0][0];
  expect(report.checks).toEqual(['already passed']);
  expect(report.errors).toEqual(['earlier console error']);
  expect(report.final).toEqual({ score: 100 });
  expect(report.failure.stack).toBe(original.stack);
  expect(report.evidenceErrors).toEqual([
    expect.objectContaining({ stage: 'screenshot', stack: screenshotError.stack }),
  ]);
});

it('cannot replace the original failure even if reporting unexpectedly throws', async () => {
  const original = new Error('original assertion');
  await expect(
    failWithEvidence(original, {
      checks: [],
      errors: [],
      snapshot: async () => null,
      screenshot: async () => null,
      writeReport: async () => {
        throw new Error('report write failure');
      },
      log: vi.fn(),
    }),
  ).rejects.toBe(original);
});

for (const mode of ['screenshot', 'collectors', 'report']) {
  it(`exits nonzero with the original assertion when ${mode} collection fails`, async () => {
    const out = 'test-results/engineering-02/failure-injection';
    await mkdir(out, { recursive: true });
    const reportPath = `${out}/${mode}.json`;
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./fixtures/failure-evidence.mjs', import.meta.url)),
        mode,
        reportPath,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    await writeFile(`${out}/${mode}.stderr.log`, child.stderr ?? '');
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('EO04_ORIGINAL_ASSERTION');
    expect(child.stderr).toContain('EO04_SCREENSHOT_FAILURE');
    expect(child.stderr.indexOf('EO04_ORIGINAL_ASSERTION')).toBeLessThan(
      child.stderr.indexOf('EO04_SCREENSHOT_FAILURE'),
    );
    // Node's final uncaught exception must still be the assertion, not a collector error.
    expect(child.stderr).toMatch(
      /AssertionError \[ERR_ASSERTION\]: EO04_ORIGINAL_ASSERTION[\s\S]*actual: 1,[\s\S]*expected: 2,/,
    );
    if (mode === 'report') {
      expect(child.stderr).toContain('EO04_REPORT_FAILURE');
    } else {
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      expect(report.checks).toEqual(['completed before failure']);
      expect(report.failure.details).toContain('actual: 1');
      expect(report.failure.details).toContain('expected: 2');
      expect(report.evidenceErrors.map((e) => e.stage)).toEqual(
        mode === 'collectors' ? ['snapshot', 'screenshot'] : ['screenshot'],
      );
      expect(report.final).toEqual(mode === 'collectors' ? null : { mode: 'flight' });
    }
  });
}

it('runner finalization preserves the original when report and cleanup both fail', async () => {
  const { finishWithEvidence } = await import('./failure-evidence.mjs');
  const original = new Error('original runner assertion'),
    cleanup = vi.fn(async () => {
      throw new Error('cleanup');
    });
  await expect(
    finishWithEvidence(
      original,
      async () => {
        throw new Error('report');
      },
      cleanup,
      vi.fn(),
    ),
  ).rejects.toBe(original);
  expect(cleanup).toHaveBeenCalledOnce();
});
it('runner finalization fails a successful check when evidence cannot be written', async () => {
  const { finishWithEvidence } = await import('./failure-evidence.mjs');
  const original = new Error('report unavailable'),
    cleanup = vi.fn(async () => {});
  await expect(
    finishWithEvidence(
      null,
      async () => {
        throw original;
      },
      cleanup,
      vi.fn(),
    ),
  ).rejects.toBe(original);
  expect(cleanup).toHaveBeenCalledOnce();
});
