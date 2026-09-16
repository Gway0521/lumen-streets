import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  readdir,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { globalHeight } from "../src/buildings/global-height.js";
import { encodeTile, expandTile } from "../src/buildings/tile-wire.js";
import { decodeHeightTile } from "../src/three/height-tiles.js";
import { assembleFeatures, boundsOf } from "../server/buildings/source.mjs";
import { createJobs } from "../server/buildings/jobs.mjs";
import { createBuildingService } from "../server/buildings/index.mjs";
const polygon = (w, s, e, n) => ({
  type: "Polygon",
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});
const feature = (p = {}, geometry = polygon(120, 22, 120.0001, 22.0001)) => ({
  type: "Feature",
  id: "overture/a",
  properties: { id: "a", ...p },
  geometry,
});

test("global source keeps actual five metres distinct from missing, modeled heights and floors", () => {
  const mapped = globalHeight(
    feature({
      height: 5,
      sources: [{ dataset: "OpenStreetMap", property: "properties/height" }],
    }),
  );
  assert.equal(mapped.height_m, 5);
  assert.equal(mapped.height_missing, false);
  assert.equal(mapped.height_estimated, false);
  const unknown = globalHeight(
    feature({
      height: 5,
      sources: [{ dataset: "OpenStreetMap", property: "/geometry" }],
    }),
  );
  assert.equal(unknown.height_method, "model");
  assert.equal(unknown.height_missing, false);
  const missing = globalHeight(feature({ class: "house" }));
  assert.equal(missing.height_raw, null);
  assert.equal(missing.height_m, 6);
  assert.equal(missing.height_missing, true);
  const floors = globalHeight(
    feature({
      height: 10,
      num_floors: 4,
      min_height: 3,
      sources: [{ dataset: "Microsoft", property: "/height" }],
    }),
  );
  assert.equal(floors.height_method, "levels");
  assert.equal(floors.height_m, 12.8);
  assert.equal(floors.height_raw, 10);
  assert.equal(floors.min_height_m, 3);
  assert.equal(
    globalHeight(feature({ min_height: 99, height: -1 })).min_height_m,
    0,
  );
});

test("compact tile preserves nulls, courtyard holes, source identity and all height fields", () => {
  const f = feature({ height: 5 });
  f.geometry.coordinates.push([
    [120.00002, 22.00002],
    [120.00002, 22.00004],
    [120.00004, 22.00004],
    [120.00004, 22.00002],
    [120.00002, 22.00002],
  ]);
  f.properties = globalHeight(f);
  const value = encodeTile([f], { status: "pending" });
  assert.deepEqual(
    decodeHeightTile(new TextEncoder().encode(JSON.stringify(value))),
    [f],
  );
  assert.throws(() => expandTile({ ...value, columns: ["__proto__"] }));
  assert.throws(() => expandTile({ ...value, features: [[f.id, 5, [], []]] }));
});

test("a footprint crossing three tiles is joined before deduplication without clipping walls", async () => {
  const x = 8000,
    y = 8000,
    b = boundsOf(x, y),
    width = b[2] - b[0],
    h = (b[3] - b[1]) / 4;
  const w = b[0] + width * 0.5,
    e = b[2] + width * 1.5,
    s = b[1] + h,
    n = b[3] - h;
  const fragments = new Map();
  for (let i = 0; i < 3; i++)
    fragments.set(`${x + i}/${y}`, [
      feature(
        {},
        polygon(
          Math.max(w, b[0] + width * i),
          s,
          Math.min(e, b[2] + width * i),
          n,
        ),
      ),
    ]);
  const joined = await assembleFeatures(
    async (a, c) => fragments.get(`${a}/${c}`) || [],
    x,
    y,
  );
  assert.equal(joined.length, 1);
  const points = joined[0].geometry.coordinates.flat(2);
  assert.equal(Math.min(...points.map((p) => p[0])), w);
  assert.equal(Math.max(...points.map((p) => p[0])), e);
  const again = await assembleFeatures(
    async (a, c) => fragments.get(`${a}/${c}`) || [],
    x + 1,
    y,
  );
  assert.deepEqual(again, joined);
  await assert.rejects(
    () =>
      assembleFeatures(
        async (a, c) => fragments.get(`${a}/${c}`) || [],
        x,
        y,
        1,
      ),
    /budget/,
  );
});

test("global endpoint is available outside any preset and retains estimates when worker is unavailable", async () => {
  const service = createBuildingService({
    source: { release: "test", features: async () => [feature()] },
    jobs: {
      get: async () => ({
        status: "unavailable",
        overrides: {},
        credits: [],
        states: { worker: "unavailable" },
      }),
      close() {},
    },
  });
  assert.equal(service.manifest.version, 2);
  assert.equal(service.manifest.global, true);
  assert.equal(service.manifest.tiles, "./{z}/{x}/{y}.json");
  assert.equal(service.manifest.regions, undefined);
  for (const [x, y] of [
    [9867, 8250],
    [100, 100],
    [13667, 7134],
  ]) {
    const response = await service.tile(14, x, y),
      tile = expandTile(JSON.parse(gunzipSync(response.body)));
    assert.equal(tile.lumen.status, "unavailable");
    assert.equal(tile.features[0].properties.height_method, "fallback");
  }
  await assert.rejects(() => service.tile(14, -1, 0));
  await assert.rejects(() => service.tile(13, 1, 1));
});

test("background jobs coalesce across visitors and publish persistent context before national matching", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumen-jobs-"));
  let context = 0,
    national = 0,
    releaseNational;
  const nationalGate = new Promise((r) => {
    releaseNational = r;
  });
  const jobs = createJobs({
    directory,
    runner: async (input, output, stage) => {
      const payload = JSON.parse(await readFile(input, "utf8"));
      if (stage === "context") context++;
      else {
        national++;
        assert.equal(payload.context.overrides.a.height_m, 24);
        await nationalGate;
      }
      await writeFile(
        output,
        JSON.stringify({
          overrides: { a: { height_m: stage === "context" ? 24 : 40 } },
          credits: [],
          states: { [stage]: "complete" },
        }),
      );
    },
  });
  try {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        jobs.get("one", [feature()], [139, 35, 139.01, 35.01]),
      ),
    );
    for (let i = 0; i < 100 && !national; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(context, 1);
    assert.equal(national, 1);
    const pending = await jobs.get("one", [], []);
    assert.equal(pending.status, "pending");
    assert.equal(pending.overrides.a.height_m, 24);
    for (const name of await readdir(join(directory, "results")))
      await unlink(join(directory, "results", name));
    assert.equal(
      (await jobs.get("one", [], [])).overrides.a.height_m,
      24,
      "Queued national work retains context after result eviction",
    );
    releaseNational();
    let final;
    for (let i = 0; i < 100; i++) {
      final = await jobs.get("one", [], []);
      if (final.status === "complete") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(final.overrides.a.height_m, 40);
    const reopened = createJobs({
      directory,
      runner: () => {
        throw Error("Must use persistent cache");
      },
    });
    assert.equal((await reopened.get("one", [], [])).overrides.a.height_m, 40);
    reopened.close();
  } finally {
    jobs.close();
    releaseNational();
    await new Promise((r) => setTimeout(r, 30));
    await rm(directory, { recursive: true, force: true });
  }
});

test("fast and background resolvers obey the shared evidence fixtures", async () => {
  const fixtures = JSON.parse(
    await readFile(new URL("./fixtures/global-heights.json", import.meta.url)),
  );
  for (const item of fixtures) {
    const value = globalHeight(feature(item.properties));
    for (const [k, v] of Object.entries(item.expected))
      assert.equal(value[k], v, `${item.name}: ${k}`);
  }
});
