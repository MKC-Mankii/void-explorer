import { it, expect } from 'vitest';
import { Vector3, Raycaster } from 'three';
import { UNIVERSE, terrainHeight } from '../src/universe';
import { Terrain } from '../src/terrain';

it('keeps rendered highland terrain within astronaut clearance of the collision surface', () => {
  for (const system of [UNIVERSE[0], UNIVERSE[1], UNIVERSE[3]]) {
    const p = system.planets[0];
    let dir = new Vector3(0, 1, 0),
      highest = -Infinity;
    for (let i = 0; i < 150; i++) {
      const y = 1 - (2 * (i + 0.5)) / 150,
        angle = i * 2.399963;
      const candidate = new Vector3(
        Math.sqrt(1 - y * y) * Math.cos(angle),
        y,
        Math.sqrt(1 - y * y) * Math.sin(angle),
      );
      const height = terrainHeight(p, candidate);
      if (height > highest) {
        highest = height;
        dir = candidate;
      }
    }
    const surface = p.position.clone().addScaledVector(dir, p.radius + highest);
    const terrain = new Terrain(p);
    terrain.update(surface.clone().addScaledVector(dir, 0.18), true);
    terrain.group.updateMatrixWorld(true);
    const ray = new Raycaster(
      surface.clone().addScaledVector(dir, 30),
      dir.clone().negate(),
      0,
      60,
    );
    const hits = ray.intersectObject(terrain.group, true).filter((hit) => hit.object.visible);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.distanceTo(surface)).toBeLessThan(0.09);
    terrain.dispose();
  }
}, 15000);
