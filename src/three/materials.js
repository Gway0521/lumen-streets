import * as THREE from "three";
export function nightMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
    uniforms: { glow: { value: 1 }, rise: { value: 1 }, detail: { value: 1 } },
    vertexShader: `attribute float seed; varying vec3 vNormal; varying vec3 vColor; varying vec2 vUv; varying float vSeed; varying float vHeight;
      uniform float rise;
      void main(){vNormal=normal;vColor=color;vUv=uv;vSeed=seed;vHeight=position.z;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position.xy,position.z*rise,1.0);}`,
    fragmentShader: `precision highp float;
      uniform float glow;uniform float detail;varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;varying float vSeed;varying float vHeight;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+vSeed)*43758.5453);}
      void main(){
        vec3 n=normalize(vNormal);float roof=smoothstep(.65,.9,abs(n.z));
        float light=.65+.35*abs(dot(n,normalize(vec3(-.4,-.6,.7))));
        vec3 base=vColor*light;
        vec2 cell=vec2(vUv.x/3.6,vUv.y/3.4),grid=fract(cell),fw=max(fwidth(cell),vec2(.015));
        vec2 pane=smoothstep(vec2(.16)-fw,vec2(.16)+fw,grid)*(1.-smoothstep(vec2(.7)-fw,vec2(.7)+fw,grid));
        float row=hash(vec2(floor(cell.y),15.)),occupied=step(.69,hash(floor(cell)))*step(.18,row);
        float fade=1.-smoothstep(.35,1.3,max(fw.x,fw.y));
        vec3 window=mix(vec3(.91,.64,.30),vec3(.59,.77,.85),step(.92,hash(floor(cell)+13.)));
        float emission=pane.x*pane.y*occupied*(1.-roof)*fade*detail;
        base+=window*emission*glow*(.5+.52*row);
        float shop=(1.-smoothstep(3.,6.,vHeight))*(1.-roof)*step(.5,hash(vec2(floor(cell.x),2.)));
        base+=vec3(.14,.08,.025)*shop*glow;
        base*=.78+.22*smoothstep(0.,15.,vHeight);
        base=mix(base,base*.95+vec3(.012,.021,.027),roof);
        gl_FragColor=vec4(base,1.);
      }`,
  });
}
export function trafficMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { pointSize: { value: 4 }, glow: { value: 1 } },
    vertexShader: `varying vec3 vColor;uniform float pointSize;void main(){vColor=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=pointSize;}`,
    fragmentShader: `varying vec3 vColor;uniform float glow;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;float a=exp(-r*r*4.5);gl_FragColor=vec4(vColor*glow,a);}`,
  });
}
