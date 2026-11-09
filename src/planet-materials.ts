import * as T from 'three';
import { PlanetData, noise } from './universe';
let rock: T.DataTexture | undefined;
/** Packed repeatable rock frequencies, filtered by hardware mip selection rather than pixel hashes. */
export function rockTexture() {
  if (rock) return rock;
  const n = 128,
    data = new Uint8Array(n * n * 4);
  // Periodic coordinates avoid a visible repeated-tile edge.
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x / n) * Math.PI * 2,
        v = (y / n) * Math.PI * 2;
      const a = Math.cos(u) * 3,
        b = Math.sin(u) * 3,
        c = Math.cos(v) * 3,
        d = Math.sin(v) * 3;
      const i = (y * n + x) * 4;
      data[i] = (noise(a + c, b + d, c - b, 718) + 1) * 127;
      data[i + 1] = (noise((a + c) * 3, (b + d) * 3, (c - b) * 3, 391) + 1) * 127;
      data[i + 2] = (noise((a + c) * 8, (b + d) * 8, (c - b) * 8, 51) + 1) * 127;
      data[i + 3] = 255;
    }
  rock = new T.DataTexture(data, n, n);
  rock.wrapS = rock.wrapT = T.RepeatWrapping;
  rock.magFilter = T.LinearFilter;
  rock.minFilter = T.LinearMipmapLinearFilter;
  rock.generateMipmaps = true;
  rock.needsUpdate = true;
  rock.userData.shared = true;
  return rock;
}
const rockGLSL = `
uniform sampler2D veRock;varying vec3 veLocal;varying vec3 veRadial;varying float veHeight;
vec3 veRockSample(vec3 p,vec3 n){vec3 w=pow(abs(n),vec3(4.));w/=max(.001,w.x+w.y+w.z);return texture2D(veRock,p.yz*.035).rgb*w.x+texture2D(veRock,p.xz*.035).rgb*w.y+texture2D(veRock,p.xy*.035).rgb*w.z;}
vec3 veBump(vec3 n,vec3 viewPosition,float height){vec3 dx=dFdx(-viewPosition),dy=dFdy(-viewPosition),a=cross(dy,n),b=cross(n,dx);float det=dot(dx,a);vec3 gradient=sign(det)*(dFdx(height)*a+dFdy(height)*b)/max(abs(det),.001);gradient*=min(1.,.3/max(length(gradient),.0001));return normalize(n-gradient*.18);}
`;
export function createTerrainMaterial(p: PlanetData) {
  const material = new T.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
  material.userData.planetSurface = true;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      veRock: { value: rockTexture() },
      veAmplitude: { value: p.amplitude },
      vePalette: { value: p.colors.map((c) => new T.Color(c)) },
    });
    shader.vertexShader =
      'attribute float veElevation;varying vec3 veLocal;varying vec3 veRadial;varying float veHeight;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `veLocal=transformed;veRadial=normalize(position);veHeight=veElevation;\n#include <project_vertex>`,
      );
    shader.fragmentShader =
      rockGLSL +
      '\nuniform float veAmplitude;uniform vec3 vePalette[5];\n' +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
   float veDetail=1.-smoothstep(60.,240.,length(vViewPosition));
   vec3 veStone=vec3(.5);if(veDetail>.001)veStone=mix(veStone,veRockSample(veLocal,normalize(veRadial)),veDetail);
   float veLevel=clamp((veHeight/veAmplitude+.15)*4.4,0.,3.999);
   vec3 veBase=mix(vePalette[0],vePalette[1],clamp(veLevel,0.,1.));
   veBase=mix(veBase,vePalette[2],clamp(veLevel-1.,0.,1.));
   veBase=mix(veBase,vePalette[3],clamp(veLevel-2.,0.,1.));
   veBase=mix(veBase,vePalette[4],clamp(veLevel-3.,0.,1.));
   float vePhase=veHeight*.7+veStone.r*2.;float veBand=sin(vePhase)*exp(-fwidth(vePhase)*.8);
   diffuseColor.rgb*=veBase*(.86+veStone.r*.3+veBand*.045);
  `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nif(veDetail>.001)normal=veBump(normal,vViewPosition,veStone.g*.65+veStone.b*.15);',
        );
  };
  material.customProgramCacheKey = () => `terrain-v4-${p.id}`;
  return material;
}
export function createOceanMaterial(p: PlanetData) {
  const material = new T.MeshPhysicalMaterial({
    color: '#0b3447',
    roughness: 0.26,
    metalness: 0,
    ior: 1.33,
    specularIntensity: 0.65,
    side: T.DoubleSide,
  });
  material.userData.planetSurface = true;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      veRock: { value: rockTexture() },
      veCenter: { value: p.position.clone() },
      veRadius: { value: p.radius },
    });
    shader.vertexShader =
      'varying vec3 veProxy;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nveProxy=(modelMatrix*vec4(transformed,1.)).xyz;',
      );
    shader.fragmentShader =
      rockGLSL +
      `
      varying vec3 veProxy;uniform vec3 veCenter;uniform float veRadius;
    ` +
      shader.fragmentShader
        .replace(
          'void main() {',
          `void main() {
        vec3 veRay=normalize(veProxy-cameraPosition),veOrigin=cameraPosition-veCenter;
        float veB=dot(veOrigin,veRay),veD=veB*veB-dot(veOrigin,veOrigin)+veRadius*veRadius;
        if(veD<0.)discard;
        float veHit=-veB-sqrt(veD);if(veHit<=0.)discard;
        vec3 vePoint=veOrigin+veRay*veHit,veUp=normalize(vePoint);
        vec3 veWaterView=-(viewMatrix*vec4(vePoint+veCenter,1.)).xyz;
        #define vViewPosition veWaterView
      `,
        )
        .replace(
          '#include <logdepthbuf_fragment>',
          `
        #include <logdepthbuf_fragment>
        #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
          gl_FragDepth=log2(1.+veWaterView.z)*logDepthBufFC*.5;
        #else
          vec4 veClip=projectionMatrix*vec4(-veWaterView,1.);gl_FragDepth=veClip.z/veClip.w*.5+.5;
        #endif
      `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `
        #include <normal_fragment_maps>
        normal=normalize(mat3(viewMatrix)*veUp);
        float veDetail=1.-smoothstep(60.,240.,length(veWaterView));
        vec3 veWater=vec3(.5);if(veDetail>.001)veWater=veRockSample(vePoint*.7,veUp);
        normal=veBump(normal,veWaterView,veWater.g*.08*veDetail);
      `,
        );
  };
  material.customProgramCacheKey = () => `ocean-analytic-v1-${p.id}`;
  return material;
}
