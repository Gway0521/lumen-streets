import * as THREE from "three";
export function nightMaterial(instanced = false) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
    defines: instanced ? { CITY_INSTANCES: 1 } : {},
    uniforms: { glow: { value: 1 }, rise: { value: 1 }, detail: { value: 1 } },
    vertexShader: `attribute float seed; varying vec3 vNormal; varying vec3 vColor; varying vec2 vUv; varying float vSeed; varying float vHeight; varying vec3 vPosition;
      #ifdef CITY_INSTANCES
      attribute vec3 offset; attribute vec3 extent; attribute vec2 heading; attribute vec3 tone; attribute float idSeed;
      #endif
      uniform float rise;
      void main(){vNormal=normal;vColor=color;vUv=uv;vSeed=seed;vHeight=position.z;
        vec3 p=position;
        #ifdef CITY_INSTANCES
        p*=extent;
        mat2 rotation=mat2(heading.x,heading.y,-heading.y,heading.x);
        p.xy=rotation*p.xy;p+=offset;vNormal.xy=rotation*normal.xy;
        vColor=tone;vSeed=idSeed;vHeight=p.z;
        vUv=vec2(uv.x*(abs(normal.x)>.5?extent.y:extent.x),p.z);
        #endif
        vPosition=p;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p.xy,p.z*rise,1.0);}`,
    fragmentShader: `precision highp float;
      uniform float glow;uniform float detail;varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;varying float vSeed;varying float vHeight;varying vec3 vPosition;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+vSeed)*43758.5453);}
      void main(){
        vec3 n=normalize(vNormal);float roof=smoothstep(.65,.9,abs(n.z));
        float light=.55+.45*max(0.,dot(n,normalize(vec3(-.4,-.6,.7))));
        vec3 base=vColor*light;
        vec2 cell=vec2(vUv.x/5.2,vUv.y/4.0),grid=fract(cell),fw=max(fwidth(cell),vec2(.015));
        vec2 pane=smoothstep(vec2(.16)-fw,vec2(.16)+fw,grid)*(1.-smoothstep(vec2(.7)-fw,vec2(.7)+fw,grid));
        float row=hash(vec2(floor(cell.y),15.)),occupied=step(.64,hash(floor(cell)))*step(.18,row);
        float fade=1.-smoothstep(.5,1.8,max(fw.x,fw.y));
        vec3 window=mix(vec3(.91,.64,.30),vec3(.59,.77,.85),step(.92,hash(floor(cell)+13.)));
        // At subpixel scale integrate window energy rather than making the facade black.
        float resolved=pane.x*pane.y*occupied;
        float energy=mix(.055+.035*row,resolved,fade);
        float emission=energy*(1.-roof)*detail;
        base+=window*emission*glow*(.8+.7*row);
        float shop=(1.-smoothstep(3.,6.,vHeight))*(1.-roof)*step(.5,hash(vec2(floor(cell.x),2.)));
        base+=vec3(.14,.08,.025)*shop*glow;
        base*=.78+.22*smoothstep(0.,15.,vHeight);
        float grain=hash(floor(vPosition.xy/2.8));
        base=mix(base,base*.95+vec3(.009,.015,.019)+grain*.008,roof);
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
