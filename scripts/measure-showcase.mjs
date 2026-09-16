import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import {
  showcaseLandmarks,
  profileForLandmark,
  SHOWCASE_VERTEX_BUDGET,
} from "../src/three/showcase.js";
import { landmarkGeometry } from "../src/three/geometry.js";
const records = showcaseLandmarks.map((p) => {
  const start = performance.now(),
    g = landmarkGeometry(
      [profileForLandmark(p)],
      p.anchor,
      SHOWCASE_VERTEX_BUDGET,
    );
  if (g.omitted) throw Error(`Model exceeds its budget: ${p.id}`);
  return {
    id: p.id,
    city: p.city,
    triangles: g.position.length / 9,
    vertices: g.position.length / 3,
    attributeBytes: Object.values(g)
      .filter((v) => ArrayBuffer.isView(v))
      .reduce((n, v) => n + v.byteLength, 0),
    buildMs: Number((performance.now() - start).toFixed(2)),
  };
});
const files = [
  "src/three/showcase-landmarks.json",
  "src/three/showcase-shapes.js",
  "src/three/showcase.js",
].map((path) => {
  const bytes = readFileSync(path);
  return {
    path,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
  };
});
const report = {
  vertexBudget: SHOWCASE_VERTEX_BUDGET,
  files,
  records,
  totals: {
    models: records.length,
    triangles: records.reduce((n, r) => n + r.triangles, 0),
    attributeBytes: records.reduce((n, r) => n + r.attributeBytes, 0),
  },
};
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
console.table(
  Object.entries(Object.groupBy(records, (r) => r.city)).map(([city, rs]) => ({
    city,
    models: rs.length,
    triangles: rs.reduce((n, r) => n + r.triangles, 0),
    MiB: Number(
      (rs.reduce((n, r) => n + r.attributeBytes, 0) / 1048576).toFixed(3),
    ),
  })),
);
console.log(JSON.stringify({ files, totals: report.totals }, null, 2));
