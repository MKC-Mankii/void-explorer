import * as T from 'three';
import { PlanetData, random, terrainHeight } from './universe';
const axes = [
  new T.Vector3(1, 0, 0),
  new T.Vector3(-1, 0, 0),
  new T.Vector3(0, 1, 0),
  new T.Vector3(0, -1, 0),
  new T.Vector3(0, 0, 1),
  new T.Vector3(0, 0, -1),
];
export const DETAIL_RANGE = { full: 115, end: 185, cache: 290 };
/** World-anchored cube-face cells. Observer motion changes the working set, never a sample's seed or position. */
export function surfaceSamples(p: PlanetData, observer: T.Vector3) {
  const direction = observer.clone().sub(p.position).normalize(),
    n = Math.ceil(p.radius / 32),
    step = 2 / n;
  const samples: {
    id: string;
    position: T.Vector3;
    up: T.Vector3;
    size: number;
    crystal: boolean;
  }[] = [];
  axes.forEach((axis, face) => {
    const facing = direction.dot(axis);
    if (facing < 0.25) return;
    const a = new T.Vector3(axis.y, axis.z, axis.x),
      b = new T.Vector3().crossVectors(axis, a);
    const u = direction.dot(a) / facing,
      v = direction.dot(b) / facing,
      reach = ((DETAIL_RANGE.cache + 100) / p.radius) * 3;
    const x0 = Math.max(0, Math.floor((u - reach + 1) / step)),
      x1 = Math.min(n - 1, Math.floor((u + reach + 1) / step));
    const y0 = Math.max(0, Math.floor((v - reach + 1) / step)),
      y1 = Math.min(n - 1, Math.floor((v + reach + 1) / step));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const center = axis
          .clone()
          .addScaledVector(a, -1 + (x + 0.5) * step)
          .addScaledVector(b, -1 + (y + 0.5) * step)
          .normalize();
        // The conservative extra cell margin keeps newly streamed samples outside the visible fade radius.
        if (
          center.clone().multiplyScalar(p.radius).add(p.position).distanceTo(observer) >
          DETAIL_RANGE.cache + 64
        )
          continue;
        const rng = random(p.seed + face * 73856093 + x * 19349663 + y * 83492791);
        for (let i = 0; i < 10; i++) {
          const u = -1 + (x + rng()) * step,
            v = -1 + (y + rng()) * step;
          // Cube-face area shrinks towards edges. Correct the density per world area,
          // rather than concentrating several times more objects at face seams.
          if (rng() > 0.9 / Math.pow(1 + u * u + v * v, 1.5)) continue;
          const up = axis.clone().addScaledVector(a, u).addScaledVector(b, v).normalize();
          const height = terrainHeight(p, up),
            crystal = i < 4,
            size = crystal ? 0.2 + rng() * 0.55 : 0.25 + rng() * 1.7;
          if (p.ocean && height < 1) continue;
          const position = up
            .clone()
            .multiplyScalar(p.radius + height)
            .add(p.position);
          if (position.distanceTo(observer) > DETAIL_RANGE.cache) continue;
          samples.push({ id: `${face}/${x}/${y}/${i}`, position, up, size, crystal });
        }
      }
  });
  return samples;
}
export class SurfaceDetails {
  readonly group = new T.Group();
  private origin = new T.Vector3(Infinity, 0, 0);
  private planetId = '';
  private meshes: T.InstancedMesh[] = [];
  private rebuilds = 0;
  get diagnostics() {
    return {
      method: 'world-cell-distance-fade',
      instances: this.meshes.reduce((n, m) => n + m.count, 0),
      rebuilds: this.rebuilds,
      fade: { ...DETAIL_RANGE },
    };
  }
  private material(p: PlanetData, crystal: boolean) {
    const m = new T.MeshStandardMaterial({
      color: crystal ? p.atmosphere : p.colors[2],
      roughness: crystal ? 0.3 : 1,
      metalness: crystal ? 0.3 : 0,
      emissive: crystal ? p.atmosphere : 0,
      emissiveIntensity: crystal ? 0.3 : 0,
      alphaHash: true,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'varying vec3 veDetailWorld;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
        veDetailWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;`,
        );
      shader.fragmentShader =
        'varying vec3 veDetailWorld;\n' +
        shader.fragmentShader.replace(
          '#include <alphahash_fragment>',
          `diffuseColor.a*=1.-smoothstep(${DETAIL_RANGE.full.toFixed(1)},${DETAIL_RANGE.end.toFixed(1)},distance(cameraPosition,veDetailWorld));\n#include <alphahash_fragment>`,
        );
    };
    m.customProgramCacheKey = () => `surface-detail-fade-v1-${crystal}`;
    return m;
  }
  update(p: PlanetData, pos: T.Vector3) {
    if (this.planetId === p.id && pos.distanceTo(this.origin) < 24) return;
    if (this.planetId !== p.id) {
      this.clear();
      this.planetId = p.id;
      const crystalGeo = new T.ConeGeometry(1, 1, 5);
      crystalGeo.translate(0, 0.5, 0);
      this.meshes = [
        new T.InstancedMesh(crystalGeo, this.material(p, true), 4096),
        new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), this.material(p, false), 4096),
      ];
      this.group.add(...this.meshes);
    }
    this.origin.copy(pos);
    this.rebuilds++;
    const counts = [0, 0],
      dummy = new T.Object3D(),
      up = new T.Vector3(0, 1, 0);
    for (const sample of surfaceSamples(p, pos)) {
      const index = sample.crystal ? 0 : 1,
        mesh = this.meshes[index];
      if (counts[index] >= 4096) continue;
      dummy.position.copy(sample.position);
      dummy.quaternion.setFromUnitVectors(up, sample.up);
      dummy.scale.set(sample.size, sample.size * (sample.crystal ? 3 : 1), sample.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(counts[index]++, dummy.matrix);
    }
    this.meshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }
  clear() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      this.group.remove(mesh);
    }
    this.meshes = [];
    this.planetId = '';
    this.origin.set(Infinity, 0, 0);
  }
}
