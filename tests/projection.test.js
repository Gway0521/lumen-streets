import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneProjection, transformPoint, worldToScreen, screenToWorld } from '../src/engine/projection.js';
import { wallpaperPlan } from '../src/export/framing.ts';

test('orthographic ground and height form one camera with orthonormal screen axes',()=>{
  for(const elevation of [60,70,80]) {
    const {matrix,direction}=sceneProjection({projection:2,elevation});
    const z=transformPoint(direction,matrix),[a,b,c,d]=matrix;
    assert(Math.abs(a*a+c*c+z[0]*z[0]-1)<1e-12);
    assert(Math.abs(b*b+d*d+z[1]*z[1]-1)<1e-12);
    assert(Math.abs(a*b+c*d+z[0]*z[1])<1e-12);
    const camera={x:340,y:-290,zoom:.37},origin=[390,600],point=[-327,125];
    const restored=screenToWorld(worldToScreen(point,camera,origin,matrix),camera,origin,matrix);
    assert(Math.hypot(...point.map((v,i)=>v-restored[i]))<1e-10);
  }
});

test('projected wallpaper corners remain inside mapped ground in portrait and landscape',()=>{
  const matrix=sceneProjection({projection:2,elevation:60}).matrix,bounds=[-800,-900,800,900];
  for(const size of ['desktop','portrait']) {
    const plan=wallpaperPlan({width:1440,height:1000},bounds,{x:790,y:-899,zoom:.1},size,'png',1080,undefined,matrix);
    for(const p of [[0,0],[plan.view.width,0],[0,plan.view.height],[plan.view.width,plan.view.height]]) {
      const [x,y]=screenToWorld(p,plan.camera,plan.view.origin,matrix);
      assert(x>=bounds[0]-1e-8&&x<=bounds[2]+1e-8&&y>=bounds[1]-1e-8&&y<=bounds[3]+1e-8);
    }
  }
});
