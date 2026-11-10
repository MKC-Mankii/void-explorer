import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { failWithEvidence } from '../failure-evidence.mjs';

const [mode, reportPath] = process.argv.slice(2);
try {
  assert.equal(1, 2, 'EO04_ORIGINAL_ASSERTION');
} catch (original) {
  await failWithEvidence(original, {
    checks: ['completed before failure'],
    errors: ['earlier console diagnostic'],
    snapshot: async () => {
      if (mode === 'collectors') throw new Error('EO04_SNAPSHOT_FAILURE');
      return { mode: 'flight' };
    },
    screenshot: async () => {
      throw new Error('EO04_SCREENSHOT_FAILURE');
    },
    writeReport: async (report) => {
      if (mode === 'report') throw new Error('EO04_REPORT_FAILURE');
      await writeFile(reportPath, JSON.stringify(report, null, 2));
    },
  });
}
