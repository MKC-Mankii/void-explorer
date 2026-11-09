import { it, expect } from 'vitest';
import { Vector3 } from 'three';
import { UNIVERSE, surfaceRadius, terrainHeight } from '../src/universe';
import { surfaceSamples, DETAIL_RANGE, SurfaceDetails } from '../src/surface-details';
import { Terrain } from '../src/terrain';

it('keeps streamed ground objects fixed across observer motion and cube-face boundaries', () => {
  const p = UNIVERSE[0].planets[1];
  for (const direction of [new Vector3(0.25, 0.3, 1), new Vector3(1, 0.2, 1)]) {
    const dir = direction.normalize(),
      pos = dir
        .clone()
        .multiplyScalar(surfaceRadius(p, dir) + 0.61)
        .add(p.position);
    const a = surfaceSamples(p, pos),
      b = surfaceSamples(p, pos.clone().add(new Vector3(25, 0, -25)));
    const byId = new Map(b.map((s) => [s.id, s]));
    const common = a.filter((s) => byId.has(s.id));
    expect(common.length).toBeGreaterThan(80);
    for (const s of common) {
      expect(s.position.toArray()).toEqual(byId.get(s.id)!.position.toArray());
      expect(s.size).toBe(byId.get(s.id)!.size);
    }
    expect(a.length).toBeLessThan(4096);
    for (const s of b.filter((s) => !a.some((t) => t.id === s.id)))
      expect(s.position.distanceTo(pos)).toBeGreaterThan(DETAIL_RANGE.end + 28);
  }
});
it('never places world details below an ocean and retains identical seeds on revisit', () => {
  const p = UNIVERSE[0].planets[0],
    pos = new Vector3(0, 0.3, 1).normalize().multiplyScalar(p.radius).add(p.position);
  const a = surfaceSamples(p, pos),
    b = surfaceSamples(p, pos);
  expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  for (const s of a) expect(terrainHeight(p, s.up)).toBeGreaterThanOrEqual(1);
});
it('stores sampled elevation separately from spherical chord and skirt displacement', () => {
  const p = UNIVERSE[0].planets[0],
    terrain = new Terrain(p),
    eye = new Vector3(0, 0, p.radius * 4);
  terrain.update(eye, true);
  let tested = 0,
    sawChord = false;
  terrain.group.traverse((object) => {
    if (!('geometry' in object)) return;
    const geometry = (object as import('three').Mesh).geometry;
    const positions = geometry.userData.finePosition,
      elevations = geometry.userData.fineElevation;
    if (!positions || !elevations) return;
    for (let i = 0; i < positions.count; i++) {
      const v = new Vector3().fromBufferAttribute(positions, i),
        h = terrainHeight(p, v.clone().normalize());
      expect(elevations.getX(i)).toBeCloseTo(h, 4);
      if (Math.abs(v.length() - p.radius - h) > 0.1) sawChord = true;
      tested++;
    }
  });
  expect(tested).toBeGreaterThan(100);
  expect(sawChord).toBe(true);
  terrain.dispose();
});

it('returns detached detail diagnostics rather than exposing live fade configuration', () => {
  const details = new SurfaceDetails();
  const observed = details.diagnostics;
  observed.fade.end = -1;
  expect(details.diagnostics.fade.end).toBe(185);
});
