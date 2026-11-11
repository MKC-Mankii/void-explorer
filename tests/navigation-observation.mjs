import assert from 'node:assert/strict';
import { Quaternion } from 'three';

/** Browser RPCs span rendered ticks: compare angular distance against simulated elapsed time. */
export function assertAlignmentBound(before, after, guideTurnRate) {
  const elapsed = after.playTime - before.playTime;
  assert(Number.isFinite(elapsed) && elapsed >= 0, 'Invalid observation interval');
  const angle = new Quaternion()
    .fromArray(before.rotation)
    .angleTo(new Quaternion().fromArray(after.rotation));
  const maximum = guideTurnRate * elapsed;
  assert(
    angle <= maximum + 0.00001,
    `Alignment exceeded its angular rate: ${angle} rad over ${elapsed} simulated s (limit ${maximum} rad)`,
  );
  return { elapsed, angle, maximum, guideTurnRate };
}
