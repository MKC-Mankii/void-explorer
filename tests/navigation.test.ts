import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { Simulation, NO_INPUT } from '../src/simulation';
import { applyScenario, observeSimulation, scenarioNames } from '../src/diagnostics';
import {
  FLIGHT,
  pickPlanet,
  pickPlanetAtScreen,
  projectContact,
  routeObstacle,
  arrivalClearance,
} from '../src/navigation';
const tick = (s: Simulation, seconds: number, input = NO_INPUT, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) s.tick(Math.min(dt, seconds - t), input);
};

describe('flight controls', () => {
  it('smoothly reduces boost speed whether W is held or released', () => {
    for (const throttle of [0, 1]) {
      const s = new Simulation();
      applyScenario(s, 'high-speed');
      const before = s.velocity.length();
      s.tick(0.05, { ...NO_INPUT, throttle });
      expect(s.speed).toBeGreaterThan(880);
      expect(s.speed).toBeLessThan(900);
      expect(before - s.velocity.length()).toBeLessThan(10);
      tick(s, 5, { ...NO_INPUT, throttle });
      expect(s.speed).toBe(FLIGHT.normal);
    }
  });
  it('brakes all motion even if a translation key remains held', () => {
    const s = new Simulation();
    applyScenario(s, 'high-speed');
    tick(s, 8, { ...NO_INPUT, brake: true, strafe: 1, lift: 1 });
    expect(s.speed).toBe(0);
    expect(s.velocity.length()).toBeLessThan(0.03);
  });
  it('smooths turning, clamps rate spikes and lets rotation settle', () => {
    const s = new Simulation();
    applyScenario(s, 'transfer');
    const initial = s.rotation.clone();
    s.tick(0.01, { ...NO_INPUT, yaw: 100 });
    expect(s.rotation.angleTo(initial)).toBeLessThan(0.004);
    tick(s, 2, { ...NO_INPUT, yaw: 1 });
    expect(s.angularVelocity.y).toBeCloseTo(1, 3);
    tick(s, 2);
    expect(s.angularVelocity.length()).toBeLessThan(0.001);
  });
  it('produces comparable flight across supported frame step sizes', () => {
    const a = new Simulation(),
      b = new Simulation();
    applyScenario(a, 'transfer');
    applyScenario(b, 'transfer');
    for (const s of [a, b]) {
      const dt = s === a ? 1 / 120 : 1 / 20;
      tick(s, 1, { ...NO_INPUT, yaw: 0.4, throttle: 1 }, dt);
      tick(s, 2, NO_INPUT, dt);
    }
    expect(a.rotation.angleTo(b.rotation)).toBeLessThan(0.012);
    expect(a.position.distanceTo(b.position)).toBeLessThan(5);
  });
});
describe('target and route continuity', () => {
  it('selects and gradually aligns without teleporting orientation or position', () => {
    const s = new Simulation();
    const q = s.rotation.clone(),
      pos = s.position.clone();
    expect(s.navigate(2)).toBe(true);
    expect(s.rotation.equals(q)).toBe(true);
    expect(s.position.equals(pos)).toBe(true);
    s.tick(0.05, NO_INPUT);
    expect(s.rotation.angleTo(q)).toBeLessThanOrEqual(FLIGHT.guideTurnRate * 0.05 + 0.00001);
    tick(s, 8);
    expect(s.navigation.headingError).toBeLessThan(0.31);
  });
  it('cancels cruise on explicit manual steering, throttle or brakes', () => {
    for (const input of [{ yaw: 0.2 }, { throttle: 1 }, { brake: true }]) {
      const s = new Simulation();
      applyScenario(s, 'transfer');
      expect(s.toggleCruise()).toBe(true);
      s.tick(0.05, { ...NO_INPUT, ...input });
      expect(s.guidance).toBe('off');
      expect(s.navigationStatus).toBe('manual');
    }
  });
  it('flies through actual intervening space and stops at the destination near-space boundary', () => {
    const s = new Simulation();
    applyScenario(s, 'transfer');
    const start = s.position.clone(),
      startDistance = s.navigation.distance;
    expect(s.toggleCruise()).toBe(true);
    let maximum = 0,
      steps = 0;
    while (s.navigationStatus !== 'arrived' && steps++ < 6000) {
      s.tick(0.02, NO_INPUT);
      maximum = Math.max(maximum, s.velocity.length());
      expect(s.height).toBeGreaterThan(0.7);
    }
    expect(s.navigationStatus).toBe('arrived');
    expect(s.position.distanceTo(start)).toBeGreaterThan(startDistance * 0.8);
    expect(s.navigation.distance).toBeGreaterThan(arrivalClearance(s.selected) - 80);
    expect(s.navigation.distance).toBeLessThan(arrivalClearance(s.selected) + 60);
    expect(maximum).toBeGreaterThan(1000);
    expect(s.velocity.length()).toBeLessThan(3);
  });
  it('brakes from an approaching fixture without falling through the surface', () => {
    const s = new Simulation();
    applyScenario(s, 'approach');
    s.toggleCruise();
    tick(s, 35);
    expect(s.navigationStatus).toBe('arrived');
    expect(s.navigation.distance).toBeGreaterThan(350);
    expect(s.velocity.length()).toBeLessThan(3);
  });
  it('reports an occluded route and allows manual departure instead of crossing a planet', () => {
    const s = new Simulation();
    applyScenario(s, 'occluded');
    expect(routeObstacle(s.system, s.position, s.selected)).toBe('VESPER');
    expect(s.toggleCruise()).toBe(false);
    expect(s.navigationStatus).toBe('blocked');
    s.tick(0.05, { ...NO_INPUT, throttle: 1 });
    expect(s.navigationStatus).toBe('manual');
    expect(s.speed).toBeGreaterThan(0);
  });
  it('keeps scanning tied to the selected destination', () => {
    const s = new Simulation();
    s.selectTarget(1);
    expect(s.scan()).toBe(false);
    expect(s.score).toBe(0);
    s.selectTarget(0);
    expect(s.scan()).toBe(true);
    expect(s.discoveries['0-0'].scan).toBe(true);
  });
  it('preserves target and motion through saves, and loads first-round saves', () => {
    const s = new Simulation();
    applyScenario(s, 'high-speed');
    const state = s.save(),
      copy = new Simulation();
    expect(copy.restore(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(copy.target).toBe(s.target);
    expect(copy.velocity.equals(s.velocity)).toBe(true);
    expect(copy.speed).toBe(900);
    expect(copy.guidance).toBe('off');
    delete state.target;
    delete state.speed;
    delete state.velocity;
    expect(copy.restore(state)).toBe(true);
    expect(copy.target).toBe(0);
    expect(copy.velocity.length()).toBe(0);
  });
  it('rejects invalid saved navigation and velocity fields', () => {
    const s = new Simulation();
    for (const state of [
      { ...s.save(), target: 99 },
      { ...s.save(), velocity: [NaN, 0, 0] },
      { ...s.save(), speed: Infinity },
    ])
      expect(new Simulation().restore(state)).toBe(false);
  });
});
describe('visible navigation and observation', () => {
  it('distinguishes a free cursor ray from the reticle and respects physical occlusion', () => {
    const sim = new Simulation();
    const planet = {
      ...sim.selected,
      position: new Vector3(300, 0, -1000),
      radius: 40,
      amplitude: 0,
    };
    const system = { ...sim.system, star: new Vector3(1e6, 0, 0), planets: [planet] };
    const camera = new PerspectiveCamera(60, 16 / 9, 0.01, 100000);
    camera.updateMatrixWorld();
    const projected = planet.position.clone().project(camera);
    expect(pickPlanetAtScreen(system, camera, new Vector2())).toBe(null);
    expect(pickPlanetAtScreen(system, camera, new Vector2(projected.x, projected.y))).toBe(0);
    const hidden = { ...planet, position: new Vector3(0, 0, -10000) };
    expect(
      pickPlanetAtScreen(
        { ...system, planets: [hidden], star: new Vector3(0, 0, -5000) },
        camera,
        new Vector2(),
      ),
    ).toBe(null);
  });
  it('locks only the first physical planet under a ray', () => {
    const s = new Simulation(),
      p = s.system.planets[0];
    const dir = p.position.clone().sub(s.position).normalize();
    expect(pickPlanet(s.system, s.position, dir)).toBe(0);
    expect(pickPlanet(s.system, s.position, dir.negate())).toBe(null);
  });
  it('distinguishes offscreen front contacts from rear contacts and clamps arrows inside the screen', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 10000);
    camera.updateMatrixWorld(true);
    const front = projectContact(camera, new Vector3(100, 0, -10), 1280, 720),
      back = projectContact(camera, new Vector3(-100, 0, 10), 1280, 720);
    expect(front.front).toBe(true);
    expect(front.onScreen).toBe(false);
    expect(back.front).toBe(false);
    expect(front.x).toBeGreaterThan(640);
    expect(back.x).toBeLessThan(640);
    for (const p of [front, back]) {
      expect(p.x).toBeGreaterThanOrEqual(70);
      expect(p.x).toBeLessThanOrEqual(1210);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(720);
    }
  });
  it('repeats named scenarios and returns detached observations', () => {
    for (const name of scenarioNames) {
      const a = new Simulation(),
        b = new Simulation();
      applyScenario(a, name);
      applyScenario(b, name);
      expect(observeSimulation(a)).toEqual(observeSimulation(b));
      const observation = observeSimulation(a);
      observation.position[0] += 999;
      expect(a.position.toArray()).toEqual(b.position.toArray());
    }
    expect(() => applyScenario(new Simulation(), 'unknown')).toThrow();
  });
});
