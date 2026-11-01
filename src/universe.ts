import { Vector3, Color } from 'three';

export function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function lattice(x: number, y: number, z: number, seed: number) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) / 2147483648;
}
export function noise(x: number, y: number, z: number, seed: number) {
  const a = Math.floor(x),
    b = Math.floor(y),
    c = Math.floor(z);
  const u = fade(x - a),
    v = fade(y - b),
    w = fade(z - c);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(
      lerp(lattice(a, b, c, seed), lattice(a + 1, b, c, seed), u),
      lerp(lattice(a, b + 1, c, seed), lattice(a + 1, b + 1, c, seed), u),
      v,
    ),
    lerp(
      lerp(lattice(a, b, c + 1, seed), lattice(a + 1, b, c + 1, seed), u),
      lerp(lattice(a, b + 1, c + 1, seed), lattice(a + 1, b + 1, c + 1, seed), u),
      v,
    ),
    w,
  );
}
export interface PlanetData {
  id: string;
  name: string;
  epithet: string;
  seed: number;
  radius: number;
  position: Vector3;
  amplitude: number;
  colors: string[];
  atmosphere: string;
  ocean: boolean;
  rings: boolean;
  temperature: number;
  gravity: number;
}
export interface SystemData {
  id: number;
  name: string;
  designation: string;
  color: string;
  coord: [number, number];
  planets: PlanetData[];
  star: Vector3;
}
const themes = [
  {
    name: 'VESPER',
    epithet: '暮光之境',
    colors: ['#163641', '#515365', '#b07a86', '#dfb1a1', '#ead6c7'],
    atmosphere: '#69c9e7',
    ocean: true,
    rings: true,
    temp: 18,
  },
  {
    name: 'PYRA',
    epithet: '余烬荒原',
    colors: ['#392038', '#704242', '#b86c46', '#dfad78', '#f2dbad'],
    atmosphere: '#f59e5e',
    ocean: false,
    rings: false,
    temp: 67,
  },
  {
    name: 'NIVALIS',
    epithet: '静默冰原',
    colors: ['#1a354b', '#416e8a', '#86abb9', '#b7d0d1', '#eceddf'],
    atmosphere: '#a4bcf8',
    ocean: false,
    rings: false,
    temp: -83,
  },
  {
    name: 'VERDANT',
    epithet: '翡翠回声',
    colors: ['#122e35', '#25524f', '#69826b', '#b2a383', '#e4d9b1'],
    atmosphere: '#6fe0bb',
    ocean: true,
    rings: false,
    temp: 24,
  },
];
export function generateUniverse(seed = 'VOID-2401'): SystemData[] {
  const names = ['欧若拉', '织女座', '余烬海', '鲸落', '远日点'];
  return names.map((name, id) => {
    const rng = random(hash(seed + id));
    const planets = Array.from({ length: 3 }, (_, j) => {
      const th = themes[(id + j) % themes.length];
      const angle = j * 2.2 + id * 0.6;
      const radius = j === 0 ? 1500 : 720 + rng() * 650;
      return {
        id: `${id}-${j}`,
        name: id === 0 ? th.name : `${th.name} ${String.fromCharCode(65 + id)}`,
        epithet: th.epithet,
        seed: hash(`${seed}/${id}/${j}`),
        radius,
        position:
          j === 0
            ? new Vector3()
            : new Vector3(
                Math.sin(angle) * (15000 + j * 14000),
                (rng() - 0.5) * 8000,
                Math.cos(angle) * (15000 + j * 14000),
              ),
        amplitude: radius * (0.045 + rng() * 0.018),
        colors: th.colors,
        atmosphere: th.atmosphere,
        ocean: th.ocean,
        rings: th.rings,
        temperature: th.temp + Math.floor(rng() * 12) - 6,
        gravity: 0.4 + rng() * 0.7,
      };
    });
    return {
      id,
      name,
      designation: `EX-${String(2401 + id * 137)}`,
      color: ['#efc59a', '#9fc8ec', '#fa9a75', '#c7b6ef', '#c4e6dc'][id],
      coord: (
        [
          [-0.3, 0.15],
          [0.32, -0.3],
          [-0.12, -0.42],
          [0.35, 0.3],
          [-0.42, 0.42],
        ] as [number, number][]
      )[id],
      planets,
      star: new Vector3(-16000, 9000, 9000),
    };
  });
}
/** Shared by the adaptive mesh, flight collision, walking and surface placement. */
export function terrainHeight(p: PlanetData, d: Vector3) {
  const x = d.x,
    y = d.y,
    z = d.z;
  let h = noise(x * 2.8 + 7, y * 2.8, z * 2.8, p.seed) * 0.62;
  h += noise(x * 7, y * 7 + 5, z * 7, p.seed + 4) * 0.25;
  h += noise(x * 19, y * 19, z * 19 + 2, p.seed + 9) * 0.1;
  h += noise(x * 55, y * 55, z * 55, p.seed + 12) * 0.025;
  h += noise(x * 150, y * 150, z * 150, p.seed + 19) * 0.005;
  return h * p.amplitude + p.amplitude * 0.09;
}
export function surfaceRadius(p: PlanetData, d: Vector3) {
  return p.radius + Math.max(p.ocean ? 0 : -Infinity, terrainHeight(p, d));
}
export function altitude(p: PlanetData, position: Vector3) {
  const d = position.clone().sub(p.position);
  return d.length() - surfaceRadius(p, d.clone().normalize());
}
export function terrainColor(p: PlanetData, h: number) {
  const t = Math.max(0, Math.min(3.999, (h / p.amplitude + 0.15) * 4.4));
  const i = Math.floor(t);
  return new Color(p.colors[i]).lerp(new Color(p.colors[i + 1]), t - i);
}
export const UNIVERSE = generateUniverse();
export const METERS_PER_UNIT = 10;
export function distanceLabel(units: number) {
  const m = Math.max(0, units * METERS_PER_UNIT);
  return m >= 1e6
    ? `${(m / 1e6).toFixed(2)} Mm`
    : m >= 1000
      ? `${(m / 1000).toFixed(1)} km`
      : `${Math.round(m)} m`;
}
