import * as T from 'three';
import { stellarColor, eclipseGLSL, CelestialLighting } from './rendering';
import { createOceanMaterial } from './planet-materials';
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
      },
      side: T.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 v;varying vec2 vUv;void main(){v=position;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:
        'varying vec3 v;varying vec2 vUv;uniform sampler2D sky;void main(){gl_FragColor=vec4(texture2D(sky,vUv).rgb*.58,1.);}',
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
  const color = stellarColor(system);
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
  halo.scale.setScalar(8000);
  halo.material.opacity = 0.5;
  group.add(halo);
  return group;
}
export function makeOcean(p: PlanetData) {
  // Conservative proxy covers tessellation chord sag; the material writes true sea depth.
  const mesh = new T.Mesh(new T.SphereGeometry(p.radius * 1.0025, 96, 64), createOceanMaterial(p));
  mesh.position.copy(p.position);
  mesh.userData.oceanPlanet = p;
  return mesh;
}
export function makeClouds(p: PlanetData, lighting: CelestialLighting) {
  const w = 512,
    h = 256,
    data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const phi = (x / w) * Math.PI * 2,
        theta = (y / h) * Math.PI;
      const d = new T.Vector3(
        -Math.cos(phi) * Math.sin(theta),
        -Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
      );
      let n = 0;
      for (let octave = 0; octave < 3; octave++) {
        const f = 18 * 2 ** octave;
        n +=
          (noise(d.x * f + 11, d.y * f + 3, d.z * f + 6, p.seed + 82) + 1) *
          0.5 *
          [0.57, 0.28, 0.15][octave];
      }
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = T.MathUtils.smoothstep(n, 0.49, 0.72) * 150;
    }
  const texture = new T.DataTexture(data, w, h);
  texture.wrapS = T.RepeatWrapping;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const material = makeShader({
    uniforms: {
      ...lighting.uniforms,
      clouds: { value: texture },
      cloudCenter: { value: p.position.clone() },
      cloudRadius: { value: p.radius + Math.max(p.radius * 0.04, p.amplitude * 1.15) },
      sunColor: { value: lighting.point.color.clone() },
    },
    vertexShader:
      'varying vec2 vUv;varying vec3 vWorld,vNormal;void main(){vUv=uv;vWorld=(modelMatrix*vec4(position,1.)).xyz;vNormal=normal;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}',
    fragmentShader: `varying vec2 vUv;varying vec3 vWorld,vNormal;uniform sampler2D clouds;uniform vec3 sunColor,cloudCenter;uniform float cloudRadius;${eclipseGLSL}void main(){float cameraAltitude=length(cameraPosition-cloudCenter)-cloudRadius;bool inside=cameraAltitude<0.;if((inside&&gl_FrontFacing)||(!inside&&!gl_FrontFacing))discard;float alpha=texture2D(clouds,vUv).a*smoothstep(0.,cloudRadius*.002,abs(cameraAltitude));vec3 sunlight=normalize(veStar-vWorld);float facing=max(0.,dot(normalize(vNormal),sunlight));float illumination=facing>.001?facing*veVisibility(vWorld):0.;
float grazing=abs(dot(normalize(vNormal),normalize(cameraPosition-vWorld)));alpha*=smoothstep(.01,.12,grazing);gl_FragColor=vec4(vec3(.035,.045,.065)+sunColor*illumination*.95,alpha);}`,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  material.userData.ownedTextures = [texture];
  const cloudHeight = Math.max(p.radius * 0.04, p.amplitude * 1.15);
  const mesh = new T.Mesh(new T.SphereGeometry(p.radius + cloudHeight, 96, 64), material);
  mesh.position.copy(p.position);
  mesh.renderOrder = 20;
  return mesh;
}
export function makeRings(p: PlanetData, lighting: CelestialLighting) {
  const group = new T.Group();
  group.position.copy(p.position);
  group.rotation.set(0.39, 0, -0.38);
  const data = new Uint8Array(512 * 4);
  for (let i = 0; i < 512; i++) {
    const t = i / 511;
    const density = 0.52 + Math.sin(t * 87) * 0.12 + Math.sin(t * 307) * 0.05;
    const gap = 1 - T.MathUtils.smoothstep(Math.abs(t - 0.43), 0.018, 0.037);
    data[i * 4] = (0.76 + density * 0.2) * 255;
    data[i * 4 + 1] = data[i * 4] * 0.96;
    data[i * 4 + 2] = data[i * 4] * 0.93;
    data[i * 4 + 3] =
      (density * 0.32 + 0.04) *
      (1 - gap * 0.94) *
      T.MathUtils.smoothstep(t, 0, 0.03) *
      (1 - T.MathUtils.smoothstep(t, 0.97, 1)) *
      255;
  }
  const texture = new T.DataTexture(data, 512, 1);
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const material = makeShader({
    uniforms: {
      ...lighting.uniforms,
      bands: { value: texture },
      sunColor: { value: lighting.point.color.clone() },
    },
    vertexShader:
      'varying vec2 vUv;varying vec3 vWorld,vNormal;void main(){vUv=uv;vWorld=(modelMatrix*vec4(position,1.)).xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}',
    fragmentShader: `varying vec2 vUv;varying vec3 vWorld,vNormal;uniform sampler2D bands;uniform vec3 sunColor;${eclipseGLSL}void main(){float r=length(vUv-.5)*2.;float t=(r-.68421)/.31579;vec4 band=texture2D(bands,vec2(t,.5));float light=.12+abs(dot(normalize(vNormal),normalize(veStar-vWorld)))*veVisibility(vWorld);gl_FragColor=vec4(band.rgb*sunColor*light,band.a);}`,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  material.userData.ownedTextures = [texture];
  const geo = new T.RingGeometry(p.radius * 1.3, p.radius * 1.9, 192);
  const pos = geo.getAttribute('position'),
    uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++)
    uv.setXY(i, pos.getX(i) / (p.radius * 3.8) + 0.5, pos.getY(i) / (p.radius * 3.8) + 0.5);
  geo.rotateX(Math.PI / 2);
  const mesh = new T.Mesh(geo, material);
  mesh.renderOrder = 10;
  group.add(mesh);
  return group;
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
  resetAll() {
    this.rng = random(5);
    for (let i = 0; i < 180; i++) this.reset(i);
  }
  private reset(i: number) {
    this.positions[i * 6] = (this.rng() - 0.5) * 170;
    this.positions[i * 6 + 1] = (this.rng() - 0.5) * 100;
    this.positions[i * 6 + 2] = -this.rng() * 350 - 25;
  }
  update(camera: T.Camera, velocity: T.Vector3, dt: number) {
    const speed = velocity.length(),
      relative = velocity.clone().applyQuaternion(camera.quaternion.clone().invert()).negate();
    const streak = relative
      .clone()
      .normalize()
      .multiplyScalar(Math.min(18, speed * 0.01));
    this.mesh.position.copy(camera.position);
    this.mesh.quaternion.copy(camera.quaternion);
    const opacity = Math.min(0.25, speed / 3000);
    (this.mesh.material as T.LineBasicMaterial).opacity = opacity;
    for (let i = 0; i < 180; i++) {
      const j = i * 6;
      this.positions[j] += relative.x * dt * 0.6;
      this.positions[j + 1] += relative.y * dt * 0.6;
      this.positions[j + 2] += relative.z * dt * 0.6;
      if (
        this.positions[j + 2] > 15 ||
        this.positions[j + 2] < -400 ||
        Math.abs(this.positions[j]) > 100 ||
        Math.abs(this.positions[j + 1]) > 70
      )
        this.reset(i);
      this.positions[j + 3] = this.positions[j] + streak.x;
      this.positions[j + 4] = this.positions[j + 1] + streak.y;
      this.positions[j + 5] = this.positions[j + 2] + streak.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
