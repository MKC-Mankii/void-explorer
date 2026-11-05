import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHIP_LAYOUT } from './ship-layout';
import type { Mode } from './simulation';

export const AURORA_URL = new URL('../assets/aurora/aurora.glb', import.meta.url).href;
export class Spacecraft {
  readonly group = new T.Group();
  readonly ready: Promise<boolean>;
  state: 'loading' | 'ready' | 'error' = 'loading';
  error: string | null = null;
  cockpitOffset = new T.Vector3(0, -0.242, -0.35);
  targetOffset = new T.Vector3(0, -0.375, 0);
  private model?: T.Group;
  private flames: T.Mesh<T.ConeGeometry, T.MeshBasicMaterial>[] = [];
  private gear: T.Object3D[] = [];
  private contacts: T.Object3D[] = [];
  private wings: T.Object3D[] = [];
  private engines: T.Object3D[] = [];
  private extension = 0;
  private triangles = 0;
  private primitives = 0;
  private bounds = new T.Box3();
  private materials = new Set<T.Material>();
  private textures = new Set<T.Texture>();
  private readonly loadStarted = performance.now();
  private loadMs: number | null = null;

  constructor() {
    this.group.name = 'Player_AURORA';
    this.group.scale.setScalar(SHIP_LAYOUT.scale);
    this.ready = new GLTFLoader()
      .loadAsync(AURORA_URL)
      .then((gltf) => {
        const model = gltf.scene;
        const requireNode = (name: string) => {
          const node = model.getObjectByName(name);
          if (!node) throw new Error(`AURORA missing required mount: ${name}`);
          return node;
        };
        model.traverse((node) => {
          if (node.userData.part === 'wing') this.wings.push(node);
          if (node.userData.part === 'main_engine') this.engines.push(node);
          if (node.userData.part === 'landing_gear' || node.userData.part === 'boarding_steps')
            this.gear.push(node);
          if (node.userData.part === 'ground_contact') this.contacts.push(node);
          if (node instanceof T.Mesh) {
            this.triangles +=
              (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
            this.primitives++;
            for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
              this.materials.add(m);
              for (const value of Object.values(m))
                if (value instanceof T.Texture) this.textures.add(value);
            }
          }
        });
        if (this.wings.length !== 4 || this.engines.length !== 2 || this.contacts.length !== 4)
          throw new Error('AURORA structural contract failed');
        model.updateMatrixWorld(true);
        this.bounds.setFromObject(model);
        // Source feet are at Y=0. Keep the existing simulation's 6.1 m landing datum.
        model.position.y = -SHIP_LAYOUT.landingDatumMetres;
        this.group.add(model);
        this.group.updateMatrixWorld(true);
        const localMount = (name: string) =>
          this.group
            .worldToLocal(requireNode(name).getWorldPosition(new T.Vector3()))
            .multiplyScalar(SHIP_LAYOUT.scale);
        this.cockpitOffset.copy(localMount('Cockpit_View'));
        this.targetOffset.copy(localMount('Chase_Target'));
        requireNode('Boarding_Exit');
        const geometry = new T.ConeGeometry(0.34, 3, 12);
        geometry.rotateX(Math.PI / 2);
        geometry.translate(0, 0, 1.5);
        const material = new T.MeshBasicMaterial({
          color: '#9cefff',
          transparent: true,
          opacity: 0.75,
          blending: T.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        for (const side of ['Port', 'Starboard']) {
          const flame = new T.Mesh(geometry, material);
          flame.name = `Plume_${side}`;
          requireNode(`Exhaust_${side}`).add(flame);
          this.flames.push(flame);
        }
        this.model = model;
        this.state = 'ready';
        this.loadMs = performance.now() - this.loadStarted;
        this.update(0, 0, 'flight', 0);
        return true;
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error);
        this.state = 'error';
        this.group.clear();
        return false;
      });
  }
  update(thrust: number, time: number, mode: Mode, dt: number) {
    const target = mode === 'flight' || mode === 'takeoff' ? 0 : 1;
    this.extension = dt <= 0 ? target : T.MathUtils.damp(this.extension, target, 5, dt);
    if (Math.abs(this.extension - target) < 0.001) this.extension = target;
    for (const gear of this.gear) {
      gear.visible = this.extension > 0.01;
      gear.scale.y = Math.max(0.001, this.extension);
    }
    for (const flame of this.flames) {
      flame.visible = thrust > 0.02 && mode !== 'landed' && mode !== 'walking';
      flame.scale.z = 0.35 + thrust * 1.7 + Math.sin(time * 38) * 0.05;
    }
  }
  conformGear(clearance: (point: T.Vector3) => number) {
    this.group.updateMatrixWorld(true);
    for (const gear of this.gear) {
      if (gear.userData.part !== 'landing_gear') continue;
      const height = clearance(gear.getWorldPosition(new T.Vector3()));
      gear.scale.y = T.MathUtils.clamp(height / 0.15, 0.2, 2);
    }
  }
  observe() {
    this.group.updateMatrixWorld(true);
    return {
      name: 'AURORA',
      state: this.state,
      error: this.error,
      url: AURORA_URL,
      sourceUnits: 'metres',
      scaleToGame: SHIP_LAYOUT.scale,
      sizeMetres: this.bounds.isEmpty() ? null : this.bounds.getSize(new T.Vector3()).toArray(),
      triangles: this.triangles,
      meshPrimitives: this.primitives,
      materials: this.materials.size,
      textures: this.textures.size,
      loadMs: this.loadMs,
      gearExtension: this.extension,
      wings: this.wings.map((node) => ({
        name: node.name,
        pair: node.userData.pair,
        side: node.userData.side,
      })),
      engines: this.engines.map((node) => node.name),
      cockpitOffset: this.cockpitOffset.toArray(),
      groundContacts: this.contacts.map((node) => node.getWorldPosition(new T.Vector3()).toArray()),
      plumes: this.flames.map((node) => ({
        name: node.name,
        visible: node.visible,
        position: node.getWorldPosition(new T.Vector3()).toArray(),
        direction: new T.Vector3(0, 0, 1).transformDirection(node.matrixWorld).toArray(),
      })),
      visible: this.group.visible,
      modelLoaded: !!this.model,
    };
  }
}
