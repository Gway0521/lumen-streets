import * as THREE from "three";
import { Traffic, sample } from "../traffic.js";
import { trainState, railPosition } from "../rail.js";
import { nightMaterial, trafficMaterial } from "./materials.js";
import { mercator, metreScale, clamp } from "./geo.js";
import { unpackGraph } from "./graph-wire.js";
import { VIEW } from "./view.js";
import { NightBloom } from "./bloom.js";
import { NightEnvironment } from "./environment-layer.js";

export class NightLayer {
  id = "lumen-night";
  type = "custom";
  renderingMode = "3d";
  constructor({ mobile, onStats }) {
    this.mobile = mobile;
    this.onStats = onStats;
    this.playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.density = mobile ? 400 : 700;
    this.glow = 1;
    this.accumulator = 0;
    this.time = 0;
    this.origin = [0, 0];
    this.mesh = null;
    this.routes = [];
    this.last = 0;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.material = nightMaterial();
    this.distantMaterial = nightMaterial(true);
    this.pointMaterial = trafficMaterial();
    const positions = new Float32Array(6000 * 3),
      colors = new Float32Array(6000 * 3);
    this.pointsGeometry = new THREE.BufferGeometry();
    this.pointsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.pointsGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.pointsGeometry.setDrawRange(0, 0);
    this.points = new THREE.Points(this.pointsGeometry, this.pointMaterial);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.uploads = new THREE.Group();
    this.scene.add(this.uploads);
    this.lampMaterial = trafficMaterial();
    this.lampMaterial.uniforms.pointSize.value = 7;
  }
  onAdd(map, gl) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.bloom = new NightBloom();
  }
  replace({
    origin,
    geometry,
    graph,
    routes,
    surface,
    surfaceKey,
    environment,
  }) {
    if (this.environment) {
      this.scene.remove(this.environment);
      this.environment.dispose();
    }
    this.environment = new NightEnvironment(environment);
    this.scene.add(this.environment);
    graph = unpackGraph(graph);
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    for (const [key, size] of Object.entries({
      position: 3,
      normal: 3,
      uv: 2,
      color: 3,
      seed: 1,
    }))
      g.setAttribute(key, new THREE.BufferAttribute(geometry[key], size));
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    if (this.distant) {
      this.scene.remove(this.distant);
      this.distant.geometry.dispose();
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0, 0.5);
    const instances = new THREE.InstancedBufferGeometry();
    instances.index = box.index;
    instances.attributes = box.attributes;
    const packed = new THREE.InstancedInterleavedBuffer(geometry.boxes, 12);
    for (const [key, size, offset] of [
      ["offset", 3, 0],
      ["extent", 3, 3],
      ["heading", 2, 6],
      ["tone", 3, 8],
      ["idSeed", 1, 11],
    ])
      instances.setAttribute(
        key,
        new THREE.InterleavedBufferAttribute(packed, size, offset),
      );
    instances.instanceCount = geometry.boxes.length / 12;
    this.distant = new THREE.Mesh(instances, this.distantMaterial);
    this.distant.frustumCulled = false;
    this.scene.add(this.distant);
    if (surface !== undefined) this.clearSurface();
    this.surfaceKey = surfaceKey;
    if (surface) {
      const texture = new THREE.Texture(surface.bitmap);
      texture.flipY = false;
      texture.needsUpdate = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      const g = new THREE.PlaneGeometry(
        surface.b[0] - surface.a[0],
        surface.b[1] - surface.a[1],
      );
      const m = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.surface = new THREE.Mesh(g, m);
      this.surface.position.set(
        (surface.a[0] + surface.b[0]) / 2,
        (surface.a[1] + surface.b[1]) / 2,
        0.15,
      );
      this.surface.renderOrder = -2;
      this.scene.add(this.surface);
    }
    const previous = this.traffic,
      previousOrigin = this.origin;
    this.origin = origin;
    this.traffic = new Traffic(graph);
    if (previous && previousOrigin.every((n, i) => n === origin[i])) {
      const key = (e) => `${e.wayId}/${e.from.id}/${e.to.id}`,
        edges = new Map(graph.edges.map((e) => [key(e), e]));
      this.traffic.time = previous.time;
      this.traffic.randomState = previous.randomState;
      this.traffic.serial = previous.serial;
      this.traffic.cars = previous.cars.flatMap((c) => {
        const edge = edges.get(key(c.edge)),
          next = c.next ? edges.get(key(c.next)) : null;
        return edge && c.s <= edge.length && (!next || next.from === edge.to)
          ? [{ ...c, edge, next: next || null }]
          : [];
      });
    }
    this.traffic.setCount(this.density);
    if (!previous) for (let i = 0; i < 100; i++) this.traffic.update(0.05);
    this.routes = routes;
    this.stats = {
      buildings: geometry.buildings,
      triangles: geometry.position.length / 9,
      geometryMiB:
        Object.values(geometry)
          .filter((v) => v?.byteLength)
          .reduce((n, v) => n + v.byteLength, 0) / 1048576,
      truncated: geometry.truncated,
      simplified: geometry.boxes.length / 12,
      aggregated: geometry.aggregated,
      tiles: geometry.tileCount,
      tileLimited: geometry.tileLimited,
      tileCacheMiB: geometry.tileCacheMiB,
    };
    if (this.lamps) {
      this.scene.remove(this.lamps);
      this.lamps.geometry.dispose();
    }
    const lampPositions = [],
      lampColors = [],
      seen = new Set();
    for (const edge of graph.edges) {
      const key = `${edge.wayId}/${[String(edge.from.id), String(edge.to.id)].sort().join("/")}`;
      if (seen.has(key) || edge.width < 14) continue;
      seen.add(key);
      for (let d = 12; d < edge.length; d += 38) {
        const p = sample(edge, d),
          dx = Math.cos(p.angle),
          dy = Math.sin(p.angle),
          offset = edge.width * 0.37;
        for (const side of [-1, 1]) {
          lampPositions.push(
            p.x - dy * (side * offset - edge.lane),
            p.y + dx * (side * offset - edge.lane),
            2.5,
          );
          const warm = 0.65 + ((Math.floor(d) + edge.id) % 9) / 30;
          lampColors.push(warm, warm * 0.78, warm * 0.45);
        }
        if (lampPositions.length > 45000) break;
      }
      if (lampPositions.length > 45000) break;
    }
    const lamps = new THREE.BufferGeometry();
    lamps.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(lampPositions, 3),
    );
    lamps.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(lampColors, 3),
    );
    this.lamps = new THREE.Points(lamps, this.lampMaterial);
    this.lamps.frustumCulled = false;
    this.scene.add(this.lamps);
    this.updateUploads();
    this.updatePoints();
    this.map.triggerRepaint();
  }
  clear() {
    this.bloom?.release();
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.distant) {
      this.scene.remove(this.distant);
      this.distant.geometry.dispose();
      this.distant = null;
    }
    this.clearSurface();
    if (this.environment) {
      this.scene.remove(this.environment);
      this.environment.dispose();
      this.environment = null;
    }
    this.surfaceKey = null;
    this.traffic = null;
    this.routes = [];
    this.pointsGeometry.setDrawRange(0, 0);
    this.stats = { buildings: 0, triangles: 0, geometryMiB: 0 };
    if (this.lamps) {
      this.scene.remove(this.lamps);
      this.lamps.geometry.dispose();
      this.lamps = null;
    }
  }
  clearSurface() {
    if (!this.surface) return;
    this.scene.remove(this.surface);
    this.surface.material.map.image.close();
    this.surface.material.map.dispose();
    this.surface.material.dispose();
    this.surface.geometry.dispose();
    this.surface = null;
  }
  setDensity(value) {
    this.density = value;
    this.traffic?.setCount(value);
    this.updatePoints();
    this.map?.triggerRepaint();
  }
  advance(dt) {
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator >= 0.05) {
      this.traffic?.update(0.05);
      this.time += 0.05;
      this.accumulator -= 0.05;
    }
    this.updatePoints();
  }
  updatePoints() {
    const pos = this.pointsGeometry.attributes.position.array,
      col = this.pointsGeometry.attributes.color.array;
    let i = 0;
    const add = (x, y, z, c) => {
      if (i >= 6000) return;
      pos.set([x, y, z], i * 3);
      col.set(c, i * 3);
      i++;
    };
    for (const car of this.traffic?.cars || []) {
      const p = sample(car.edge, car.s),
        dx = Math.cos(p.angle),
        dy = Math.sin(p.angle);
      add(p.x + dx * 2, p.y + dy * 2, 1.2, [1, 0.92, 0.72]);
      add(p.x - dx * 2, p.y - dy * 2, 1.2, [0.95, 0.14, 0.045]);
    }
    for (const [index, route] of this.routes.entries()) {
      const train = trainState(route, this.time, index);
      if (!train) continue;
      for (let j = 0; j < 6; j++) {
        const p = railPosition(route, train.s - j * 18);
        if (p && !p.hidden) add(p.x, p.y, 3, [0.45, 0.8, 1]);
      }
    }
    this.pointsGeometry.attributes.position.needsUpdate = true;
    this.pointsGeometry.attributes.color.needsUpdate = true;
    this.pointsGeometry.setDrawRange(0, i);
  }
  updateUploads() {
    const o = mercator(...this.origin),
      scale = metreScale(this.origin[1]);
    for (const model of this.uploads.children) {
      const p = mercator(...model.userData.anchor);
      model.position.set((p[0] - o[0]) / scale, (p[1] - o[1]) / scale, 0);
    }
  }
  render(gl, args) {
    const now = performance.now(),
      dt = this.last ? (now - this.last) / 1000 : 0;
    this.last = now;
    const z = this.map.getZoom(),
      visible = z >= VIEW.atlas;
    this.scene.visible = visible;
    this.material.uniforms.rise.value = clamp(
      (z - VIEW.atlas) / (VIEW.fullHeight - VIEW.atlas),
      0,
      1,
    );
    this.material.uniforms.detail.value = clamp((z - 12) / 0.9, 0, 1);
    this.material.uniforms.glow.value = this.glow;
    for (const key of ["rise", "detail", "glow"])
      this.distantMaterial.uniforms[key].value =
        this.material.uniforms[key].value;
    this.pointMaterial.uniforms.glow.value = this.glow;
    this.pointMaterial.uniforms.pointSize.value =
      clamp((z - 11.5) * 0.85, 1.2, 3) * this.map.getPixelRatio();
    this.points.visible = z >= VIEW.traffic;
    this.lampMaterial.uniforms.glow.value = this.glow * 0.85;
    this.lampMaterial.uniforms.pointSize.value =
      clamp((z - 11.7) * 1.25, 1.3, 3.8) * this.map.getPixelRatio();
    if (
      this.playing &&
      !this.capturing &&
      !document.hidden &&
      visible &&
      this.points.visible
    )
      this.advance(dt);
    const origin = mercator(...this.origin),
      s = metreScale(this.origin[1]);
    const transform = new THREE.Matrix4()
      .makeTranslation(origin[0], origin[1], 0)
      .scale(new THREE.Vector3(s, s, s));
    this.camera.projectionMatrix
      .fromArray(args.defaultProjectionData.mainMatrix)
      .multiply(transform);
    this.environment?.update(
      this.time,
      this.map.getBearing(),
      this.glow,
      z,
      this.map.getPixelRatio(),
    );
    this.renderer.resetState();
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    if (visible && this.mesh)
      this.bloom.render(
        this.renderer,
        gl,
        this.map.getCanvas().width,
        this.map.getCanvas().height,
        this.glow,
      );
    this.renderer.resetState();
    if (now - (this.lastStats || 0) > 1000) {
      this.onStats?.({
        ...this.stats,
        cars: this.traffic?.cars.length || 0,
        drawCalls: this.renderer.info.render.calls,
        bloomMiB: this.bloom.bytes / 1048576,
        environmentMiB: (this.environment?.bytes || 0) / 1048576,
      });
      this.lastStats = now;
    }
  }
  disposeObject(object) {
    object.traverse((n) => {
      n.geometry?.dispose();
      for (const m of [n.material].flat().filter(Boolean)) {
        for (const value of Object.values(m))
          if (value?.isTexture) value.dispose();
        m.dispose();
      }
    });
  }
  onRemove() {
    this.clear();
    this.disposeObject(this.uploads);
    this.pointsGeometry.dispose();
    this.material.dispose();
    this.distantMaterial.dispose();
    this.pointMaterial.dispose();
    this.lampMaterial.dispose();
    this.bloom.dispose();
    this.renderer.dispose();
  }
}
