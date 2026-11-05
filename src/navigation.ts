import { MathUtils, Vector2, Vector3, PerspectiveCamera, Raycaster } from 'three';
import { PlanetData, SystemData, altitude } from './universe';

export const FLIGHT = {
  cruise: 2200,
  boost: 1100,
  normal: 320,
  acceleration: 85,
  boostAcceleration: 210,
  deceleration: 160,
  turnRate: 1.1,
  guideTurnRate: 0.8,
};
export type Guidance = 'off' | 'align' | 'cruise';
export type NavigationStatus =
  'idle' | 'aligning' | 'cruising' | 'braking' | 'arrived' | 'blocked' | 'manual';
export function approach(value: number, target: number, amount: number) {
  return value + MathUtils.clamp(target - value, -amount, amount);
}
export function arrivalClearance(p: PlanetData) {
  return Math.max(400, p.radius * 0.65);
}
export function navigationMetrics(
  position: Vector3,
  forward: Vector3,
  velocity: Vector3,
  p: PlanetData,
) {
  const offset = p.position.clone().sub(position),
    direction = offset.clone().normalize();
  const distance = Math.max(0, altitude(p, position)),
    gap = Math.max(0, distance - arrivalClearance(p));
  const closingSpeed = velocity.dot(direction),
    speed = velocity.length();
  return {
    distance,
    centerDistance: offset.length(),
    gap,
    direction,
    headingError: MathUtils.radToDeg(forward.angleTo(direction)),
    closingSpeed,
    eta: closingSpeed > 1 ? gap / closingSpeed : null,
    stoppingDistance: (speed * speed) / (2 * FLIGHT.deceleration) + speed * 0.4,
  };
}
/** Returns the first surface crossed by a forward ray, with a real distance ordering. */
export function raySphereDistance(
  origin: Vector3,
  direction: Vector3,
  center: Vector3,
  radius: number,
) {
  const offset = origin.clone().sub(center),
    b = offset.dot(direction),
    c = offset.lengthSq() - radius * radius,
    discriminant = b * b - c;
  if (discriminant < 0) return null;
  const near = -b - Math.sqrt(discriminant),
    far = -b + Math.sqrt(discriminant);
  return near >= 0 ? near : far >= 0 ? 0 : null;
}
export function pickPlanet(system: SystemData, origin: Vector3, direction: Vector3) {
  let closest = raySphereDistance(origin, direction, system.star, 2300) ?? Infinity,
    index: number | null = null;
  system.planets.forEach((p, i) => {
    const hit = raySphereDistance(origin, direction, p.position, p.radius + p.amplitude * 0.25);
    if (hit !== null && hit < closest) {
      closest = hit;
      index = i;
    }
  });
  return index;
}
/** NDC (0,0) is the reticle; a free cursor uses its actual canvas coordinates. */
export function pickPlanetAtScreen(system: SystemData, camera: PerspectiveCamera, ndc: Vector2) {
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(ndc, camera);
  return pickPlanet(system, ray.ray.origin, ray.ray.direction);
}
/** A blocked direct course is reported instead of silently flying through another world. */
export function routeObstacle(system: SystemData, origin: Vector3, target: PlanetData) {
  const offset = target.position.clone().sub(origin),
    distance = offset.length() - target.radius - arrivalClearance(target);
  if (distance <= 0) return null;
  const direction = offset.normalize();
  let result: string | null = null,
    closest = distance;
  for (const body of [
    ...system.planets
      .filter((p) => p.id !== target.id)
      .map((p) => ({ name: p.name, position: p.position, radius: p.radius + p.amplitude + 100 })),
    { name: '恒星高温区', position: system.star, radius: 2600 },
  ]) {
    if (
      origin.distanceTo(body.position) < body.radius &&
      origin.clone().sub(body.position).dot(direction) > 0
    )
      continue;
    const hit = raySphereDistance(origin, direction, body.position, body.radius);
    if (hit !== null && hit < closest) {
      result = body.name;
      closest = hit;
    }
  }
  return result;
}
export function flightSpeedLimit(p: PlanetData, height: number, spaceLimit: number) {
  const h = height / p.radius;
  if (h < 0.3) return MathUtils.lerp(24, 100, MathUtils.smoothstep(h, 0.06, 0.3));
  return MathUtils.lerp(100, spaceLimit, MathUtils.smoothstep(h, 0.3, 0.65));
}
export interface ContactProjection {
  x: number;
  y: number;
  front: boolean;
  onScreen: boolean;
  rotation: number;
}
export function projectContact(
  camera: PerspectiveCamera,
  position: Vector3,
  width: number,
  height: number,
): ContactProjection {
  const local = position
      .clone()
      .sub(camera.position)
      .applyQuaternion(camera.quaternion.clone().invert()),
    front = local.z < 0;
  const p = position.clone().project(camera),
    cx = width / 2,
    cy = height / 2;
  const left = 70,
    right = width - Math.min(285, width * 0.25),
    top = Math.min(180, height * 0.27),
    bottom = height - Math.min(220, height * 0.28);
  const x = (p.x * 0.5 + 0.5) * width,
    y = (-p.y * 0.5 + 0.5) * height;
  const onScreen = front && x > left && x < right && y > top && y < bottom;
  if (onScreen) return { x, y, front, onScreen, rotation: 0 };
  let dx = local.x,
    dy = -local.y;
  if (Math.hypot(dx, dy) < 0.001) {
    dx = front ? 0 : 1;
    dy = front ? -1 : 0;
  }
  const factor = Math.min(
    dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity,
    dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity,
  );
  return {
    x: cx + dx * factor,
    y: cy + dy * factor,
    front,
    onScreen,
    rotation: MathUtils.radToDeg(Math.atan2(dy, dx)) + 90,
  };
}
