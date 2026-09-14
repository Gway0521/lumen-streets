/** World metres remain east/south/up. Aerial-7 keeps its original oblique view. */
export const LEGACY_DIRECTION = Object.freeze([-.32, -.48]);
const length = Math.hypot(...LEGACY_DIRECTION);
const axis = LEGACY_DIRECTION.map(v => v / length);

export function sceneProjection(settings) {
  if (settings?.projection !== 2) return { direction: LEGACY_DIRECTION, matrix: [1, 0, 0, 1] };
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
