import * as THREE from "three";

const vertexShader = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
// One framebuffer copy, two quarter-resolution light passes and one composite.
// No depth copies, floating-point targets or extra city render are required.
export class NightBloom {
  constructor() {
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.blur = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        source: { value: null },
        step: { value: new THREE.Vector2() },
        extract: { value: 1 },
      },
      vertexShader,
      fragmentShader: `varying vec2 vUv;uniform sampler2D source;uniform vec2 step;uniform float extract;
        vec3 sampleLight(vec2 p){vec3 c=texture2D(source,p).rgb;float l=max(c.r,max(c.g,c.b));return mix(c,c*smoothstep(.48,.88,l),extract);}
        void main(){vec3 c=sampleLight(vUv)*.227027;
          c+=(sampleLight(vUv+step*1.384615)+sampleLight(vUv-step*1.384615))*.316216;
          c+=(sampleLight(vUv+step*3.230769)+sampleLight(vUv-step*3.230769))*.070270;
          gl_FragColor=vec4(c,1.);}`,
    });
    this.composite = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        source: { value: null },
        light: { value: null },
        strength: { value: 0.24 },
      },
      vertexShader,
      fragmentShader: `varying vec2 vUv;uniform sampler2D source;uniform sampler2D light;uniform float strength;
        void main(){vec3 c=texture2D(source,vUv).rgb;vec3 bloom=texture2D(light,vUv).rgb;
          c+=bloom*strength;gl_FragColor=vec4(c,1.);}`,
    });
  }
  resize(width, height) {
    if (this.width === width && this.height === height) return;
    this.release();
    this.width = width;
    this.height = height;
    this.frame = new THREE.FramebufferTexture(width, height);
    this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
    const options = {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };
    this.a = new THREE.WebGLRenderTarget(
      Math.max(1, Math.ceil(width / 4)),
      Math.max(1, Math.ceil(height / 4)),
      options,
    );
    this.b = new THREE.WebGLRenderTarget(this.a.width, this.a.height, options);
    this.composite.uniforms.source.value = this.frame;
    this.composite.uniforms.light.value = this.b.texture;
  }
  render(renderer, gl, width, height, glow) {
    this.resize(width, height);
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport = gl.getParameter(gl.VIEWPORT);
    renderer.copyFramebufferToTexture(this.frame);
    this.quad.material = this.blur;
    this.blur.uniforms.source.value = this.frame;
    this.blur.uniforms.extract.value = 1;
    this.blur.uniforms.step.value.set(4 / width, 0);
    renderer.setRenderTarget(this.a);
    renderer.render(this.scene, this.camera);
    this.blur.uniforms.source.value = this.a.texture;
    this.blur.uniforms.extract.value = 0;
    this.blur.uniforms.step.value.set(0, 1 / this.a.height);
    renderer.setRenderTarget(this.b);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    renderer.setViewport(0, 0, width, height);
    this.quad.material = this.composite;
    this.composite.uniforms.strength.value = 0.24 * glow;
    renderer.render(this.scene, this.camera);
    gl.viewport(...viewport);
  }
  get bytes() {
    return this.frame
      ? (this.width * this.height + 2 * this.a.width * this.a.height) * 4
      : 0;
  }
  release() {
    this.frame?.dispose();
    this.a?.dispose();
    this.b?.dispose();
    this.frame = null;
    this.width = this.height = 0;
  }
  dispose() {
    this.release();
    this.quad.geometry.dispose();
    this.blur.dispose();
    this.composite.dispose();
  }
}
