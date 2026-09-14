/** World metres remain east/south/up. Aerial-7 keeps its original oblique view. */
export const LEGACY_DIRECTION = Object.freeze([-.32, -.48]);
const length = Math.hypot(...LEGACY_DIRECTION);
const legacyAxis = LEGACY_DIRECTION.map(v => v / length);

export function sceneProjection(settings) {
  if (settings?.projection !== 2) return { direction: LEGACY_DIRECTION, matrix: [1, 0, 0, 1] };
  // Missing azimuth preserves the original aerial-8 composition in saved scenes.
  const bearing = settings.azimuth * Math.PI / 180;
  const axis = settings.azimuth === undefined ? legacyAxis : [Math.sin(bearing), -Math.cos(bearing)];
  const angle = settings.elevation * Math.PI / 180, sine = Math.sin(angle);
  return {
    direction: axis.map(v => v / Math.tan(angle)),
    matrix: [1 + (sine-1)*axis[0]**2, (sine-1)*axis[0]*axis[1],
      (sine-1)*axis[0]*axis[1], 1 + (sine-1)*axis[1]**2],
  };
}

export function transformPoint([x,y], matrix = [1,0,0,1]) {
  return [matrix[0]*x + matrix[2]*y, matrix[1]*x + matrix[3]*y];
}
export function inversePoint([x,y], matrix = [1,0,0,1]) {
  const [a,b,c,d] = matrix, det = a*d-b*c;
  return [(d*x-c*y)/det, (a*y-b*x)/det];
}
export function worldToScreen(point, camera, origin, matrix) {
  const p=transformPoint([point[0]-camera.x,point[1]-camera.y],matrix);
  return [origin[0]+p[0]*camera.zoom,origin[1]+p[1]*camera.zoom];
}
export function screenToWorld(point, camera, origin, matrix) {
  const p=inversePoint([(point[0]-origin[0])/camera.zoom,(point[1]-origin[1])/camera.zoom],matrix);
  return [p[0]+camera.x,p[1]+camera.y];
}

/** Bake the fixed camera once. Per-frame affine sampling of software atlases is
 * expensive on WebKit; moving lights still use the same matrix at composition time. */
export function bakeProjection(source, bounds, resolution, matrix) {
  const corners=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]].map(p=>transformPoint(p,matrix));
  const next=[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];
  const w=next[2]-next[0],h=next[3]-next[1],scale=Math.min(resolution,3600/Math.max(w,h));
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(w*scale);canvas.height=Math.ceil(h*scale);
  try {
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw Error('Canvas 2D unavailable');
    ctx.setTransform(scale,0,0,scale,-next[0]*scale,-next[1]*scale);ctx.transform(...matrix,0,0);
    ctx.drawImage(source,bounds[0],bounds[1],bounds[2]-bounds[0],bounds[3]-bounds[1]);
  } catch(error) {canvas.width=canvas.height=0;throw error;}
  source.width=source.height=0;
  return {canvas,bounds:next,resolution:scale};
}
