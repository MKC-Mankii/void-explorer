import * as T from 'three';
import type { PlanetData } from './universe';

/** Presentation only: the existing ship is posed for a single render, never the simulation. */
export class Opening {
  readonly lights = new T.Group();
  private readonly fill = new T.DirectionalLight('#c6eaff', 1.4);
  private readonly rim = new T.DirectionalLight('#ffd6aa', 0.7);
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly radial = new T.Vector3(0.28, 0.24, 1).normalize();
  private readonly point = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly angle = new T.Euler();
  private time = 0;
  private active = false;

  constructor() {
    this.lights.name = 'Opening_Local_Fill';
    this.lights.add(this.fill, this.fill.target, this.rim, this.rim.target);
    this.lights.visible = false;
  }

  present(
    camera: T.PerspectiveCamera,
    ship: T.Group,
    center: T.Vector3,
    planet: PlanetData,
    dt: number,
  ) {
    this.active = true;
    this.lights.visible = true;
    if (!this.motion.matches) this.time += dt;
    const drift = this.motion.matches ? 0 : Math.sin(this.time * 0.12) * 0.018;
    camera.position.copy(planet.position).addScaledVector(this.radial, planet.radius * 5.6);
    camera.up.set(0, 1, 0);
    camera.lookAt(planet.position);
    camera.fov = 48;
    camera.near = 0.04;
    // Reserve the left half for the existing welcome actions, including narrow desktops.
    camera.setViewOffset(
      innerWidth,
      innerHeight,
      -innerWidth * 0.22,
      innerHeight * 0.17,
      innerWidth,
      innerHeight,
    );
    camera.updateMatrixWorld();
    this.point
      .set(0.39, -0.04 + drift, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    ship.position.copy(camera.position).addScaledVector(this.point, 4.2);
    this.angle.set(0.45, -0.9 + drift, -0.1);
    this.rotation.setFromEuler(this.angle);
    ship.quaternion.copy(camera.quaternion).multiply(this.rotation);
    ship.position.sub(this.point.copy(center).applyQuaternion(ship.quaternion));
    ship.visible = true;
    this.point.set(-1.8, 2, 0.8).applyQuaternion(camera.quaternion);
    this.fill.position.copy(ship.position).add(this.point);
    this.point.set(2, 0.8, -1.5).applyQuaternion(camera.quaternion);
    this.rim.position.copy(ship.position).add(this.point);
    this.fill.target.position.copy(ship.position);
    this.rim.target.position.copy(ship.position);
  }

  leave(camera: T.PerspectiveCamera) {
    if (!this.active) return;
    this.active = false;
    this.lights.visible = false;
    camera.clearViewOffset();
    // updateCamera sets the original gameplay FOV immediately on this same frame.
  }

  get visible() {
    return this.active;
  }

  observe(camera: T.PerspectiveCamera, ship: T.Group) {
    if (!this.active) return { active: false };
    const bounds = new T.Box3().setFromObject(ship);
    const projected = new T.Box2();
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = new T.Vector3(x, y, z).project(camera);
          projected.expandByPoint(new T.Vector2((p.x + 1) / 2, (1 - p.y) / 2));
        }
    return {
      active: true,
      reducedMotion: this.motion.matches,
      bounds: { min: projected.min.toArray(), max: projected.max.toArray() },
    };
  }
}
