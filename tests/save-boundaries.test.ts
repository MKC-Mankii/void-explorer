import { expect, it } from 'vitest';
import { Simulation, NO_INPUT } from '../src/simulation';

it('rejects a landed save at the planet centre before it can corrupt simulation', () => {
  const sim = new Simulation();
  const saved = sim.save();
  saved.mode = 'landed';
  saved.landedPlanet = sim.nearest.id;
  saved.position = sim.nearest.position.toArray();
  saved.shipPosition = [...saved.position];
  expect(sim.restore(saved)).toBe(false);
});

it('rejects a string system index and physically unbounded velocity', () => {
  const sim = new Simulation();
  expect(sim.restore({ ...sim.save(), system: '0' })).toBe(false);
  expect(sim.restore({ ...sim.save(), velocity: [9999999, 0, 0] })).toBe(false);
});

it('restoring a stationary surface state clears residual motion', () => {
  const sim = new Simulation();
  sim.requestLanding();
  for (let i = 0; i < 900; i++) sim.tick(1 / 60, NO_INPUT);
  const saved = sim.save();
  saved.velocity = [10, 0, 0];
  saved.speed = 10;
  expect(sim.restore(saved)).toBe(true);
  expect(sim.velocity.length()).toBe(0);
  expect(sim.speed).toBe(0);
});
