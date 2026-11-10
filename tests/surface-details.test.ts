import { expect, it } from 'vitest';
import { InstancedMesh, Material, Vector3 } from 'three';
import { SurfaceDetails } from '../src/surface-details';
import { PlanetData, UNIVERSE } from '../src/universe';

const planets = UNIVERSE[0].planets;
const observer = (p: PlanetData) => p.position.clone().add(new Vector3(0, 0, p.radius + 1));
function track(details: SurfaceDetails) {
  return details.group.children.map((object) => {
    const mesh = object as InstancedMesh;
    const released = { instance: 0, geometry: 0, material: 0 };
    mesh.addEventListener('dispose', () => released.instance++);
    mesh.geometry.addEventListener('dispose', () => released.geometry++);
    (mesh.material as Material).addEventListener('dispose', () => released.material++);
    return { mesh, released };
  });
}

it('releases owned instance buffers, geometries and materials once; clear is repeatable', () => {
  const details = new SurfaceDetails();
  details.update(planets[1], observer(planets[1]));
  const old = track(details);
  expect(old).toHaveLength(2);
  details.clear();
  details.clear();
  expect(details.group.children).toHaveLength(0);
  for (const { released } of old)
    expect(released).toEqual({ instance: 1, geometry: 1, material: 1 });
  details.update(planets[1], observer(planets[1]));
  expect(details.group.children).toHaveLength(2);
  for (const { mesh } of old) expect(details.group.children).not.toContain(mesh);
  details.clear();
});

it('keeps live same-planet resources, disposes on planet changes and supports surface re-entry', () => {
  const details = new SurfaceDetails();
  details.update(planets[1], observer(planets[1]));
  const old = track(details);
  details.update(planets[1], observer(planets[1]).add(new Vector3(25, 0, 0)));
  expect(details.group.children).toEqual(old.map(({ mesh }) => mesh));
  for (const { released } of old)
    expect(released).toEqual({ instance: 0, geometry: 0, material: 0 });
  details.update(planets[2], observer(planets[2]));
  for (const { released } of old)
    expect(released).toEqual({ instance: 1, geometry: 1, material: 1 });
  const next = track(details);
  details.clear();
  details.update(planets[1], observer(planets[1]));
  for (const { released } of next)
    expect(released).toEqual({ instance: 1, geometry: 1, material: 1 });
  expect(details.group.children).toHaveLength(2);
  details.clear();
});

it('does not release resources owned by another still-live SurfaceDetails instance', () => {
  const a = new SurfaceDetails(),
    b = new SurfaceDetails();
  a.update(planets[1], observer(planets[1]));
  b.update(planets[1], observer(planets[1]));
  const live = track(b);
  for (const object of a.group.children) {
    const mesh = object as InstancedMesh;
    for (const other of live) {
      expect(mesh.geometry).not.toBe(other.mesh.geometry);
      expect(mesh.material).not.toBe(other.mesh.material);
      expect(mesh.instanceMatrix).not.toBe(other.mesh.instanceMatrix);
    }
  }
  a.clear();
  b.update(planets[1], observer(planets[1]).add(new Vector3(30, 0, 0)));
  expect(b.group.children).toEqual(live.map(({ mesh }) => mesh));
  for (const { released } of live)
    expect(released).toEqual({ instance: 0, geometry: 0, material: 0 });
  b.clear();
  for (const { released } of live)
    expect(released).toEqual({ instance: 1, geometry: 1, material: 1 });
});
