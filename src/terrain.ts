import * as T from 'three';
import { PlanetData, terrainHeight, terrainColor } from './universe';
const axes = [
  new T.Vector3(1, 0, 0),
  new T.Vector3(-1, 0, 0),
  new T.Vector3(0, 1, 0),
  new T.Vector3(0, -1, 0),
  new T.Vector3(0, 0, 1),
  new T.Vector3(0, 0, -1),
];
interface Tile {
  face: number;
  u: number;
  v: number;
  size: number;
  level: number;
}
export class Terrain {
  group = new T.Group();
  private patches = new Map<string, T.Mesh>();
  private material: T.MeshStandardMaterial;
  private last = new T.Vector3(Infinity, 0, 0);
  private interval = 0;
  constructor(readonly data: PlanetData) {
    this.material = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.05,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.planetRadius = { value: data.radius };
      shader.vertexShader =
        'varying vec3 vTerrainPosition;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvTerrainPosition=position;',
        );
      shader.fragmentShader =
        'varying vec3 vTerrainPosition;\nuniform float planetRadius;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
 float elevation=length(vTerrainPosition)-planetRadius;
 float strata=sin(elevation*2.4+sin(vTerrainPosition.x*.11)+sin(vTerrainPosition.z*.15));
 float grain=fract(sin(dot(floor(vTerrainPosition*9.),vec3(127.1,311.7,74.7)))*43758.5453);
 diffuseColor.rgb*=.88+strata*.045+grain*.14;
 `,
        );
    };
    this.group.position.copy(data.position);
    this.update(data.position.clone().add(new T.Vector3(0, 0, data.radius * 4)), true);
  }
  private direction(face: number, u: number, v: number) {
    const n = axes[face],
      a = new T.Vector3(n.y, n.z, n.x),
      b = new T.Vector3().crossVectors(n, a);
    return n.clone().addScaledVector(a, u).addScaledVector(b, v).normalize();
  }
  private key(t: Tile) {
    return `${t.face}/${t.level}/${t.u}/${t.v}`;
  }
  update(camera: T.Vector3, force = false) {
    if (!force && camera.distanceToSquared(this.last) < 0.09) return;
    this.last.copy(camera);
    const pos = camera.clone().sub(this.data.position),
      wanted = new Map<string, Tile>();
    const visit = (tile: Tile) => {
      const d = this.direction(tile.face, tile.u + tile.size / 2, tile.v + tile.size / 2),
        center = d.clone().multiplyScalar(this.data.radius + terrainHeight(this.data, d));
      const distance = Math.max(1, pos.distanceTo(center));
      const split =
        tile.level < 1 || (tile.level < 10 && distance < tile.size * this.data.radius * 1.55);
      if (split) {
        const s = tile.size / 2;
        for (let i = 0; i < 2; i++)
          for (let j = 0; j < 2; j++)
            visit({
              ...tile,
              u: tile.u + i * s,
              v: tile.v + j * s,
              size: s,
              level: tile.level + 1,
            });
      } else wanted.set(this.key(tile), tile);
    };
    for (let face = 0; face < 6; face++) visit({ face, u: -1, v: -1, size: 2, level: 0 });
    for (const [key, mesh] of this.patches)
      if (!wanted.has(key)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.patches.delete(key);
      }
    for (const [key, tile] of wanted)
      if (!this.patches.has(key)) {
        const mesh = this.create(tile);
        this.patches.set(key, mesh);
        this.group.add(mesh);
      }
  }
  tick(dt: number, camera: T.Vector3) {
    this.interval += dt;
    if (this.interval > 0.5) {
      this.interval = 0;
      this.update(camera);
    }
  }
  private create(tile: Tile) {
    const n = 12,
      verts: number[] = [],
      colors: number[] = [],
      indices: number[] = [],
      normals: number[] = [];
    const add = (i: number, j: number, skirt = false) => {
      const d = this.direction(
        tile.face,
        tile.u + (tile.size * i) / n,
        tile.v + (tile.size * j) / n,
      );
      const h = terrainHeight(this.data, d);
      const c = terrainColor(this.data, h);
      const shade = 1 + Math.sin(d.x * 613 + d.z * 817) * 0.018;
      c.multiplyScalar(shade);
      const r =
        this.data.radius + h - (skirt ? Math.max(0.07, tile.size * this.data.radius * 0.035) : 0);
      verts.push(d.x * r, d.y * r, d.z * r);
      colors.push(c.r, c.g, c.b);
      const east = new T.Vector3()
        .crossVectors(d, Math.abs(d.y) > 0.95 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0))
        .normalize();
      const north = new T.Vector3().crossVectors(d, east).normalize();
      const sample = (axis: T.Vector3) => {
        const q = d.clone().addScaledVector(axis, 0.00003).normalize();
        return q.multiplyScalar(this.data.radius + terrainHeight(this.data, q));
      };
      const center = d.clone().multiplyScalar(this.data.radius + h);
      const normal = new T.Vector3()
        .crossVectors(sample(east).sub(center), sample(north).sub(center))
        .normalize();
      if (normal.dot(d) < 0) normal.negate();
      normals.push(normal.x, normal.y, normal.z);
    };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) add(i, j);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i,
          b = a + 1,
          c = a + n + 1,
          d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    // Skirts close gaps where adjacent quadtree patches have different resolutions.
    const edges = [
      Array.from({ length: n + 1 }, (_, i) => [i, 0]),
      Array.from({ length: n + 1 }, (_, i) => [n, i]),
      Array.from({ length: n + 1 }, (_, i) => [n - i, n]),
      Array.from({ length: n + 1 }, (_, i) => [0, n - i]),
    ];
    for (const edge of edges) {
      const base = verts.length / 3;
      for (const [i, j] of edge) add(i, j, true);
      for (let k = 0; k < n; k++) {
        const [i, j] = edge[k],
          [ii, jj] = edge[k + 1];
        const a = j * (n + 1) + i,
          b = jj * (n + 1) + ii;
        indices.push(a, base + k, b, b, base + k, base + k + 1);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    g.setIndex(indices);
    const mesh = new T.Mesh(g, this.material);
    mesh.frustumCulled = true;
    return mesh;
  }
  dispose() {
    for (const m of this.patches.values()) m.geometry.dispose();
    this.patches.clear();
    this.material.dispose();
  }
  get patchCount() {
    return this.patches.size;
  }
}
