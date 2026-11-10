import { inspect } from 'node:util';

function describe(error) {
  return {
    name: error?.name ?? typeof error,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    // Retain assertion fields, causes and non-enumerable Error details in the report.
    details: inspect(error, { depth: null }),
  };
}

/** Capture best-effort evidence, then reject with the exact original failure. */
export async function failWithEvidence(
  original,
  { checks, errors, context = {}, snapshot, screenshot, writeReport, log = console.error },
) {
  try {
    log('Original test failure:', original);
    const report = {
      ...context,
      checks: [...checks],
      errors: [...errors],
      failure: describe(original),
      evidenceErrors: [],
      final: null,
      screenshot: null,
    };
    const additional = (stage, error) => {
      report.evidenceErrors.push({ stage, ...describe(error) });
      log(`Additional evidence failure (${stage}):`, error);
    };
    // Record state independently and before a potentially slow screenshot.
    try {
      report.final = await snapshot();
    } catch (error) {
      additional('snapshot', error);
    }
    try {
      report.screenshot = await screenshot();
    } catch (error) {
      additional('screenshot', error);
    }
    try {
      await writeReport(report);
    } catch (error) {
      additional('report', error);
    }
  } finally {
    // Even an unexpected reporting/serialization failure cannot replace the test failure.
    throw original;
  }
}
