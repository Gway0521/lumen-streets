export interface Appearance {
  version: 1;
  brightness: number;
  glow: number;
  district: number;
  labels: boolean;
}
export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({ version: 1, brightness: 1, glow: 1, district: 1, labels: true });
export function validateAppearance(value: unknown = DEFAULT_APPEARANCE): Appearance {
  const a = value as Appearance;
  if (!a || a.version !== 1 || typeof a.labels !== 'boolean' ||
      !(['brightness', 'glow', 'district'] as const).every(k => typeof a[k] === 'number' && Number.isFinite(a[k])) ||
      a.brightness < .5 || a.brightness > 1.5 || a.glow < 0 || a.glow > 1.8 || a.district < 0 || a.district > 2)
    throw new Error('Invalid appearance');
  return { version: 1, brightness: a.brightness, glow: a.glow, district: a.district, labels: a.labels };
}
