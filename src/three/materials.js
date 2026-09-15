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
        float light=.44+.56*max(0.,dot(n,normalize(vec3(-.4,-.6,.7))));
        vec3 base=vColor*light*mix(vec3(.83,.94,1.04),vec3(.86,1.02,1.16),roof);
        float architecture=hash(vec2(19.,7.)),office=step(.66,architecture);
        vec2 cell=vec2(vUv.x/mix(4.4,3.6,office),vUv.y/3.5),grid=fract(cell),fw=max(fwidth(cell),vec2(.015));
        vec2 opening=mix(vec2(.68,.72),vec2(.79,.76),office);
        vec2 pane=smoothstep(vec2(.18)-fw,vec2(.18)+fw,grid)*(1.-smoothstep(opening-fw,opening+fw,grid));
        float row=hash(vec2(floor(cell.y),15.));
        float suite=hash(floor(cell/vec2(4.,3.))+31.);
        float occupied=step(mix(.60,.39,office),hash(floor(cell)))*step(.16,row)*mix(.45,1.,step(.26,suite));
        float fade=1.-smoothstep(.5,1.8,max(fw.x,fw.y));
        vec3 window=mix(vec3(1.,.83,.59),vec3(.70,.82,.96),step(.72,architecture));
        // At subpixel scale integrate window energy rather than making the facade black.
        float resolved=pane.x*pane.y*occupied;
        float energy=mix(.115+.085*office+.025*row,resolved,fade);
        float emission=energy*(1.-roof)*detail;
        base+=window*emission*glow*(1.25+.65*row);
        // Broad facade bays remain quiet when their mullions become subpixel.
        float bay=1.-smoothstep(.025,.025+max(fw.x*.24,.012),abs(fract(cell.x/4.)-.5));
        base*=1.-bay*.14*(1.-roof)*fade;
        float shop=(1.-smoothstep(3.,6.,vHeight))*(1.-roof)*step(.5,hash(vec2(floor(cell.x),2.)));
        base+=vec3(.13,.105,.075)*shop*glow;
        base*=.78+.22*smoothstep(0.,15.,vHeight);
        vec2 roofCell=vPosition.xy/9.,roofFw=fwidth(roofCell),panel=fract(roofCell);
        float roofDetail=1.-smoothstep(.3,1.2,max(roofFw.x,roofFw.y));
        float grain=mix(.5,hash(floor(vPosition.xy/2.8)),roofDetail);
        vec2 seams=smoothstep(vec2(.94)-roofFw,vec2(.94)+max(roofFw,vec2(.001)),panel);
        float seam=seams.x+seams.y;
        float plant=step(.73,hash(floor(vPosition.xy/9.)))*step(.24,panel.x)*step(panel.x,.63)*step(.23,panel.y)*step(panel.y,.7);
        base=mix(base,base*(1.-mix(.025,seam*.14+plant*.24,roofDetail))+grain*.009,roof);
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
