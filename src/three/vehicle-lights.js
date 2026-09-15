import { sample } from "../traffic.js";

// A short exposure along the current road keeps red and white traffic legible
// without retaining frame history or changing the underlying simulation.
export function vehicleLights(car, bearing, emit) {
  const p = sample(car.edge, car.s);
  const toward =
    -Math.cos(p.angle) * Math.sin(bearing) +
    Math.sin(p.angle) * Math.cos(bearing);
  const front = Math.max(0, Math.min(1, 0.5 + toward * 2));
  const color = [1, 0.22 + front * 0.72, 0.1 + front * 0.72];
  emit(p.x, p.y, 1.2, color);
  const exposure = Math.min(8, car.s, Math.max(0, car.speed) * 0.4);
  if (exposure < 1) return;
  const trail = sample(car.edge, car.s - exposure);
  emit(
    trail.x,
    trail.y,
    1.2,
    color.map((c) => c * 0.46),
  );
}
