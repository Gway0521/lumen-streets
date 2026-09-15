import * as THREE from "three";
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
        void main(){vec2 crossDir=vec2(direction.y,-direction.x);
          float along=dot(world,direction),across=dot(world,crossDir);
          float phase=along*.75+sin(across*.15)*2.+time*.65;
          float wave=sin(phase)*(1.-smoothstep(.7,3.,fwidth(phase)));
          vec2 offset=crossDir*(sin(along*.24+time*.4)*.6);
          float reflection=0.;
          for(int i=0;i<24;i++){float d=float(i)*6.;vec2 p=world-direction*d+offset;
            vec2 uv=(p-origin)/span;
            float valid=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
            reflection+=texture2D(lamps,uv).r*exp(-d/76.)*valid;
          }
          float ripple=.62+.3*wave;
          vec3 water=vec3(.033,.085,.145)+vec3(.009,.018,.031)*wave;
          water+=vec3(1.,.64,.25)*reflection*ripple*.85*glow;
          gl_FragColor=vec4(water,1.);}`,
    });
    this.greenMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader,
      fragmentShader: `varying vec2 world;${noise}
        void main(){vec2 p=world/11.,cell=floor(p);float r=10.;vec2 delta=vec2(0.);float variation=0.;
          for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){vec2 id=cell+vec2(float(x),float(y));
            vec2 center=id+vec2(.15+hash(id)*.7,.15+hash(id+9.)*.7);
            float radius=.34+hash(id+21.)*.31;vec2 d=(p-center)/radius;float candidate=length(d);
            if(candidate<r){r=candidate;delta=d;variation=hash(id+4.);}}
          float aa=max(fwidth(r),.06),crown=1.-smoothstep(.82-aa,1.+aa,r);
          vec3 n=normalize(vec3(delta*.7,sqrt(max(.01,1.-min(1.,r*r)))));
          float light=.27+.73*max(0.,dot(n,normalize(vec3(-.35,-.5,.8))));
          vec3 color=mix(vec3(.02,.045,.035),vec3(.14,.23,.085)*(.65+variation*.5)*light,crown);
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
      fragmentShader: `varying vec2 vUv;uniform float glow;void main(){float edge=smoothstep(.3,.85,abs(vUv.x));float lane=1.-smoothstep(.02,.07,abs(vUv.x));vec3 c=mix(vec3(.12,.10,.065),vec3(1.,.61,.22)*glow,edge);c+=vec3(.20,.13,.045)*lane;gl_FragColor=vec4(c,1.);}`,
    });
    const bridge = new THREE.Mesh(bridgeGeometry, this.bridgeMaterial);
    bridge.frustumCulled = false;
    this.add(bridge);
    this.lampMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { size: { value: 2.5 }, glow: { value: 1 } },
      vertexShader: `uniform float size;void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}`,
      fragmentShader: `uniform float glow;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(vec3(1.,.78,.40)*glow,exp(-r*r*4.));}`,
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
      data.light.width * data.light.height * 4;
  }
  update(time, bearing, glow, zoom, ratio) {
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
    this.bridgeMaterial.dispose();
    this.lampMaterial.dispose();
  }
}
