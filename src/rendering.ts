import * as T from 'three';
import { PlanetData, SystemData } from './universe';

export const STAR_RADIUS = 1600;
export const STAR_INTENSITY = 1.15e9;
export function stellarColor(system: SystemData) {
  return new T.Color(system.color).lerp(new T.Color('white'), 0.3);
}
export function atmosphereParameters(p: PlanetData) {
  return { height: Math.max(p.radius * 0.075, p.amplitude * 1.65), scale: p.radius * 0.024 };
}
export function airState(p: PlanetData, position: T.Vector3, star: T.Vector3) {
  const radial = position.clone().sub(p.position),
    altitude = radial.length() - p.radius,
    up = radial.normalize();
  const params = atmosphereParameters(p),
    sun = star.clone().sub(position).normalize();
  const density =
    Math.exp(-Math.max(0, altitude) / params.scale) *
    (1 - T.MathUtils.smoothstep(altitude, params.height * 0.65, params.height));
  const daylight = T.MathUtils.smoothstep(up.dot(sun), -0.16, 0.35);
  return {
    density,
    daylight,
    up,
    sun,
    fogColor: new T.Color(p.atmosphere).multiplyScalar(0.003 + daylight * 0.16),
    fogDensity: density * 0.0009,
  };
}
/** Soft, finite-star occultation. No shadow cubemaps or unlit planet night sides. */
export function stellarVisibility(position: T.Vector3, system: SystemData) {
  const ray = system.star.clone().sub(position),
    distance = ray.length();
  ray.normalize();
  let visibility = 1;
  for (const p of system.planets) {
    const offset = p.position.clone().sub(position),
      along = offset.dot(ray);
    if (along <= 0 || along >= distance) continue;
    const perpendicular = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
    const penumbra = Math.max(0.5, (along * STAR_RADIUS) / distance);
    visibility *= T.MathUtils.smoothstep(perpendicular, p.radius - penumbra, p.radius + penumbra);
  }
  return visibility;
}
export const eclipseGLSL = `
uniform vec3 veStar;uniform vec3 veBodies[3];uniform float veRadii[3];
float veVisibility(vec3 world){vec3 delta=veStar-world;float distance=length(delta);vec3 ray=delta/distance;float visibility=1.;
 for(int i=0;i<3;i++){vec3 offset=veBodies[i]-world;float along=dot(offset,ray);if(along>0.&&along<distance){float perpendicular=sqrt(max(0.,dot(offset,offset)-along*along));float penumbra=max(.5,along*1600./distance);visibility*=smoothstep(veRadii[i]-penumbra,veRadii[i]+penumbra,perpendicular);}}return visibility;}
`;
export class CelestialLighting {
  readonly group = new T.Group();
  readonly point = new T.PointLight('white', STAR_INTENSITY, 0, 2);
  readonly ambient = new T.AmbientLight('#a5b8d2', 0.16);
  readonly uniforms = {
    veStar: { value: new T.Vector3() },
    veBodies: { value: [new T.Vector3(), new T.Vector3(), new T.Vector3()] },
    veRadii: { value: [1, 1, 1] },
  };
  private bound = new WeakSet<T.Material>();
  constructor() {
    this.group.add(this.point, this.ambient);
  }
  configure(system: SystemData) {
    this.point.position.copy(system.star);
    this.point.color.copy(stellarColor(system));
    this.uniforms.veStar.value.copy(system.star);
    system.planets.forEach((p, i) => {
      this.uniforms.veBodies.value[i].copy(p.position);
      this.uniforms.veRadii.value[i] = p.radius;
    });
  }
  bindGroup(group: T.Object3D) {
    group.traverse((o) => {
      if (o instanceof T.Mesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m instanceof T.MeshStandardMaterial) this.bind(m);
      }
    });
  }
  bind(material: T.MeshStandardMaterial) {
    if (this.bound.has(material)) return;
    if (material.userData.planetSurface) {
      this.bound.add(material);
      return;
    }
    this.bound.add(material);
    const previous = material.onBeforeCompile,
      previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        'varying vec3 veWorld;\n' +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
    vec4 vePosition=vec4(transformed,1.);
    #ifdef USE_INSTANCING
     vePosition=instanceMatrix*vePosition;
    #endif
    veWorld=(modelMatrix*vePosition).xyz;`,
        );
      shader.fragmentShader =
        'varying vec3 veWorld;\n' +
        eclipseGLSL +
        shader.fragmentShader.replace(
          '#include <lights_fragment_begin>',
          T.ShaderChunk.lights_fragment_begin.replace(
            'getPointLightInfo( pointLight, geometryPosition, directLight );',
            'getPointLightInfo( pointLight, geometryPosition, directLight );\n directLight.color*=veVisibility(veWorld);',
          ),
        );
    };
    material.customProgramCacheKey = () => previousKey + '-celestial-v3';
  }
}
export function disposeMaterialResources(material: T.Material) {
  const textures = new Set<T.Texture>();
  for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
  for (const texture of material.userData.ownedTextures ?? []) textures.add(texture);
  for (const texture of textures) if (!texture.userData.shared) texture.dispose();
  material.dispose();
}
