import { expect, it } from 'vitest';
import { Simulation, NO_INPUT } from '../src/simulation.ts';
import { observeSimulation } from '../src/diagnostics.ts';
import { FLIGHT } from '../src/navigation.ts';
import { assertAlignmentBound } from './navigation-observation.mjs';

for (const delay of [0, 0.05, 0.25, 0.5]) {
  it(`accepts real bounded alignment after ${delay} simulated seconds of observation delay`, () => {
    const sim = new Simulation(),
      before = observeSimulation(sim);
    sim.navigate(1);
    for (let t = 0; t < delay - 1e-9; t += 0.05) sim.tick(Math.min(0.05, delay - t), NO_INPUT);
    const measured = assertAlignmentBound(before, observeSimulation(sim), FLIGHT.guideTurnRate);
    if (delay > 0) expect(measured.angle).toBeGreaterThan(0);
  });
}
for (const delay of [0, 0.05]) {
  it(`rejects an actual orientation snap after ${delay} simulated seconds`, () => {
    const sim = new Simulation(),
      before = observeSimulation(sim);
    sim.navigate(1);
    if (delay) sim.tick(delay, NO_INPUT);
    sim.lookAt(sim.selected.position);
    expect(() =>
      assertAlignmentBound(before, observeSimulation(sim), FLIGHT.guideTurnRate),
    ).toThrow(/angular rate/);
  });
}
it('treats equivalent quaternion signs as the same orientation', () => {
  const before = observeSimulation(new Simulation());
  const after = { ...before, rotation: before.rotation.map((v) => -v) };
  expect(assertAlignmentBound(before, after, FLIGHT.guideTurnRate).angle).toBeCloseTo(0, 6);
});
