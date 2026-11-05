import { Vector3 } from 'three';

/** Metre-authored Blender asset -> existing 10 m/game-unit simulation. */
export const SHIP_LAYOUT = {
  scale: 0.1,
  landingDatumMetres: 6.1,
  boardingRadius: 1.2,
  exit: [-0.325, 0, 0.09] as const,
  chase: [0, 1, 4.6] as const,
  lookTarget: [0, -0.375, 0] as const,
  // Conservative envelope around the legacy simulation datum, including swept wings.
  flightClearance: 1.4,
};

// Broad hull envelope only. Wings are overhead; there is no triangle-mesh physics.
// Polygon vertices are [starboard, aft], in game units, expanded for a 0.3 m visitor.
const hull: [number, number][] = [
  [0, -0.94],
  [0.11, -0.62],
  [0.17, -0.37],
  [0.23, -0.02],
  [0.23, 0.4],
  [0.275, 0.435],
  [0.275, 0.94],
  [-0.275, 0.94],
  [-0.275, 0.435],
  [-0.23, 0.4],
  [-0.23, -0.02],
  [-0.17, -0.37],
  [-0.11, -0.62],
];
/** Push a local surface visitor out of the hull/nacelle envelope, preserving height. */
export function avoidShipHull(local: Vector3) {
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const a = hull[i],
      b = hull[j];
    if (
      a[1] > local.z !== b[1] > local.z &&
      local.x < ((b[0] - a[0]) * (local.z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  if (!inside) return local;
  let best = Infinity,
    bx = local.x,
    bz = local.z;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i],
      b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((local.x - a[0]) * dx + (local.z - a[1]) * dz) / (dx * dx + dz * dz)),
    );
    const x = a[0] + dx * t,
      z = a[1] + dz * t;
    const d = (x - local.x) ** 2 + (z - local.z) ** 2;
    if (d < best) {
      best = d;
      bx = x;
      bz = z;
    }
  }
  local.x = bx;
  local.z = bz;
  return local;
}
