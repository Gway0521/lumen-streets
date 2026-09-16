// Dictionary-encoded JSON avoids repeating the height schema on every building.
// Geometry, raw nulls, GERS identities and provenance retain their exact values.
export function encodeTile(features, lumen) {
  const columns = [
    ...new Set(features.flatMap((f) => Object.keys(f.properties))),
  ].sort();
  return {
    format: "lumen-buildings-1",
    columns,
    lumen,
    features: features.map((f) => [
      f.id,
      f.geometry.type === "MultiPolygon" ? 1 : 0,
      f.geometry.coordinates,
      columns.map((k) => f.properties[k] ?? null),
    ]),
  };
}
export function expandTile(data) {
  if (data?.format !== "lumen-buildings-1") return data;
  if (
    !Array.isArray(data.columns) ||
    data.columns.length > 48 ||
    new Set(data.columns).size !== data.columns.length ||
    data.columns.some(
      (k) =>
        typeof k !== "string" ||
        k.length > 64 ||
        ["__proto__", "constructor", "prototype"].includes(k),
    ) ||
    !Array.isArray(data.features) ||
    data.features.length > 30000
  )
    throw Error("Invalid building tile dictionary");
  return {
    type: "FeatureCollection",
    lumen: data.lumen,
    features: data.features.map((f) => {
      if (
        !Array.isArray(f) ||
        f.length !== 4 ||
        ![0, 1].includes(f[1]) ||
        !Array.isArray(f[3]) ||
        f[3].length !== data.columns.length
      )
        throw Error("Invalid building row");
      return {
        type: "Feature",
        id: f[0],
        geometry: {
          type: f[1] ? "MultiPolygon" : "Polygon",
          coordinates: f[2],
        },
        properties: Object.fromEntries(
          data.columns.map((k, i) => [k, f[3][i]]),
        ),
      };
    }),
  };
}
