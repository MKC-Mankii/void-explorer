import * as T from 'three';
import { createTerrainMaterial } from './planet-materials';
import { PlanetData, terrainHeight } from './universe';
const axes = [
  new T.Vector3(1, 0, 0),
  new T.Vector3(-1, 0, 0),
  new T.Vector3(0, 1, 0),
  new T.Vector3(0, -1, 0),
  new T.Vector3(0, 0, 1),
  new T.Vector3(0, 0, -1),
];
interface TileNode {
  face: number;
  u: number;
  v: number;
  size: number;
  level: number;
  parent: TileNode | null;
  children: TileNode[] | null;
  mesh: T.Mesh | null;
  splitWanted: boolean;
  previousWanted: boolean;
  splitActive: boolean;
  fresh: boolean;
  weight: number;
  score: number;
}
/** Coverage is retained until children are ready; positions/normals morph from the parent. */
export class Terrain {
  group = new T.Group();
  private nodes = new Map<string, TileNode>();
  private roots: TileNode[] = [];
  private material: T.MeshStandardMaterial;
  private last = new T.Vector3(Infinity, 0, 0);
  private interval = 0;
  private pending: TileNode[] = [];
  private wanted = new Set<TileNode>();
  private generated = 0;
  constructor(readonly data: PlanetData) {
    this.material = createTerrainMaterial(data);
    this.group.position.copy(data.position);
    for (let face = 0; face < 6; face++) {
      const root = this.node(face, -1, -1, 2, 0, null);
      root.mesh = this.create(root);
      this.group.add(root.mesh);
      this.roots.push(root);
    }
    this.update(data.position.clone().add(new T.Vector3(0, 0, data.radius * 4)), true);
  }
  private node(
    face: number,
    u: number,
    v: number,
    size: number,
    level: number,
    parent: TileNode | null,
  ) {
    const key = `${face}/${level}/${u}/${v}`;
    let node = this.nodes.get(key);
    if (!node) {
      node = {
        face,
        u,
        v,
        size,
        level,
        parent,
        children: null,
        mesh: null,
        splitWanted: false,
        previousWanted: false,
        splitActive: false,
        fresh: false,
        weight: 0,
        score: 0,
      };
      this.nodes.set(key, node);
    }
    return node;
  }
  private direction(face: number, u: number, v: number) {
    const normal = axes[face],
      a = new T.Vector3(normal.y, normal.z, normal.x),
      b = new T.Vector3().crossVectors(normal, a);
    return normal.clone().addScaledVector(a, u).addScaledVector(b, v).normalize();
  }
  update(camera: T.Vector3, force = false) {
    if (!force && camera.distanceToSquared(this.last) < 0.09) return;
    this.last.copy(camera);
    const pos = camera.clone().sub(this.data.position);
    this.wanted.clear();
    for (const node of this.nodes.values()) {
      node.previousWanted = node.splitWanted;
      node.splitWanted = false;
    }
    const visit = (node: TileNode) => {
      this.wanted.add(node);
      const d = this.direction(node.face, node.u + node.size / 2, node.v + node.size / 2);
      const center = d.clone().multiplyScalar(this.data.radius + terrainHeight(this.data, d));
      const distance = Math.max(0.1, pos.distanceTo(center));
      node.score = distance / (node.size * this.data.radius);
      node.splitWanted =
        node.level < 1 || (node.level < 10 && node.score < (node.previousWanted ? 2.1 : 1.8));
      if (node.splitWanted) {
        if (!node.children) {
          const size = node.size / 2;
          node.children = [];
          for (let i = 0; i < 2; i++)
            for (let j = 0; j < 2; j++)
              node.children.push(
                this.node(
                  node.face,
                  node.u + i * size,
                  node.v + j * size,
                  size,
                  node.level + 1,
                  node,
                ),
              );
        }
        node.children.forEach(visit);
      }
    };
    this.roots.forEach(visit);
    this.pending = [...this.wanted]
      .filter((n) => !n.mesh)
      .sort((a, b) => a.score - b.score || a.level - b.level);
    if (force) {
      const ensure = (n: TileNode) => {
        if (n.mesh) return;
        if (n.parent) ensure(n.parent);
        n.mesh = this.create(n);
        this.group.add(n.mesh);
      };
      for (const n of this.wanted) ensure(n);
      this.pending = [];
      for (const n of this.nodes.values()) {
        n.splitActive = n.splitWanted;
        n.fresh = false;
        this.setInfluence(n, 0);
      }
      this.visibility(0, true);
    }
  }
  tick(dt: number, camera: T.Vector3) {
    this.interval += dt;
    if (this.interval > 0.25) {
      this.interval = 0;
      this.update(camera);
    }
    const start = performance.now();
    this.generated = 0;
    while (this.pending.length && this.generated < 8 && performance.now() - start < 8) {
      const index = this.pending.findIndex((n) => n.parent?.mesh?.visible);
      if (index < 0) break;
      const node = this.pending.splice(index, 1)[0];
      node.mesh = this.create(node);
      node.mesh.visible = false;
      this.group.add(node.mesh);
      this.generated++;
    }
    this.visibility(Math.min(dt, 0.1));
    this.trimCache();
  }
  private influence(n: TileNode) {
    return n.weight;
  }
  private setInfluence(n: TileNode, value: number) {
    const weight = T.MathUtils.clamp(value, 0, 1);
    if (!n.mesh || Math.abs(n.weight - weight) < 0.00001) return;
    n.weight = weight;
    const g = n.mesh.geometry,
      data = g.userData.morph;
    if (!data) return;
    const positions = g.getAttribute('position') as T.BufferAttribute,
      normals = g.getAttribute('normal') as T.BufferAttribute;
    for (let i = 0; i < positions.array.length; i++) {
      positions.array[i] =
        data.finePositions[i] + (data.coarsePositions[i] - data.finePositions[i]) * weight;
      normals.array[i] =
        data.fineNormals[i] + (data.coarseNormals[i] - data.fineNormals[i]) * weight;
    }
    const elevation = g.getAttribute('veElevation') as T.BufferAttribute;
    for (let i = 0; i < elevation.count; i++)
      elevation.array[i] =
        data.fineElevations[i] + (data.coarseElevations[i] - data.fineElevations[i]) * weight;
    elevation.needsUpdate = true;
    positions.needsUpdate = true;
    normals.needsUpdate = true;
  }
  private visibility(dt: number, force = false) {
    for (const n of this.nodes.values()) if (n.mesh) n.mesh.visible = false;
    const show = (node: TileNode, hold = false) => {
      if (!node.mesh) return;
      const children = node.children;
      if (node.splitWanted && children?.every((n) => n.mesh) && this.influence(node) < 0.001) {
        if (!node.splitActive) {
          node.splitActive = true;
          children.forEach((n) => {
            this.setInfluence(n, force ? 0 : 1);
            n.fresh = !force;
          });
        }
        children.forEach((n) => show(n));
        return;
      }
      if (!node.splitWanted && node.splitActive && children) {
        children.forEach((n) => show(n, true));
        if (children.every((n) => !n.splitActive)) {
          children.forEach((n) => this.setInfluence(n, this.influence(n) + dt / 0.3));
          if (children.every((n) => this.influence(n) > 0.999)) {
            children.forEach((n) => {
              if (n.mesh) n.mesh.visible = false;
            });
            node.splitActive = false;
            node.mesh.visible = true;
          }
        }
        return;
      }
      node.mesh.visible = true;
      if (!hold) {
        if (node.fresh) node.fresh = false;
        else this.setInfluence(node, this.influence(node) - dt / 0.35);
      }
    };
    this.roots.forEach((n) => show(n));
  }
  private trimCache() {
    let count = [...this.nodes.values()].filter((n) => n.mesh).length;
    if (count <= 900) return;
    for (const n of [...this.nodes.values()].sort((a, b) => b.level - a.level)) {
      if (count <= 900) break;
      if (n.level > 1 && n.mesh && !n.mesh.visible && !this.wanted.has(n) && !n.splitActive) {
        this.group.remove(n.mesh);
        n.mesh.geometry.dispose();
        n.mesh = null;
        n.weight = 0;
        n.fresh = false;
        count--;
      }
    }
  }
  private create(tile: TileNode) {
    const n = 16,
      count = (n + 1) * (n + 1) + 4 * (n + 1),
      verts = new Float32Array(count * 3),
      normals = new Float32Array(count * 3),
      elevations = new Float32Array(count),
      coarseElevations = tile.parent ? new Float32Array(count) : null,
      coarsePositions = tile.parent ? new Float32Array(count * 3) : null,
      coarseNormals = tile.parent ? new Float32Array(count * 3) : null,
      indices: number[] = [];
    const axis = axes[tile.face],
      a = new T.Vector3(axis.y, axis.z, axis.x),
      b = new T.Vector3().crossVectors(axis, a);
    const d = new T.Vector3(),
      east = new T.Vector3(),
      north = new T.Vector3(),
      q1 = new T.Vector3(),
      q2 = new T.Vector3(),
      center = new T.Vector3(),
      normal = new T.Vector3(),
      coarse = new T.Vector3(),
      coarseNormal = new T.Vector3(),
      worldUp = new T.Vector3(0, 1, 0),
      poleUp = new T.Vector3(1, 0, 0);
    let vertex = 0;
    const parent = tile.parent,
      parentPosition = parent?.mesh?.geometry.userData.finePosition as
        T.BufferAttribute | undefined,
      parentNormal = parent?.mesh?.geometry.userData.fineNormal as T.BufferAttribute | undefined;
    const add = (i: number, j: number, skirt = false) => {
      d.copy(axis)
        .addScaledVector(a, tile.u + (tile.size * i) / n)
        .addScaledVector(b, tile.v + (tile.size * j) / n)
        .normalize();
      const h = terrainHeight(this.data, d),
        drop = skirt ? Math.max(0.07, tile.size * this.data.radius * 0.035) : 0,
        r = this.data.radius + h - drop,
        k = vertex++ * 3;
      elevations[k / 3] = h;
      verts[k] = d.x * r;
      verts[k + 1] = d.y * r;
      verts[k + 2] = d.z * r;
      east.crossVectors(d, Math.abs(d.y) > 0.95 ? poleUp : worldUp).normalize();
      north.crossVectors(d, east).normalize();
      center.copy(d).multiplyScalar(this.data.radius + h);
      q1.copy(d).addScaledVector(east, 0.00003).normalize();
      q1.multiplyScalar(this.data.radius + terrainHeight(this.data, q1)).sub(center);
      q2.copy(d).addScaledVector(north, 0.00003).normalize();
      q2.multiplyScalar(this.data.radius + terrainHeight(this.data, q2)).sub(center);
      normal.crossVectors(q1, q2).normalize();
      if (normal.dot(d) < 0) normal.negate();
      normals[k] = normal.x;
      normals[k + 1] = normal.y;
      normals[k + 2] = normal.z;
      if (parent && parentPosition && parentNormal && coarsePositions && coarseNormals) {
        const step = parent.size / n,
          px = (tile.u + (tile.size * i) / n - parent.u) / step,
          py = (tile.v + (tile.size * j) / n - parent.v) / step,
          ix = Math.min(n - 1, Math.floor(px)),
          iy = Math.min(n - 1, Math.floor(py)),
          tx = px - ix,
          ty = py - iy,
          base = iy * (n + 1) + ix,
          lower = tx + ty <= 1;
        const i0 = lower ? base : base + 1,
          i1 = lower ? base + 1 : base + n + 2,
          i2 = base + n + 1,
          w0 = lower ? 1 - tx - ty : 1 - ty,
          w1 = lower ? tx : tx + ty - 1,
          w2 = lower ? ty : 1 - tx;
        const blend = (attribute: T.BufferAttribute, target: T.Vector3) =>
          target.set(
            attribute.getX(i0) * w0 + attribute.getX(i1) * w1 + attribute.getX(i2) * w2,
            attribute.getY(i0) * w0 + attribute.getY(i1) * w1 + attribute.getY(i2) * w2,
            attribute.getZ(i0) * w0 + attribute.getZ(i1) * w1 + attribute.getZ(i2) * w2,
          );
        const parentElevation = parent!.mesh!.geometry.userData.fineElevation as T.BufferAttribute;
        coarseElevations![k / 3] =
          parentElevation.getX(i0) * w0 +
          parentElevation.getX(i1) * w1 +
          parentElevation.getX(i2) * w2;
        blend(parentPosition, coarse).addScaledVector(d, -drop);
        blend(parentNormal, coarseNormal).normalize();
        coarsePositions[k] = coarse.x;
        coarsePositions[k + 1] = coarse.y;
        coarsePositions[k + 2] = coarse.z;
        coarseNormals[k] = coarseNormal.x;
        coarseNormals[k + 1] = coarseNormal.y;
        coarseNormals[k + 2] = coarseNormal.z;
      }
    };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) add(i, j);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const v = j * (n + 1) + i;
        indices.push(v, v + 1, v + n + 1, v + 1, v + n + 2, v + n + 1);
      }
    const edges = [
      Array.from({ length: n + 1 }, (_, i) => [i, 0]),
      Array.from({ length: n + 1 }, (_, i) => [n, i]),
      Array.from({ length: n + 1 }, (_, i) => [n - i, n]),
      Array.from({ length: n + 1 }, (_, i) => [0, n - i]),
    ];
    for (const edge of edges) {
      const base = vertex;
      for (const [i, j] of edge) add(i, j, true);
      for (let i = 0; i < n; i++) {
        const [x, y] = edge[i],
          [xx, yy] = edge[i + 1],
          v = y * (n + 1) + x,
          next = yy * (n + 1) + xx;
        indices.push(v, base + i, next, next, base + i, base + i + 1);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(verts, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
    geometry.setAttribute('veElevation', new T.BufferAttribute(elevations, 1));
    geometry.userData.fineElevation = new T.BufferAttribute(elevations.slice(), 1);
    geometry.setIndex(indices);
    geometry.userData.finePosition = new T.BufferAttribute(verts.slice(), 3);
    geometry.userData.fineNormal = new T.BufferAttribute(normals.slice(), 3);
    if (coarsePositions && coarseNormals) {
      geometry.userData.morph = {
        finePositions: geometry.userData.finePosition.array,
        fineNormals: geometry.userData.fineNormal.array,
        coarsePositions,
        coarseNormals,
        fineElevations: geometry.userData.fineElevation.array,
        coarseElevations,
      };
      const bounds = new T.Box3().setFromBufferAttribute(
        geometry.getAttribute('position') as T.BufferAttribute,
      );
      bounds.union(new T.Box3().setFromBufferAttribute(new T.BufferAttribute(coarsePositions, 3)));
      geometry.boundingSphere = bounds.getBoundingSphere(new T.Sphere());
    }
    return new T.Mesh(geometry, this.material);
  }
  dispose() {
    for (const n of this.nodes.values()) n.mesh?.geometry.dispose();
    this.group.clear();
    this.nodes.clear();
    this.material.dispose();
  }
  get patchCount() {
    return [...this.nodes.values()].filter((n) => n.mesh?.visible).length;
  }
  get diagnostics() {
    return {
      active: this.patchCount,
      cached: [...this.nodes.values()].filter((n) => n.mesh).length,
      queued: this.pending.length,
      generatedLastFrame: this.generated,
      transitioning: [...this.nodes.values()].filter(
        (n) => n.mesh?.visible && this.influence(n) > 0.001,
      ).length,
    };
  }
}
