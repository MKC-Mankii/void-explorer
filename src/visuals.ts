import * as T from 'three';
import { PlanetData, SystemData, random, terrainHeight, noise } from './universe';
/** Custom shaders must share Three.js logarithmic depth with terrain and spacecraft. */
function makeShader(parameters: T.ShaderMaterialParameters) {
  parameters.vertexShader =
    '#include <common>\n#include <logdepthbuf_pars_vertex>\n' +
    parameters.vertexShader!.replace(
      /gl_Position=([^;]+);/g,
      '$&\n#include <logdepthbuf_vertex>\n',
    );
  parameters.fragmentShader =
    '#include <logdepthbuf_pars_fragment>\n' +
    parameters.fragmentShader!.replace(
      'void main(){',
      'void main(){\n#include <logdepthbuf_fragment>\n',
    );
  return new T.ShaderMaterial(parameters);
}
export const glslNoise = `
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 p=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(hash(p),hash(p+vec3(1,0,0)),f.x),mix(hash(p+vec3(0,1,0)),hash(p+vec3(1,1,0)),f.x),f.y),mix(mix(hash(p+vec3(0,0,1)),hash(p+vec3(1,0,1)),f.x),mix(hash(p+vec3(0,1,1)),hash(p+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){return noise(p)*.57+noise(p*2.03)*.28+noise(p*4.07)*.15;}`;
export function makeSky() {
  const group = new T.Group();
  const w = 512,
    h = 256,
    texels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const phi = (x / w) * Math.PI * 2,
        theta = (y / h) * Math.PI;
      const d = new T.Vector3(
        -Math.cos(phi) * Math.sin(theta),
        -Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
      );
      const n = (noise(d.x * 6 + 4, d.y * 6 + 1, d.z * 6 + 8, 351) + 1) * 0.5;
      const detail = (noise(d.x * 25, d.y * 25, d.z * 25, 53) + 1) * 0.5;
      const band = Math.exp(-Math.pow((d.y * 0.8 + d.x * 0.35 - 0.12) * 3.6, 2));
      const i = (y * w + x) * 4;
      texels[i] = Math.min(255, (0.004 + 0.065 * band * n * n + 0.012 * Math.pow(n, 4)) * 255);
      texels[i + 1] = Math.min(
        255,
        (0.008 + 0.032 * band * n * n + 0.04 * band * detail ** 3) * 255,
      );
      texels[i + 2] = Math.min(
        255,
        (0.017 + 0.11 * band * n * n + 0.05 * band * detail ** 3) * 255,
      );
      texels[i + 3] = 255;
    }
  const texture = new T.DataTexture(texels, w, h);
  texture.needsUpdate = true;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearFilter;
  texture.wrapS = T.RepeatWrapping;
  const sphere = new T.Mesh(
    new T.SphereGeometry(350000, 32, 24),
    makeShader({
      uniforms: {
        sky: { value: texture },
        air: { value: new T.Color('#69c9e7') },
        amount: { value: 0 },
        up: { value: new T.Vector3(0, 1, 0) },
      },
      side: T.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 v;varying vec2 vUv;void main(){v=position;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:
        'varying vec3 v;varying vec2 vUv;uniform sampler2D sky;uniform vec3 air;uniform float amount;uniform vec3 up;void main(){vec3 d=normalize(v);vec3 c=texture2D(sky,vUv).rgb;float horizon=pow(1.-max(0.,dot(d,up)),3.);vec3 haze=air*(.085+horizon*.21);c=mix(c,haze,amount);gl_FragColor=vec4(c,1.);}',
    }),
  );
  group.add(sphere);
  const rng = random(83319),
    positions: number[] = [],
    colors: number[] = [];
  for (let i = 0; i < 7000; i++) {
    const z = rng() * 2 - 1,
      a = rng() * Math.PI * 2,
      r = Math.sqrt(1 - z * z),
      d = new T.Vector3(r * Math.cos(a), z, r * Math.sin(a)).multiplyScalar(280000);
    positions.push(d.x, d.y, d.z);
    const c = new T.Color().setHSL(0.52 + rng() * 0.22, 0.08 + rng() * 0.35, 0.35 + rng() * 0.55);
    colors.push(c.r, c.g, c.b);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  group.add(
    new T.Points(
      geo,
      new T.PointsMaterial({
        size: 1.35,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    ),
  );
  return group;
}

export function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,.9)');
  g.addColorStop(0.3, 'rgba(255,255,255,.24)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new T.CanvasTexture(canvas);
}
const glow = () =>
  new T.SpriteMaterial({
    map: glowTexture(),
    color: '#ffb981',
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
  });
export function makeStar(system: SystemData) {
  const group = new T.Group();
  group.position.copy(system.star);
  const color = new T.Color(system.color);
  const mesh = new T.Mesh(
    new T.SphereGeometry(1600, 64, 32),
    makeShader({
      uniforms: { color: { value: color }, time: { value: 0 } },
      vertexShader:
        'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 v;uniform vec3 color;uniform float time;${glslNoise}void main(){float n=fbm(v*18.+time*.03);gl_FragColor=vec4(color*(2.+n*1.6),1.);}`,
    }),
  );
  group.add(mesh);
  const halo = new T.Sprite(glow());
  halo.material.color.copy(color);
  halo.scale.setScalar(10500);
  group.add(halo);
  return group;
}
export function makeAtmosphere(p: PlanetData, star: T.Vector3) {
  const mesh = new T.Mesh(
    new T.SphereGeometry(p.radius * 1.065, 64, 48),
    makeShader({
      uniforms: {
        color: { value: new T.Color(p.atmosphere) },
        sun: { value: star.clone().sub(p.position).normalize() },
      },
      vertexShader:
        'varying vec3 vNormal;varying vec3 vWorld;void main(){vNormal=normalize(mat3(modelMatrix)*normal);vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}',
      fragmentShader: `varying vec3 vNormal;varying vec3 vWorld;uniform vec3 color;uniform vec3 sun;void main(){vec3 n=normalize(vNormal);float edge=pow(1.-abs(dot(n,normalize(cameraPosition-vWorld))),3.2);float day=.2+.8*smoothstep(-.4,.8,dot(n,sun));gl_FragColor=vec4(color*1.05,edge*day*.28);}`,
      side: T.BackSide,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.position.copy(p.position);
  return mesh;
}
export function makeOcean(p: PlanetData) {
  const material = new T.MeshStandardMaterial({
    color: '#123c4d',
    metalness: 0.48,
    roughness: 0.3,
    transparent: true,
    opacity: 0.91,
  });
  const mesh = new T.Mesh(new T.SphereGeometry(p.radius + 0.1, 128, 80), material);
  mesh.position.copy(p.position);
  return mesh;
}
export function makeClouds(p: PlanetData) {
  const mesh = new T.Mesh(
    new T.SphereGeometry(p.radius * 1.015, 64, 48),
    makeShader({
      uniforms: { tint: { value: new T.Color(p.atmosphere) } },
      vertexShader:
        'varying vec3 v;varying vec3 n;void main(){v=normalize(position);n=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 v;varying vec3 n;uniform vec3 tint;${glslNoise}void main(){float c=fbm(v*20.+vec3(11.,3.,6.));float a=smoothstep(.55,.76,c)*.24;gl_FragColor=vec4(mix(tint,vec3(1.),.65),a);}`,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.position.copy(p.position);
  return mesh;
}
export function makeRings(p: PlanetData) {
  const group = new T.Group();
  group.position.copy(p.position);
  group.rotation.set(0.39, 0, -0.38);
  const material = makeShader({
    uniforms: { color: { value: new T.Color('#b7a5af') } },
    vertexShader:
      'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec2 vUv;uniform vec3 color;void main(){float r=length(vUv-.5)*2.;float str=.55+.12*sin(r*180.)+.07*sin(r*450.);float gap=1.-smoothstep(.006,.012,abs(r-.73));float alpha=(.07+str*.16)*(1.-gap*.95);gl_FragColor=vec4(color*(.7+str*.5),alpha);}`,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const geo = new T.RingGeometry(p.radius * 1.3, p.radius * 1.9, 180, 1);
  const pos = geo.getAttribute('position'),
    uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++)
    uv.setXY(i, pos.getX(i) / (p.radius * 3.8) + 0.5, pos.getY(i) / (p.radius * 3.8) + 0.5);
  geo.rotateX(Math.PI / 2);
  group.add(new T.Mesh(geo, material));
  return group;
}
function plate(points: number[][], thickness: number, mat: T.Material) {
  const shape = new T.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const p of points.slice(1)) shape.lineTo(p[0], p[1]);
  shape.closePath();
  const g = new T.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSize: 0.15,
    bevelThickness: 0.1,
    bevelSegments: 1,
    steps: 1,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return new T.Mesh(g, mat);
}
export class Spacecraft {
  group = new T.Group();
  flames: T.Mesh[] = [];
  lights: T.Sprite[] = [];
  constructor() {
    const hull = new T.MeshStandardMaterial({ color: '#c1cdcf', metalness: 0.65, roughness: 0.56 });
    const dark = new T.MeshStandardMaterial({ color: '#182531', metalness: 0.7, roughness: 0.4 });
    const trim = new T.MeshStandardMaterial({ color: '#c88251', metalness: 0.55, roughness: 0.4 });
    const glowMat = new T.MeshStandardMaterial({
      color: '#67e7e3',
      emissive: '#27acbe',
      emissiveIntensity: 1.6,
      metalness: 0.5,
      roughness: 0.25,
    });
    const add = (mesh: T.Mesh, x = 0, y = 0, z = 0) => {
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };
    add(
      plate(
        [
          [0, -9],
          [-1.2, -6],
          [-2.2, 3],
          [-1.5, 6],
          [1.5, 6],
          [2.2, 3],
          [1.2, -6],
        ],
        1.3,
        hull,
      ),
    );
    add(
      plate(
        [
          [-0.7, -5],
          [-1.1, -0.5],
          [1.1, -0.5],
          [0.7, -5],
        ],
        0.65,
        dark,
      ),
      0,
      0.85,
      0,
    );
    add(
      plate(
        [
          [-0.45, -4.9],
          [-0.8, -0.8],
          [0.8, -0.8],
          [0.45, -4.9],
        ],
        0.1,
        new T.MeshStandardMaterial({
          color: '#163d4b',
          emissive: '#2e727c',
          emissiveIntensity: 0.5,
          metalness: 0.8,
          roughness: 0.1,
        }),
      ),
      0,
      1.2,
      0,
    );
    for (const side of [-1, 1]) {
      add(
        plate(
          [
            [side * 1.5, -2.5],
            [side * 7.8, 3],
            [side * 10.5, 6],
            [side * 3, 4.5],
          ],
          0.45,
          hull,
        ),
      );
      add(
        plate(
          [
            [side * 2, 1.8],
            [side * 9.5, 5.2],
            [side * 9, 5.8],
            [side * 2, 3],
          ],
          0.1,
          trim,
        ),
        0,
        0.31,
        0,
      );
      add(
        plate(
          [
            [side * 1.4, -3],
            [side * 5.8, -5.7],
            [side * 6, -4.3],
            [side * 2, -0.5],
          ],
          0.28,
          hull,
        ),
        0,
        -0.2,
        0,
      );
      add(new T.Mesh(new T.BoxGeometry(1.5, 1.5, 6.5), dark), side * 3.1, -0.1, 3.5);
      add(new T.Mesh(new T.BoxGeometry(1.8, 0.4, 4.8), hull), side * 3.1, 0.8, 3.1);
      add(new T.Mesh(new T.BoxGeometry(0.25, 0.12, 3), trim), side * 3.1, 1.05, 3.5);
      const engine = new T.Mesh(new T.CylinderGeometry(0.5, 0.7, 0.6, 12), dark);
      engine.rotation.x = Math.PI / 2;
      add(engine, side * 3.1, 0, 7);
      const flame = new T.Mesh(
        new T.ConeGeometry(0.48, 4, 12),
        new T.MeshBasicMaterial({
          color: '#9cefff',
          transparent: true,
          opacity: 0.85,
          blending: T.AdditiveBlending,
          depthWrite: false,
        }),
      );
      flame.rotation.x = -Math.PI / 2;
      add(flame, side * 3.1, 0, 8.5);
      this.flames.push(flame);
      const light = new T.Sprite(
        new T.SpriteMaterial({
          map: glowTexture(),
          color: '#69d8f1',
          transparent: true,
          blending: T.AdditiveBlending,
          depthWrite: false,
        }),
      );
      light.position.set(side * 3.1, 0, 7.4);
      light.scale.setScalar(4);
      this.group.add(light);
      this.lights.push(light);
      add(new T.Mesh(new T.BoxGeometry(0.15, 0.13, 1.8), glowMat), side * 9, 0.38, 5.2);
      const fin = new T.Mesh(new T.BoxGeometry(0.18, 2.5, 2.5), dark);
      fin.rotation.z = side * -0.35;
      add(fin, side * 1.5, 1.1, 4.5);
      // Landing feet remain visible so the landed ship feels grounded.
      for (const z of [-2, 4]) {
        add(new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 1.4, 6), dark), side * 1.8, -1.1, z);
        add(new T.Mesh(new T.BoxGeometry(1, 0.2, 1.4), hull), side * 1.8, -1.8, z);
      }
    }
    add(new T.Mesh(new T.BoxGeometry(0.4, 0.07, 3.3), trim), 0, 0.76, 2.8);
  }
  update(thrust: number, time: number) {
    for (const f of this.flames) {
      f.scale.y = 0.25 + thrust * 1.8 + Math.sin(time * 38) * 0.07;
      f.visible = thrust > 0.02;
    }
    for (const l of this.lights) l.material.opacity = 0.25 + thrust * 0.75;
  }
}
/** Seeded details reuse the actual terrain function and are generated only near a surface visitor. */
export class SurfaceDetails {
  group = new T.Group();
  private origin = new T.Vector3(Infinity, 0, 0);
  private planetId = '';
  update(p: PlanetData, pos: T.Vector3) {
    if (this.planetId === p.id && pos.distanceTo(this.origin) < 65) return;
    this.clear();
    this.planetId = p.id;
    this.origin.copy(pos);
    const normal = pos.clone().sub(p.position).normalize();
    const east = new T.Vector3()
      .crossVectors(
        normal,
        Math.abs(normal.y) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0),
      )
      .normalize();
    const north = new T.Vector3().crossVectors(normal, east);
    const rng = random(p.seed + Math.floor(normal.x * 50) * 17 + Math.floor(normal.z * 50));
    const crystalGeo = new T.ConeGeometry(1, 1, 5);
    crystalGeo.translate(0, 0.5, 0);
    const rockGeo = new T.IcosahedronGeometry(1, 0);
    const crystalMat = new T.MeshStandardMaterial({
      color: p.atmosphere,
      emissive: p.atmosphere,
      emissiveIntensity: 0.3,
      metalness: 0.3,
      roughness: 0.3,
    });
    const rockMat = new T.MeshStandardMaterial({ color: p.colors[2], roughness: 1 });
    const crystals = new T.InstancedMesh(crystalGeo, crystalMat, 120),
      rocks = new T.InstancedMesh(rockGeo, rockMat, 180);
    const dummy = new T.Object3D();
    for (const [mesh, count] of [
      [crystals, 120],
      [rocks, 180],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2,
          r = 12 + rng() * 210;
        const dir = normal
          .clone()
          .multiplyScalar(p.radius)
          .addScaledVector(east, Math.cos(a) * r)
          .addScaledVector(north, Math.sin(a) * r)
          .normalize();
        const h = terrainHeight(p, dir);
        dummy.position.copy(p.position).addScaledVector(dir, p.radius + h);
        dummy.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
        const size = mesh === crystals ? 0.2 + rng() * 0.55 : 0.25 + rng() * 1.7;
        dummy.scale.set(size, size * (mesh === crystals ? 3 : 1), size);
        if (p.ocean && h < 1) dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }
  clear() {
    for (const m of [...this.group.children]) {
      const mesh = m as T.Mesh;
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((x) => x.dispose());
      else mesh.material.dispose();
      this.group.remove(m);
    }
  }
}
export class SpaceDust {
  mesh: T.LineSegments;
  private positions: Float32Array;
  private rng = random(5);
  constructor() {
    this.positions = new Float32Array(180 * 6);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.positions, 3));
    this.mesh = new T.LineSegments(
      geo,
      new T.LineBasicMaterial({
        color: '#b0dfec',
        transparent: true,
        opacity: 0,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < 180; i++) this.reset(i);
  }
  private reset(i: number) {
    this.positions[i * 6] = (this.rng() - 0.5) * 170;
    this.positions[i * 6 + 1] = (this.rng() - 0.5) * 100;
    this.positions[i * 6 + 2] = -this.rng() * 350 - 25;
  }
  update(camera: T.Camera, speed: number, dt: number) {
    this.mesh.position.copy(camera.position);
    this.mesh.quaternion.copy(camera.quaternion);
    const opacity = Math.min(0.6, Math.abs(speed) / 500);
    (this.mesh.material as T.LineBasicMaterial).opacity = opacity;
    for (let i = 0; i < 180; i++) {
      const j = i * 6;
      this.positions[j + 2] += Math.abs(speed) * dt * 0.6;
      if (this.positions[j + 2] > 15) this.reset(i);
      this.positions[j + 3] = this.positions[j];
      this.positions[j + 4] = this.positions[j + 1];
      this.positions[j + 5] = this.positions[j + 2] + Math.min(32, Math.abs(speed) * 0.05);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
