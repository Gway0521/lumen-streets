import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
const vertexShader = `varying vec2 world;void main(){world=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const noise = `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`;

export class NightEnvironment extends THREE.Group {
  constructor(data) {
    super();
    this.light = new THREE.Texture(data.light);
    this.light.flipY = false;
    this.light.needsUpdate = true;
    this.light.minFilter = this.light.magFilter = THREE.LinearFilter;
    this.light.generateMipmaps = false;
    this.waterMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        lamps: { value: this.light },
        origin: { value: new THREE.Vector2(...data.a) },
        span: {
          value: new THREE.Vector2(
            data.b[0] - data.a[0],
            data.b[1] - data.a[1],
          ),
        },
        direction: { value: new THREE.Vector2(0, 1) },
        time: { value: 0 },
        glow: { value: 1 },
      },
      vertexShader,
      fragmentShader: `varying vec2 world;uniform sampler2D lamps;uniform vec2 origin;uniform vec2 span;uniform vec2 direction;uniform float time;uniform float glow;${noise}
        float field(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
        void main(){vec2 crossDir=vec2(direction.y,-direction.x);
          // Independent world-space flows avoid camera-locked parallel waves.
          vec2 flow=vec2(time*.18,-time*.11);
          float swell=field(world*.035+flow*.08);
          float chop=field(world*vec2(.19,.31)-flow*.22);
          float phase=dot(world,vec2(.21,.34))+swell*6.+time*.38;
          float detail=1.-smoothstep(.5,2.4,fwidth(phase));
          float wave=sin(phase)*detail;
          float drift=(field(world*.075+flow*.13)-.5)*2.;
          float reflection=0.;
          for(int i=0;i<24;i++){float t=(float(i)+.5)/24.;float d=180.*t*t;
            vec2 offset=crossDir*(drift*(1.+d*.045)+wave*.45);
            vec2 p=world-direction*d+offset;
            vec2 uv=(p-origin)/span;
            float valid=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
            reflection+=texture2D(lamps,uv).r*exp(-d/45.)*(.3+t*1.7)*valid;
          }
          float breakup=mix(.64,.28+.72*smoothstep(.22,.78,chop+.12*wave),detail);
          vec3 water=vec3(.027,.054,.070)+vec3(.002,.003,.004)*(swell-.5);
          // Soft, broken highlights remain close to their sources with a quiet centre.
          water+=vec3(.90,.76,.54)*(1.-exp(-reflection*.8))*breakup*glow;
          gl_FragColor=vec4(water,1.);}`,
    });
    this.greenMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        coverage: { value: this.light },
        origin: this.waterMaterial.uniforms.origin,
        span: this.waterMaterial.uniforms.span,
      },
      vertexShader,
      fragmentShader: `varying vec2 world;uniform sampler2D coverage;uniform vec2 origin;uniform vec2 span;${noise}
        void main(){vec3 mask=texture2D(coverage,(world-origin)/span).rgb;
          if(mask.b>.08)discard;
          vec2 p=world*.055;vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          float grain=mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
          vec3 color=mix(vec3(.018,.032,.026),vec3(.012,.023,.021),mask.g)*(.83+grain*.22);
          gl_FragColor=vec4(color,1.);}`,
    });
    for (const [name, material] of [
      ["water", this.waterMaterial],
      ["green", this.greenMaterial],
    ]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(data[name], 3));
      const mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -3;
      this.add(mesh);
    }
    const crown = new THREE.IcosahedronGeometry(1, 1);
    crown.scale(1, 0.88, 0.34);
    crown.translate(0, 0, 0.64);
    const trunk = new THREE.CylinderGeometry(0.055, 0.085, 0.48, 5);
    trunk.rotateX(Math.PI / 2);
    trunk.translate(0, 0, 0.24);
    const treeShape = mergeGeometries([crown, trunk.toNonIndexed()]);
    const treeGeometry = new THREE.InstancedBufferGeometry();
    treeGeometry.attributes = treeShape.attributes;
    treeGeometry.index = treeShape.index;
    const treeBuffer = new THREE.InstancedInterleavedBuffer(
      data.trees || new Float32Array(),
      5,
    );
    treeGeometry.setAttribute(
      "site",
      new THREE.InterleavedBufferAttribute(treeBuffer, 3, 0),
    );
    treeGeometry.setAttribute(
      "shape",
      new THREE.InterleavedBufferAttribute(treeBuffer, 2, 3),
    );
    treeGeometry.instanceCount = treeBuffer.count;
    this.treeMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { rise: { value: 1 } },
      vertexShader: `attribute vec3 site;attribute vec2 shape;uniform float rise;varying vec3 tint;varying vec3 norm;
        void main(){float a=shape.y*6.283;mat2 rot=mat2(cos(a),sin(a),-sin(a),cos(a));
          vec3 p=position;p.xy=rot*p.xy*shape.x;p.z*=site.z*rise;p.xy+=site.xy;
          norm=vec3(rot*normal.xy/shape.x,normal.z/max(1.,site.z*rise));tint=mix(vec3(.065,.098,.072),vec3(.087,.108,.069),shape.y);
          if(position.z<.39&&length(position.xy)<.12)tint=vec3(.035,.030,.025);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `varying vec3 tint;varying vec3 norm;void main(){float lit=.3+.7*max(0.,dot(normalize(norm),normalize(vec3(-.35,-.5,.8))));gl_FragColor=vec4(tint*lit,1.);}`,
    });
    this.trees = new THREE.Mesh(treeGeometry, this.treeMaterial);
    this.trees.frustumCulled = false;
    this.add(this.trees);
    crown.dispose();
    trunk.dispose();
    const bridgeGeometry = new THREE.BufferGeometry(),
      bridgeBuffer = new THREE.InterleavedBuffer(data.bridges, 5);
    bridgeGeometry.setAttribute(
      "position",
      new THREE.InterleavedBufferAttribute(bridgeBuffer, 3, 0),
    );
    bridgeGeometry.setAttribute(
      "uv",
      new THREE.InterleavedBufferAttribute(bridgeBuffer, 2, 3),
    );
    this.bridgeMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { glow: { value: 1 } },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 vUv;uniform float glow;void main(){float edge=smoothstep(.80,.99,abs(vUv.x));float lane=1.-smoothstep(.01,.025,abs(vUv.x));vec3 c=mix(vec3(.055,.068,.079),vec3(.51,.39,.26)*glow,edge);c+=vec3(.07,.065,.05)*lane;gl_FragColor=vec4(c,1.);}`,
    });
    const bridge = new THREE.Mesh(bridgeGeometry, this.bridgeMaterial);
    bridge.frustumCulled = false;
    this.add(bridge);
    this.lampMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { size: { value: 2.5 }, glow: { value: 1 } },
      vertexShader: `uniform float size;varying float warmth;void main(){warmth=fract(sin(dot(floor(position.xy),vec2(.13,.37)))*43758.5453);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}`,
      fragmentShader: `uniform float glow;varying float warmth;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;vec3 light=mix(vec3(.94,.88,.73),vec3(.91,.67,.38),warmth);gl_FragColor=vec4(light*glow,exp(-r*r*4.)*.85);}`,
    });
    const lamps = new THREE.BufferGeometry();
    lamps.setAttribute("position", new THREE.BufferAttribute(data.lamps, 3));
    const points = new THREE.Points(lamps, this.lampMaterial);
    points.frustumCulled = false;
    this.add(points);
    this.bytes =
      data.water.byteLength +
      data.green.byteLength +
      data.bridges.byteLength +
      data.lamps.byteLength +
      (data.trees?.byteLength || 0) +
      data.light.width * data.light.height * 4;
  }
  update(time, bearing, glow, zoom, ratio) {
    this.trees.visible = zoom > 14;
    this.treeMaterial.uniforms.rise.value = Math.min(
      1,
      Math.max(0.05, (zoom - 14) / 0.7),
    );
    const a = (bearing * Math.PI) / 180;
    this.waterMaterial.uniforms.direction.value.set(-Math.sin(a), Math.cos(a));
    this.waterMaterial.uniforms.time.value = time;
    this.waterMaterial.uniforms.glow.value = glow;
    this.bridgeMaterial.uniforms.glow.value = glow;
    this.lampMaterial.uniforms.glow.value = glow;
    this.lampMaterial.uniforms.size.value =
      Math.max(1.2, Math.min(4, (zoom - 11.8) * 1.05)) * ratio;
  }
  dispose() {
    for (const n of this.children) n.geometry.dispose();
    this.light.image.close();
    this.light.dispose();
    this.waterMaterial.dispose();
    this.greenMaterial.dispose();
    this.treeMaterial.dispose();
    this.bridgeMaterial.dispose();
    this.lampMaterial.dispose();
  }
}
