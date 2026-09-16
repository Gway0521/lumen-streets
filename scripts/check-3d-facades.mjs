import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const out = process.env.QA_OUTPUT || "artifacts/3d-facades";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1664, height: 936 } });
const report = { errors: [] };
page.on("pageerror", (e) => report.errors.push(e.stack));
page.on("console", (e) => {
  if (e.type() === "error") report.errors.push(e.text());
});
try {
  await page.goto(
    "http://127.0.0.1:5180/three.html?city=sapporo&lng=141.3566&lat=43.0591&zoom=16.5&bearing=0&pitch=40&embed=1",
  );
  await page.waitForFunction(
    () => window.__lumen3d?.stream?.ready && !window.__lumen3d.stream.busy,
    null,
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    window.__lumen3d.layer.playing = false;
  });
  await page.screenshot({ path: `${out}/fixed-sapporo.png` });
  report.gpu = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { nightMaterial } = await import("/src/three/materials.js");
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(256, 256);
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const target = new THREE.WebGLRenderTarget(256, 256);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000);
    camera.position.set(110, 65, 210);
    camera.lookAt(0, 0, 0);
    const results = [];
    // Diagnose the actual production seed/hash path, without textures, bloom,
    // depth overlap or window edges concealing interpolation errors.
    const probe = (instanced, smoothControl) => {
      const material = nightMaterial(instanced);
      material.fragmentShader = material.fragmentShader.replace(
        /void main\(\)\{[\s\S]*$/,
        "void main(){float h=hash(vec2(19.,7.));gl_FragColor=vec4(vec3(h),1.);}",
      );
      if (smoothControl) {
        material.vertexShader = material.vertexShader.replace(
          "flat varying float vSeed",
          "varying float vSeed",
        );
        material.fragmentShader = material.fragmentShader.replace(
          "flat varying float vSeed",
          "varying float vSeed",
        );
      }
      const plane = new THREE.PlaneGeometry(160, 90);
      const geometry = instanced
        ? new THREE.InstancedBufferGeometry().copy(plane)
        : plane;
      geometry.setAttribute(
        "seed",
        new THREE.Float32BufferAttribute(new Float32Array(4), 1),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(new Float32Array(12).fill(1), 3),
      );
      if (instanced) {
        geometry.instanceCount = 1;
        for (const [key, values, size] of [
          ["offset", [0, 0, 0], 3],
          ["extent", [1, 1, 1], 3],
          ["heading", [1, 0], 2],
          ["tone", [1, 1, 1], 3],
          ["idSeed", [0], 1],
        ])
          geometry.setAttribute(
            key,
            new THREE.InstancedBufferAttribute(new Float32Array(values), size),
          );
      }
      const mesh = new THREE.Mesh(geometry, material),
        scene = new THREE.Scene();
      scene.add(mesh);
      const bytes = new Uint8Array(256 * 256 * 4);
      for (const seed of [13, 511, 2047, 4093, 8191, 9999])
        for (const angle of [0, 0.55, 1.05]) {
          const attr = geometry.attributes[instanced ? "idSeed" : "seed"];
          attr.array.fill(seed);
          attr.needsUpdate = true;
          mesh.rotation.y = angle;
          renderer.setRenderTarget(target);
          renderer.render(scene, camera);
          renderer.readRenderTargetPixels(target, 0, 0, 256, 256, bytes);
          const colors = new Set();
          let pixels = 0;
          for (let i = 0; i < bytes.length; i += 4)
            if (bytes[i + 3] === 255) {
              colors.add(bytes[i]);
              pixels++;
            }
          results.push({
            instanced,
            smoothControl,
            seed,
            angle,
            colors: colors.size,
            pixels,
          });
        }
      geometry.dispose();
      if (instanced) plane.dispose();
      material.dispose();
    };
    try {
      for (const instanced of [false, true]) {
        probe(instanced, false);
        probe(instanced, true);
      }
      // Exercise the production Z-up instance path on every wall. Horizontal
      // UVs must vary across a wall, while remaining constant up its height.
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0, 0.5);
      const geometry = new THREE.InstancedBufferGeometry().copy(box);
      geometry.instanceCount = 1;
      for (const [name, values, size] of [
        ["offset", [0, 0, 0], 3],
        ["extent", [40, 28, 100], 3],
        ["heading", [1, 0], 2],
        ["tone", [1, 1, 1], 3],
        ["idSeed", [30013], 1],
      ])
        geometry.setAttribute(
          name,
          new THREE.InstancedBufferAttribute(new Float32Array(values), size),
        );
      const uvMaterial = nightMaterial(true);
      uvMaterial.fragmentShader = uvMaterial.fragmentShader.replace(
        /void main\(\)\{[\s\S]*$/,
        "void main(){gl_FragColor=vec4(vUv.x/vFacade.w,vUv.y/100.,0.,1.);}",
      );
      const scene = new THREE.Scene();
      scene.add(new THREE.Mesh(geometry, uvMaterial));
      const ortho = new THREE.OrthographicCamera(-25, 25, 60, -60, 1, 500);
      ortho.up.set(0, 0, 1);
      const walls = [];
      for (const [x, y] of [
        [150, 0],
        [-150, 0],
        [0, 150],
        [0, -150],
      ]) {
        ortho.position.set(x, y, 50);
        ortho.lookAt(0, 0, 50);
        renderer.setRenderTarget(target);
        renderer.render(scene, ortho);
        const bytes = new Uint8Array(256 * 256 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 256, 256, bytes);
        const pixel = (u, v) =>
          Array.from(bytes.slice((v * 256 + u) * 4, (v * 256 + u) * 4 + 4));
        walls.push({
          view: [x, y],
          left: pixel(96, 128),
          right: pixel(160, 128),
          low: pixel(128, 80),
          high: pixel(128, 176),
        });
      }
      geometry.dispose();
      box.dispose();
      uvMaterial.dispose();
      return { results, walls, glError: renderer.getContext().getError() };
    } finally {
      target.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  });
  const fixed = report.gpu.results.filter((r) => !r.smoothControl);
  assert.ok(
    fixed.every((r) => r.pixels > 1000 && r.colors === 1),
    "Each building seed must produce exactly one hash colour across its entire projected surface",
  );
  for (const instanced of [false, true])
    assert.ok(
      report.gpu.results.some(
        (r) => r.instanced === instanced && r.smoothControl && r.colors > 1,
      ),
      "Control must reproduce smooth-interpolation noise",
    );
  assert.equal(report.gpu.glError, 0);
  for (const wall of report.gpu.walls) {
    assert.ok(
      Math.abs(wall.left[0] - wall.right[0]) > 60,
      "All walls need horizontal window coordinates",
    );
    assert.ok(
      Math.abs(wall.low[0] - wall.high[0]) <= 1,
      "Window columns must not follow height",
    );
    assert.ok(
      Math.abs(wall.low[1] - wall.high[1]) > 90,
      "Window rows follow Z height",
    );
  }
  await page.evaluate(() => {
    window.__lumen3d.map.jumpTo({ bearing: 27, pitch: 48 });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/fixed-rotated.png` });
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
