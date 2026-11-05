import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Box3, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHIP_LAYOUT, avoidShipHull } from '../src/ship-layout';
import { Simulation, NO_INPUT } from '../src/simulation';

describe('exported AURORA asset contract', () => {
  it('loads the actual embedded GLB, with four solid wings, one canopy and two aft engines', async () => {
    const bytes = readFileSync(new URL('../assets/aurora/aurora.glb', import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { scene } = await new GLTFLoader().parseAsync(buffer, '');
    const wings: Mesh[] = [];
    let triangles = 0;
    scene.traverse((node) => {
      if (node instanceof Mesh) {
        triangles += (node.geometry.index?.count ?? 0) / 3;
        if (node.userData.part === 'wing') wings.push(node);
      }
    });
    expect(wings).toHaveLength(4);
    expect(wings.every((wing) => wing.geometry.attributes.position.count > 8)).toBe(true);
    expect(triangles).toBeLessThan(12000);
    expect(bytes.length).toBeLessThan(750000);
    let furthest = 0;
    scene.updateMatrixWorld(true);
    scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const positions = node.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const point = new Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(node.matrixWorld);
        point.y -= SHIP_LAYOUT.landingDatumMetres;
        furthest = Math.max(furthest, point.length() * SHIP_LAYOUT.scale);
      }
    });
    expect(furthest).toBeLessThan(SHIP_LAYOUT.flightClearance);
    const size = new Box3().setFromObject(scene).getSize(new Vector3());
    expect(size.x).toBeCloseTo(18.6, 1);
    expect(Math.abs(size.z - 18)).toBeLessThan(0.06);
    const fore = new Box3().setFromObject(scene.getObjectByName('Wing_Fore_Port')!);
    const aft = new Box3().setFromObject(scene.getObjectByName('Wing_Aft_Port')!);
    expect(fore.max.z).toBeLessThan(aft.min.z);
    expect(fore.min.y - aft.max.y).toBeGreaterThan(1);
    expect(aft.getSize(new Vector3()).x).toBeGreaterThan(fore.getSize(new Vector3()).x);
    for (const name of [
      'Canopy_Single',
      'Nacelle_Port',
      'Nacelle_Starboard',
      'Cockpit_View',
      'Boarding_Exit',
    ])
      expect(scene.getObjectByName(name)).toBeDefined();
    for (const side of ['Port', 'Starboard']) {
      const exhaust = scene.getObjectByName(`Exhaust_${side}`)!.getWorldPosition(new Vector3());
      expect(exhaust.z).toBeGreaterThan(aft.max.z);
      expect(exhaust.x * (side === 'Port' ? -1 : 1)).toBeCloseTo(1.8, 4);
      for (const pair of ['Fore', 'Aft']) {
        const contact = scene
          .getObjectByName(`Contact_${pair}_${side}`)!
          .getWorldPosition(new Vector3());
        expect(contact.y).toBeCloseTo(0, 5);
      }
    }
    const bodyCenter = scene.getObjectByName('Chase_Target')!.getWorldPosition(new Vector3());
    expect((bodyCenter.y - SHIP_LAYOUT.landingDatumMetres) * SHIP_LAYOUT.scale).toBeCloseTo(
      SHIP_LAYOUT.lookTarget[1],
      5,
    );
    const exit = scene.getObjectByName('Boarding_Exit')!.getWorldPosition(new Vector3());
    expect(exit.x * SHIP_LAYOUT.scale).toBeCloseTo(SHIP_LAYOUT.exit[0], 5);
    expect(exit.z * SHIP_LAYOUT.scale).toBeCloseTo(SHIP_LAYOUT.exit[2], 5);
  });
  it('reserves a real port boarding gap while preventing walking through the hull envelope', () => {
    const outside = new Vector3(-0.325, -0.43, 0.09);
    expect(avoidShipHull(outside.clone()).toArray()).toEqual(outside.toArray());
    const inside = avoidShipHull(new Vector3(-0.1, -0.43, 0.09));
    expect(inside.x).toBeCloseTo(-0.23, 5);
    expect(inside.y).toBe(-0.43);
    const sim = new Simulation();
    expect(sim.requestLanding()).toBe(true);
    for (let t = 0; t < 14; t += 1 / 60) sim.tick(1 / 60, NO_INPUT);
    const ship = sim.shipPosition.clone();
    expect(sim.interact()).toBe(true);
    const local = sim.position.clone().sub(ship).applyQuaternion(sim.shipRotation.clone().invert());
    expect(local.x).toBeCloseTo(SHIP_LAYOUT.exit[0], 2);
    expect(sim.height).toBeCloseTo(0.18, 4);
    for (let t = 0; t < 2; t += 1 / 60) sim.tick(1 / 60, { ...NO_INPUT, throttle: 1 });
    const blocked = sim.position
      .clone()
      .sub(ship)
      .applyQuaternion(sim.shipRotation.clone().invert());
    // W would cross the centreline without the envelope. Sliding along the
    // tapered bow is allowed, so do not assert a constant-width box boundary.
    expect(blocked.x).toBeLessThan(-0.1);
    expect(sim.interact()).toBe(true);
    expect(sim.shipPosition.toArray()).toEqual(ship.toArray());
  });
});
