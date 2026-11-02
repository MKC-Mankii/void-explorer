import { it, expect } from 'vitest';
import { Vector3, Raycaster } from 'three';
import {
  CelestialLighting,
  airState,
  atmosphereParameters,
  stellarVisibility,
} from '../src/rendering';
import { UNIVERSE, surfaceRadius } from '../src/universe';
import { Terrain } from '../src/terrain';

it('uses the real stellar position for every body and inverse-square attenuation', () => {
  const system = UNIVERSE[0],
    lighting = new CelestialLighting();
  lighting.configure(system);
  expect(lighting.point.position.toArray()).toEqual(system.star.toArray());
  expect(lighting.point.decay).toBe(2);
  expect(lighting.uniforms.veBodies.value[1].toArray()).toEqual(
    system.planets[1].position.toArray(),
  );
  const dirA = system.star.clone().sub(system.planets[0].position).normalize(),
    dirB = system.star.clone().sub(system.planets[1].position).normalize();
  expect(dirA.angleTo(dirB)).toBeGreaterThan(0.1);
});
it('dims stellar light behind a planet and keeps a lit exterior visible', () => {
  const system = UNIVERSE[0],
    p = system.planets[0],
    sun = system.star.clone().sub(p.position).normalize();
  expect(
    stellarVisibility(p.position.clone().addScaledVector(sun, p.radius + 5), system),
  ).toBeGreaterThan(0.99);
  expect(
    stellarVisibility(p.position.clone().addScaledVector(sun, -p.radius - 5), system),
  ).toBeLessThan(0.01);
});
it('fades the local atmosphere continuously and keeps the night fog darker', () => {
  const system = UNIVERSE[0],
    p = system.planets[0],
    sun = system.star.clone().normalize(),
    h = atmosphereParameters(p).height;
  const day = airState(p, sun.clone().multiplyScalar(p.radius + 10), system.star),
    night = airState(p, sun.clone().multiplyScalar(-p.radius - 10), system.star);
  expect(day.daylight).toBeGreaterThan(0.9);
  expect(night.daylight).toBeLessThan(0.01);
  expect(night.fogColor.r + night.fogColor.g + night.fogColor.b).toBeLessThan(
    (day.fogColor.r + day.fogColor.g + day.fogColor.b) * 0.05,
  );
  let previous = 1;
  for (let altitude = 0; altitude < h * 1.2; altitude += h / 50) {
    const state = airState(p, sun.clone().multiplyScalar(p.radius + altitude), system.star);
    expect(state.density).toBeLessThanOrEqual(previous + 0.00001);
    expect(Number.isFinite(state.fogDensity)).toBe(true);
    previous = state.density;
  }
  expect(previous).toBe(0);
});
it('retains full terrain coverage while budgeted children load and morph', () => {
  const p = UNIVERSE[0].planets[1],
    dir = new Vector3(0.2, 0.3, 1).normalize(),
    position = p.position.clone().addScaledVector(dir, surfaceRadius(p, dir) + 2);
  const terrain = new Terrain(p);
  terrain.update(position);
  let sawTransition = false;
  for (let i = 0; i < 240; i++) {
    terrain.tick(0.05, position);
    const stats = terrain.diagnostics;
    expect(stats.generatedLastFrame).toBeLessThanOrEqual(8);
    expect(stats.active).toBeGreaterThan(5);
    sawTransition ||= stats.transitioning > 0;
  }
  expect(sawTransition).toBe(true);
  expect(terrain.diagnostics.queued).toBe(0);
  expect(terrain.diagnostics.transitioning).toBe(0);
  terrain.group.updateMatrixWorld(true);
  const ray = new Raycaster(position.clone().addScaledVector(dir, 30), dir.clone().negate(), 0, 60);
  const hits = ray.intersectObject(terrain.group, true).filter((h) => h.object.visible);
  expect(hits.length).toBeGreaterThan(0);
  terrain.dispose();
});
it('adds hysteresis so small camera movements do not rebuild the terrain repeatedly', () => {
  const p = UNIVERSE[0].planets[0],
    terrain = new Terrain(p),
    camera = p.position.clone().add(new Vector3(0, 0, p.radius * 2.2));
  terrain.update(camera, true);
  for (let i = 0; i < 100; i++)
    terrain.tick(0.05, camera.clone().add(new Vector3(Math.sin(i) * 0.02, 0, 0)));
  expect(terrain.diagnostics.queued).toBe(0);
  expect(terrain.diagnostics.generatedLastFrame).toBe(0);
  terrain.dispose();
});
