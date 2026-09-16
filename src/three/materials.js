import * as THREE from "three";
export function nightMaterial(instanced = false) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
    defines: instanced ? { CITY_INSTANCES: 1 } : {},
    uniforms: { glow: { value: 1 }, rise: { value: 1 }, detail: { value: 1 } },
    // A building seed is categorical. Smooth interpolation introduces tiny
    // errors that the procedural hash amplifies into per-pixel facade noise.
    vertexShader: `attribute float seed; attribute vec4 facade; varying vec3 vNormal; varying vec3 vColor; varying vec2 vUv; flat varying float vSeed; flat varying vec4 vFacade; varying float vHeight; varying vec3 vPosition;
      #ifdef CITY_INSTANCES
      attribute vec3 offset; attribute vec3 extent; attribute vec2 heading; attribute vec3 tone; attribute float idSeed;
      #endif
      uniform float rise;
      void main(){vNormal=normal;vColor=color;vUv=uv;vSeed=seed;vFacade=facade;vHeight=position.z;
        vec3 p=position;
        #ifdef CITY_INSTANCES
        p*=extent;
        mat2 rotation=mat2(heading.x,heading.y,-heading.y,heading.x);
        p.xy=rotation*p.xy;p+=offset;vNormal.xy=rotation*normal.xy;
        vColor=tone;vSeed=mod(idSeed,10000.);vHeight=p.z;
        float width=abs(normal.x)>.5?extent.y:extent.x;
        vFacade=vec4(floor(idSeed/10000.),offset.z,offset.z+extent.z,width);
        // BoxGeometry's default UVs are Y-up; this city is Z-up. On X-facing
        // walls its uv.x follows height, which turns windows into floor stripes.
        float wallU=abs(normal.x)>.5?position.y+.5:position.x+.5;
        vUv=vec2(wallU*width,p.z);
        #endif
        vPosition=p;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p.xy,p.z*rise,1.0);}`,
    fragmentShader: `precision highp float;
      uniform float glow;uniform float detail;varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;flat varying float vSeed;flat varying vec4 vFacade;varying float vHeight;varying vec3 vPosition;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+vSeed)*43758.5453);}
      float interval(float x,float a,float b,float fw){return smoothstep(a-fw,a+fw,x)*(1.-smoothstep(b-fw,b+fw,x));}
      float stroke(float distance,float width,float footprint){
        float aa=max(footprint,.02);
        // A tiny luminous fixture spreads into a fraction of a screen pixel.
        // Cap that footprint in metres so distant skylines do not become neon boxes.
        width=max(width,min(aa*.30,1.5));
        return (1.-smoothstep(max(0.,width-aa),width+aa,abs(distance)))*min(1.,width/aa);
      }
      void main(){
        vec3 n=normalize(vNormal);float roof=smoothstep(.65,.9,abs(n.z));
        float light=.44+.56*max(0.,dot(n,normalize(vec3(-.4,-.6,.7))));
        vec3 base=vColor*light*mix(vec3(.48,.54,.61),vec3(.42,.50,.61),roof);
        float kind=mod(vFacade.x,16.),landmark=floor(vFacade.x/16.);
        float height=max(1.,vFacade.z-vFacade.y),y=vUv.y-vFacade.y;
        float architecture=hash(vec2(19.,7.));
        float office=step(1.5,kind)*(1.-step(3.5,kind))+step(4.5,kind)*(1.-step(5.5,kind))+step(7.5,kind);
        vec2 pitch=vec2(4.2,3.25),opening=vec2(.40,.57);
        if(kind>.5 && kind<1.5){pitch=vec2(7.4,3.2);opening=vec2(.68,.56);}
        if(kind>1.5 && kind<2.5){pitch=vec2(8.4,3.8);opening=vec2(.89,.43);}
        if(kind>2.5 && kind<3.5){pitch=vec2(2.8,3.8);opening=vec2(.86,.76);}
        if(kind>3.5 && kind<4.5){pitch=vec2(3.3,3.3);opening=vec2(.36,.74);}
        if(kind>4.5 && kind<5.5){pitch=vec2(3.15,4.0);opening=vec2(.56,.79);}
        if(kind>5.5 && kind<6.5){pitch=vec2(4.7,4.1);opening=vec2(.32,.68);}
        if(kind>6.5 && kind<7.5){pitch=vec2(7.5,5.5);opening=vec2(.76,.22);}
        if(kind>7.5){pitch=vec2(3.8,4.1);opening=vec2(.75,.67);}
        pitch.x*=.88+architecture*.28;
        vec2 cell=vec2(vUv.x,y)/pitch;
        // Alternating apartment bays and staggered sculpted glazing break the grid.
        if(kind>.5 && kind<1.5)cell.x+=mod(floor(cell.y/3.),2.)*.12;
        if(kind>7.5)cell.x+=mod(floor(cell.y),2.)*.5;
        vec2 grid=fract(cell),fw=max(fwidth(cell),vec2(.008));
        vec2 lo=(1.-opening)*.5,hi=1.-lo;
        float aperture=interval(grid.x,lo.x,hi.x,fw.x)*interval(grid.y,lo.y,hi.y,fw.y);
        float area=opening.x*opening.y;
        if(kind>.5 && kind<1.5){
          aperture*=1.-interval(grid.x,.44,.56,fw.x);area-=.12*opening.y;
        }
        if(kind>5.5 && kind<6.5){
          float arch=length(vec2((grid.x-.5)/.16,max(0.,grid.y-.61)/.23));
          aperture*=1.-smoothstep(.9,1.1+fw.y,arch);
        }
        float row=hash(vec2(floor(cell.y),15.));
        float suite=hash(vec2(floor(cell.x/mix(1.,3.,office)),floor(cell.y))+31.);
        float room=hash(floor(cell)+vec2(73.,41.));
        float occupied=mix(step(.56,room),step(.38,suite)*mix(.5,1.,step(.13,room)),office);
        occupied*=mix(.26,1.,step(.14,row));
        // Mechanical floors and paired vertical piers remain dark across lit offices.
        float mechanical=1.-office*step(45.,height)*(1.-step(1.,mod(floor(cell.y)+3.,16.)));
        float pier=1.;
        if(kind>4.5 && kind<5.5)pier=mix(.08,1.,step(1.,mod(floor(cell.x),4.)));
        if(kind>6.5 && kind<7.5){occupied*=1.-step(6.5,vFacade.z-vUv.y);}
        float margin=1.;
        if(vFacade.w>8.)margin=smoothstep(.5,1.1,vUv.x)*(1.-smoothstep(vFacade.w-1.1,vFacade.w-.5,vUv.x));
        float usable=smoothstep(1.8,3.1,y)*(1.-smoothstep(height-1.,height-.3,y))*margin;
        float fade=1.-smoothstep(.5,1.8,max(fw.x,fw.y));
        vec3 warm=mix(vec3(1.,.66,.34),vec3(1.,.87,.66),architecture);
        vec3 cool=mix(vec3(.67,.82,1.),vec3(.92,.94,1.),architecture);
        vec3 window=mix(warm,cool,office*.72+step(3.5,kind)*(1.-step(4.5,kind))*.15);
        if(landmark==1.)window=mix(window,vec3(1.,.83,.56),.7);
        window=mix(window,vec3(1.,.92,.78),step(.78,suite)*.42);
        float resolved=aperture*occupied;
        float energy=mix(area*(.40+.25*office),resolved,fade)*mechanical*pier*usable;
        if(kind>6.5 && kind<7.5)energy*=1.-step(6.5,height-y);
        if(kind>8.5)energy=0.;
        // Unlit glass and deep spandrels articulate the building even between windows.
        base*=1.-(1.-roof)*aperture*.25*fade;
        base+=window*energy*(1.-roof)*detail*glow*(.70+.26*row);
        float shop=interval(y,.5,3.,max(fwidth(y),.05))*(1.-roof)*step(.48,hash(vec2(floor(cell.x),2.)));
        base+=vec3(.22,.16,.095)*shop*glow*detail*(1.-step(8.5,kind));
        // Exterior lighting has its own hierarchy, independent of room occupancy.
        float design=hash(vec2(53.,29.));
        float eligible=step(17.,height)*(1.-step(6.5,kind))+step(7.5,kind);
        float threshold=mix(.76,.43,step(42.,height));
        if(kind<1.5)threshold=.94;
        if(kind>3.5 && kind<4.5)threshold=.30;
        if(kind>4.5 && kind<5.5)threshold=.22;
        float accent=eligible*step(threshold,design)*(1.-roof)*detail*glow;
        if(landmark>0.)accent=(1.-roof)*detail*glow;
        vec3 trim=vec3(1.,.72,.36);
        float hue=hash(vec2(81.,17.));
        if(hue>.52)trim=vec3(.84,.9,1.);
        if(hue>.76)trim=vec3(.23,.63,1.);
        if(hue>.89)trim=vec3(.23,.83,.66);
        if(hue>.96)trim=vec3(.69,.38,.94);
        if(kind>5.5 && kind<6.5)trim=vec3(1.,.74,.43);
        if(landmark==1.)trim=vec3(1.,.72,.32);
        if(landmark==2.)trim=vec3(.35,.70,1.);
        if(landmark==3.)trim=vec3(1.,.23,.43);
        if(landmark==4.)trim=vec3(.57,1.,.82);
        vec2 metresFw=max(fwidth(vUv),vec2(.02));
        float crown=stroke(height-y-.48,.23,metresFw.y);
        float upper=exp(-max(0.,height-y-1.)/5.5)*smoothstep(.15,1.4,height-y);
        float fins=stroke((fract(vUv.x/9.)-.5)*9.,.18,metresFw.x);
        float edges=0.;
        if(vFacade.w>10.)edges=stroke(min(vUv.x,vFacade.w-vUv.x)-.38,.15,metresFw.x);
        float vertical=step(4.5,kind)*(1.-step(5.5,kind));
        float edgeHeight=mix(smoothstep(.66,.86,y/height),smoothstep(.05,.2,y/height),vertical);
        float beamY=min(y,18.),beamWidth=1.1+beamY*.19;
        float beamX=(fract(vUv.x/12.)-.5)*12.;
        float wash=exp(-pow(beamX/beamWidth,2.))*exp(-y/8.)*smoothstep(.2,1.2,y);
        float contour=0.;
        if(kind>7.5 && vFacade.w>12.)contour=stroke(vUv.x-vFacade.w*(.3+.19*sin(y/height*2.7)),.18,metresFw.x+metresFw.y*.2);
        if(landmark>0. && kind==8. && vFacade.w==0.)contour=stroke((fract(vUv.x/65.-y*.00022)-.5)*65.,.28,metresFw.x+metresFw.y*.015);
        float trimLight=crown*1.2+edges*edgeHeight*.9+fins*upper*.34+contour*.85;
        // Crown wash has a soft falloff; no fake point lights or city-wide glow lift.
        base+=trim*accent*(trimLight+upper*.12+wash*.18);
        if(kind>8.5 && landmark>0.)base+=trim*detail*glow*(.12+.20*max(0.,dot(n,normalize(vec3(-.4,-.6,.4)))));
        base*=.78+.22*smoothstep(0.,15.,vHeight);
        vec2 roofCell=vPosition.xy/9.,roofFw=fwidth(roofCell),panel=fract(roofCell);
        float roofDetail=1.-smoothstep(.3,1.2,max(roofFw.x,roofFw.y));
        float grain=mix(.5,hash(floor(vPosition.xy/2.8)),roofDetail);
        vec2 seams=smoothstep(vec2(.94)-roofFw,vec2(.94)+max(roofFw,vec2(.001)),panel);
        float seam=seams.x+seams.y;
        float plant=step(.73,hash(floor(vPosition.xy/9.)))*step(.24,panel.x)*step(panel.x,.63)*step(.23,panel.y)*step(panel.y,.7);
        base=mix(base,base*(1.-mix(.025,seam*.14+plant*.24,roofDetail))+grain*.004,roof);
        gl_FragColor=vec4(base,1.);
      }`,
  });
}
export function beaconMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, pointSize: { value: 4 }, glow: { value: 1 }, rise: { value: 1 } },
    vertexShader: `attribute float phase;varying float vPhase;uniform float pointSize;uniform float rise;
      void main(){vPhase=phase;gl_Position=projectionMatrix*modelViewMatrix*vec4(position.xy,position.z*rise,1.);gl_PointSize=pointSize;}`,
    fragmentShader: `varying float vPhase;uniform float time;uniform float glow;
      void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;
        float cycle=fract(time/2.+vPhase),pulse=1.-smoothstep(.12,.32,cycle);
        float power=mix(.65,.16+.84*pulse,step(.35,vPhase));
        gl_FragColor=vec4(vec3(1.,.035,.018)*glow*power,exp(-r*r*4.5));}`,
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
