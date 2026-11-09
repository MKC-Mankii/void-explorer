import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SystemData } from './universe';
import { airState, atmosphereParameters, stellarColor } from './rendering';

/** Integrate to the actual opaque depth, on both sides of the atmosphere boundary.
 * Stays in the existing linear HDR pipeline; bloom and output transform run afterwards.
 */
export class AtmospherePass extends Pass {
  private readonly uniforms = {
    tDiffuse: { value: null as T.Texture | null },
    tDepth: { value: null as T.Texture | null },
    inverseProjection: { value: new T.Matrix4() },
    cameraWorld: { value: new T.Matrix4() },
    eye: { value: new T.Vector3() },
    forward: { value: new T.Vector3() },
    logFar: { value: 1 },
    centers: { value: [new T.Vector3(), new T.Vector3(), new T.Vector3()] },
    radii: { value: [1, 1, 1] },
    heights: { value: [1, 1, 1] },
    scales: { value: [1, 1, 1] },
    colors: { value: [new T.Color(), new T.Color(), new T.Color()] },
    star: { value: new T.Vector3() },
    sunColor: { value: new T.Color() },
    steps: { value: 3 },
  };
  private readonly material = new T.ShaderMaterial({
    uniforms: this.uniforms,
    defines: { VE_STEPS: 3 },
    depthTest: false,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
      varying vec2 vUv;uniform sampler2D tDiffuse,tDepth;
      uniform mat4 inverseProjection,cameraWorld;uniform vec3 eye,forward,centers[3],star;
      uniform vec3 colors[3],sunColor;uniform float radii[3],heights[3],scales[3],logFar;
      
      vec2 interval(vec3 ro,vec3 rd,float radius){float b=dot(ro,rd);float d=b*b-dot(ro,ro)+radius*radius;if(d<0.)return vec2(1e12,-1.);float r=sqrt(d);return vec2(max(0.,-b-r),-b+r);}
      vec4 air(int i,vec3 ray,float end,out float begin){
        vec2 range=interval(eye-centers[i],ray,radii[i]+heights[i]);
        range.y=min(range.y,end);begin=range.x;
        if(range.y<=range.x)return vec4(0.,0.,0.,1.);
        // Near foreground has almost constant density: midpoint quadrature needs one sample.
        float count=range.y-range.x<scales[i]*.5?1.:float(VE_STEPS);
        float ds=(range.y-range.x)/count,column=0.,litColumn=0.;
        for(int j=0;j<VE_STEPS;j++){
          if(float(j)>=count)break;
          vec3 local=eye-centers[i]+ray*(range.x+(float(j)+.5)*ds);
          float altitude=length(local)-radii[i];
          float density=exp(-max(0.,altitude)/scales[i])*(1.-smoothstep(heights[i]*.65,heights[i],altitude));
          float day=smoothstep(-.13,.18,dot(normalize(local),normalize(star-centers[i]-local)));
          column+=density*ds/scales[i];litColumn+=density*day*ds/scales[i];
        }
        float day=litColumn/max(column,.00001),mu=dot(ray,normalize(star-eye));
        float rayleigh=.65+.35*mu*mu,mie=.48/pow(max(.08,1.52-1.44*mu),1.5);
        vec3 scatter=(colors[i]*rayleigh+sunColor*mie*.035)*day;
        scatter+=sunColor*vec3(.28,.085,.025)*pow(1.-day,2.)*day*.6+vec3(.002,.003,.008)*(1.-day);
        float transmission=exp(-column*.12);
        return vec4(scatter*(1.-transmission),transmission);
      }
      void swapAir(inout vec4 a,inout vec4 b,inout float x,inout float y){if(x>y){vec4 v=a;a=b;b=v;float t=x;x=y;y=t;}}
      void main(){
        vec4 source=texture2D(tDiffuse,vUv);
        vec4 view=inverseProjection*vec4(vUv*2.-1.,1.,1.);
        vec3 ray=normalize(mat3(cameraWorld)*view.xyz);
        float depth=texture2D(tDepth,vUv).x;
        // Inverse of Three's logarithmic depth. Divide view depth by the ray's forward cosine.
        float end=(exp2(depth*logFar)-1.)/max(.00001,dot(ray,forward));
        float x,y,z;
        // Literal indices and a fixed compare network avoid dynamic array indexing in the ray loop.
        vec4 a=air(0,ray,end,x),b=air(1,ray,end,y),c=air(2,ray,end,z);
        swapAir(a,b,x,y);swapAir(b,c,y,z);swapAir(a,b,x,y);
        gl_FragColor=vec4(a.rgb+a.a*b.rgb+a.a*b.a*c.rgb+source.rgb*a.a*b.a*c.a,source.a);
      }`,
  });
  private readonly quad = new FullScreenQuad(this.material);
  configure(system: SystemData) {
    const u = this.uniforms;
    u.star.value.copy(system.star);
    u.sunColor.value.copy(stellarColor(system));
    system.planets.forEach((p, i) => {
      const air = atmosphereParameters(p);
      u.centers.value[i].copy(p.position);
      u.radii.value[i] = p.radius;
      u.heights.value[i] = air.height;
      u.scales.value[i] = air.scale;
      u.colors.value[i].set(p.atmosphere);
    });
  }
  quality(quality: string) {
    const steps = quality === 'high' ? 6 : quality === 'low' ? 2 : 3;
    this.uniforms.steps.value = steps;
    if (this.material.defines.VE_STEPS !== steps) {
      this.material.defines.VE_STEPS = steps;
      this.material.needsUpdate = true;
    }
  }
  update(camera: T.PerspectiveCamera) {
    const u = this.uniforms;
    u.inverseProjection.value.copy(camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    u.eye.value.copy(camera.position);
    camera.getWorldDirection(u.forward.value);
    u.logFar.value = Math.log2(camera.far + 1);
  }
  observe(system: SystemData, eye: T.Vector3) {
    return {
      method: 'opaque-depth-integration',
      samples: this.uniforms.steps.value,
      nearSamples: 1,
      planets: system.planets.map((p) => ({
        id: p.id,
        radialAltitude: eye.distanceTo(p.position) - p.radius,
        ...atmosphereParameters(p),
        density: airState(p, eye, system.star).density,
        seaRadius: p.ocean ? p.radius : null,
      })),
    };
  }
  render(
    renderer: T.WebGLRenderer,
    writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
  ) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
