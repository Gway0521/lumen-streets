// Tiny neighbouring houses become one occupied volume when the distant-instance
// budget is exceeded. Tall or broad buildings remain individually recognisable.
// Every input contributes to an output; coverage is never truncated by array order.
export function compactVolumes(input, budget) {
  if (input.length / 12 <= budget) return input;
  let output = input;
  for (let cell = 20; cell <= 160; cell *= 2) {
    const cells = new Map(),
      result = [];
    for (let i = 0; i < input.length; i += 12) {
      const v = input.subarray(i, i + 12);
      if (v[5] > 35 || v[3] > 60 || v[4] > 60 || v[2] > 2) {
        result.push(...v);
        continue;
      }
      const key = `${Math.floor(v[0] / cell)}/${Math.floor(v[1] / cell)}`;
      const a = cells.get(key),
        weight = Math.max(1, v[3] * v[4]);
      if (!a)
        cells.set(key, {
          v: Array.from(v),
          weight,
          x: v[0] * weight,
          y: v[1] * weight,
        });
      else {
        a.weight += weight;
        a.x += v[0] * weight;
        a.y += v[1] * weight;
        a.v[5] = Math.max(a.v[5], v[5]);
        a.v[3] = Math.max(a.v[3], v[3]);
        a.v[4] = Math.max(a.v[4], v[4]);
      }
    }
    for (const a of cells.values()) {
      a.v[0] = a.x / a.weight;
      a.v[1] = a.y / a.weight;
      const side = Math.min(cell * 0.82, Math.sqrt(a.weight));
      a.v[3] = Math.max(a.v[3], side);
      a.v[4] = Math.max(a.v[4], side);
      result.push(...a.v);
    }
    output = new Float32Array(result);
    if (output.length / 12 <= budget) break;
  }
  return output;
}
