/** Read-only collection around existing real-input journey stages; no pose/time control. */
export async function beginJourneySampling(page) {
  await page.evaluate(() => window.__VOID__.beginSampling());
}
export async function endJourneySampling(page, stage) {
  const samples = await page.evaluate(() => window.__VOID__.endSampling());
  const metrics = {};
  for (const key of ['frameMs', 'updateMs', 'simulationMs', 'sceneMs', 'submissionMs']) {
    const values = samples.map((s) => s[key]).sort((a, b) => a - b);
    metrics[key] = values.length
      ? {
          samples: values.length,
          median: values[Math.ceil(values.length * 0.5) - 1],
          p95: values[Math.ceil(values.length * 0.95) - 1],
          worst: values.at(-1),
        }
      : null;
  }
  return { stage, metrics, samples, gpuMs: null };
}
