import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  UNIVERSE,
  generateUniverse,
  terrainHeight,
  surfaceRadius,
  altitude,
} from '../src/universe';
import { Simulation, NO_INPUT } from '../src/simulation';
const advance = (s: Simulation, seconds: number, input = NO_INPUT) => {
  for (let t = 0; t < seconds; t += 1 / 60) s.tick(1 / 60, input);
};
function land(s: Simulation) {
  expect(s.requestLanding()).toBe(true);
  advance(s, 14);
  expect(s.mode).toBe('landed');
}
describe('procedural universe', () => {
  it('creates 15 unique, deterministic and seed-sensitive destinations', () => {
    const a = generateUniverse(),
      b = generateUniverse(),
      c = generateUniverse('OTHER');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a.flatMap((s) => s.planets.map((p) => p.id))).size).toBe(15);
  });
  it('has continuous terrain across cube-face boundaries and finite surface heights', () => {
    for (const system of UNIVERSE)
      for (const p of system.planets) {
        for (const dir of [
          new Vector3(1, 1, 1),
          new Vector3(-1, 0, 1),
          new Vector3(0, 1, 0),
          new Vector3(1, 0, 0),
        ]) {
          dir.normalize();
          const h = terrainHeight(p, dir);
          expect(Number.isFinite(h)).toBe(true);
          expect(Math.abs(h)).toBeLessThan(p.radius * 0.15);
          const neighboring = dir
            .clone()
            .add(new Vector3(1e-7, -1e-7, 0))
            .normalize();
          expect(Math.abs(terrainHeight(p, neighboring) - h)).toBeLessThan(0.01);
          expect(surfaceRadius(p, dir)).toBeGreaterThan(p.radius * 0.8);
        }
      }
  });
});
describe('expedition loop', () => {
  it('scans, lands, samples, reboards and takes off with consistent ground contact', () => {
    const s = new Simulation();
    expect(s.scan()).toBe(true);
    expect(s.scan()).toBe(false);
    expect(s.score).toBe(100);
    land(s);
    expect(s.height).toBeCloseTo(0.61, 5);
    expect(s.score).toBe(250);
    expect(
      terrainHeight(s.landedPlanet!, s.position.clone().sub(s.landedPlanet!.position).normalize()),
    ).toBeGreaterThan(0);
    expect(s.interact()).toBe(true);
    expect(s.mode).toBe('walking');
    expect(s.height).toBeCloseTo(0.18, 4);
    expect(s.scan()).toBe(true);
    expect(s.score).toBe(500);
    expect(s.scan()).toBe(false);
    expect(s.interact()).toBe(true);
    expect(s.mode).toBe('landed');
    expect(s.takeoff()).toBe(true);
    advance(s, 6);
    expect(s.mode).toBe('flight');
    expect(s.height).toBeGreaterThan(80);
  });
  it('moves on the curved surface and requires returning to the ship', () => {
    const s = new Simulation();
    land(s);
    s.interact();
    const before = s.position.clone();
    advance(s, 24, { ...NO_INPUT, throttle: -1, boost: true });
    expect(s.position.distanceTo(before)).toBeGreaterThan(15);
    expect(s.height).toBeCloseTo(0.18, 3);
    expect(s.interact()).toBe(false);
  });
  it('brakes and prevents underground flight and stellar entry', () => {
    const s = new Simulation();
    advance(s, 3, { ...NO_INPUT, throttle: 1 });
    expect(s.speed).toBeGreaterThan(100);
    advance(s, 2, { ...NO_INPUT, brake: true });
    expect(Math.abs(s.speed)).toBeLessThan(0.01);
    const p = s.nearest;
    const dir = new Vector3(0, 0, 1);
    s.position.copy(p.position).addScaledVector(dir, surfaceRadius(p, dir) - 50);
    s.tick(1 / 60, NO_INPUT);
    expect(s.height).toBeGreaterThanOrEqual(0.79);
    s.position.copy(s.system.star).add(new Vector3(0, 0, 1700));
    s.tick(1 / 60, NO_INPUT);
    expect(s.position.distanceTo(s.system.star)).toBeGreaterThan(2300);
  });
  it('keeps inertial cruise when throttle is released', () => {
    const s = new Simulation();
    advance(s, 1, { ...NO_INPUT, throttle: 1 });
    const speed = s.speed;
    advance(s, 1);
    expect(s.speed).toBeCloseTo(speed, 3);
    expect(s.velocity.length()).toBeGreaterThan(50);
  });
  it('rejects far-away landing and scans; restricts jumps to flight', () => {
    const s = new Simulation();
    s.position.set(0, 0, 200000);
    expect(s.scan()).toBe(false);
    expect(s.requestLanding()).toBe(false);
    s.position.set(0, 700, 5200);
    land(s);
    expect(s.jump(1)).toBe(false);
  });
  it('arrives at real new systems and can navigate all local bodies', () => {
    const s = new Simulation();
    expect(s.jump(3)).toBe(true);
    expect(s.system.id).toBe(3);
    expect(s.navigate(2)).toBe(true);
    const direction = s.selected.position.clone().sub(s.position).normalize();
    expect(s.forward.dot(direction)).toBeCloseTo(1, 6);
  });
});
describe('save validation', () => {
  it('roundtrips walking, ship transform, system and discovery records', () => {
    const s = new Simulation();
    s.scan();
    land(s);
    s.interact();
    s.scan();
    const saved = JSON.parse(JSON.stringify(s.save()));
    const restored = new Simulation();
    expect(restored.restore(saved)).toBe(true);
    expect(restored.mode).toBe('walking');
    expect(restored.position.toArray()).toEqual(s.position.toArray());
    expect(restored.shipPosition.toArray()).toEqual(s.shipPosition.toArray());
    expect(restored.score).toBe(500);
    expect(restored.interact()).toBe(true);
  });
  it('rejects malformed and incompatible saves without crashing', () => {
    for (const value of [
      null,
      {},
      'oops',
      { version: 8 },
      { ...new Simulation().save(), position: [NaN, 0, 0] },
      { ...new Simulation().save(), system: 50 },
      { ...new Simulation().save(), mode: 'walking', landedPlanet: 'none' },
    ])
      expect(new Simulation().restore(value)).toBe(false);
  });
  it('sanitizes unknown discoveries and stores transitions as safe flight state', () => {
    const s = new Simulation();
    s.requestLanding();
    const saved = s.save();
    expect(saved.mode).toBe('flight');
    saved.discoveries['bad'] = { scan: true, land: true, sample: true };
    const r = new Simulation();
    expect(r.restore(saved)).toBe(true);
    expect(r.score).toBe(0);
  });
});

it('allows landing, sampling and departure on every catalogued planet', () => {
  const sim = new Simulation();
  for (const system of UNIVERSE) {
    sim.system = system;
    for (const p of system.planets) {
      let dir = new Vector3(0, 1, 0),
        best = -Infinity;
      for (let i = 0; i < 80; i++) {
        const y = 1 - (i + 0.5) / 40,
          a = i * 2.399963;
        const d = new Vector3(
          Math.sqrt(1 - y * y) * Math.cos(a),
          y,
          Math.sqrt(1 - y * y) * Math.sin(a),
        );
        const h = terrainHeight(p, d);
        if (h > best) {
          dir = d;
          best = h;
        }
      }
      sim.mode = 'flight';
      sim.position.copy(p.position).addScaledVector(dir, p.radius * 2);
      sim.velocity.set(0, 0, 0);
      sim.speed = 0;
      sim.lookAt(p.position);
      expect(sim.nearest.id).toBe(p.id);
      land(sim);
      expect(sim.height).toBeCloseTo(0.61, 4);
      expect(sim.interact()).toBe(true);
      expect(sim.scan()).toBe(true);
      expect(sim.interact()).toBe(true);
      expect(sim.takeoff()).toBe(true);
      advance(sim, 5.5);
      expect(sim.mode).toBe('flight');
    }
  }
  expect(Object.keys(sim.discoveries)).toHaveLength(15);
  expect(sim.jump(999)).toBe(false);
  expect(sim.navigate(-1)).toBe(false);
});
