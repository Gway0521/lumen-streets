import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const MODEL_LIMITS = {
  bytes: 8 * 1024 * 1024,
  triangles: 20000,
  vertices: 60000,
  nodes: 256,
};
export function inspectGLB(buffer) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < 28 ||
    buffer.byteLength > MODEL_LIMITS.bytes
  )
    throw Error("Use a GLB file smaller than 8 MB.");
  const v = new DataView(buffer);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== buffer.byteLength
  )
    throw Error("Invalid GLB 2.0 header.");
  const jsonSize = v.getUint32(12, true);
  if (
    v.getUint32(16, true) !== 0x4e4f534a ||
    jsonSize > 1024 * 1024 ||
    jsonSize + 20 > buffer.byteLength
  )
    throw Error("Invalid GLB metadata.");
  const doc = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonSize)),
  );
  if (
    doc.scenes?.length !== 1 ||
    (doc.meshes?.length || 0) > 128 ||
    (doc.materials?.length || 0) > 64 ||
    (doc.accessors?.length || 0) > 512 ||
    (doc.bufferViews?.length || 0) > 512
  )
    throw Error("Use one scene with bounded meshes and materials.");
  if (
    doc.asset?.version !== "2.0" ||
    doc.extensionsUsed?.length ||
    doc.extensionsRequired?.length ||
    doc.images?.length ||
    doc.textures?.length ||
    doc.skins?.length ||
    doc.animations?.length
  )
    throw Error(
      "Use an uncompressed, static GLB with materials and no textures or extensions.",
    );
  if (
    !doc.nodes?.length ||
    doc.nodes.length > MODEL_LIMITS.nodes ||
    doc.buffers?.length !== 1 ||
    doc.buffers[0].uri
  )
    throw Error("Use one embedded buffer and at most 256 nodes.");
  const binOffset = 20 + jsonSize;
  if (
    binOffset + 8 > buffer.byteLength ||
    v.getUint32(binOffset + 4, true) !== 0x004e4942 ||
    binOffset + 8 + v.getUint32(binOffset, true) !== buffer.byteLength ||
    doc.buffers[0].byteLength > v.getUint32(binOffset, true)
  )
    throw Error("Invalid embedded geometry buffer.");
  let vertices = 0,
    triangles = 0;
  for (const a of doc.accessors || []) {
    if (
      !Number.isInteger(a.count) ||
      a.count < 0 ||
      a.count > 180000 ||
      a.sparse
    )
      throw Error("Invalid or oversized geometry accessor.");
    const b = doc.bufferViews?.[a.bufferView],
      components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type],
      bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[
        a.componentType
      ];
    if (
      !b ||
      !components ||
      !bytes ||
      !Number.isInteger(a.byteOffset ?? 0) ||
      (a.byteOffset || 0) < 0 ||
      (b.byteStride &&
        (!Number.isInteger(b.byteStride) ||
          b.byteStride < components * bytes ||
          b.byteStride > 252)) ||
      (a.byteOffset || 0) +
        Math.max(0, a.count - 1) * (b.byteStride || components * bytes) +
        (a.count ? components * bytes : 0) >
        b.byteLength
    )
      throw Error("Geometry accessor is out of bounds.");
  }
  for (const b of doc.bufferViews || [])
    if (
      b.buffer !== 0 ||
      !Number.isInteger(b.byteLength) ||
      b.byteLength < 0 ||
      (b.byteOffset || 0) < 0 ||
      (b.byteOffset || 0) + b.byteLength > doc.buffers[0].byteLength
    )
      throw Error("Geometry buffer is out of bounds.");
  const visiting = new Set(),
    visited = new Set();
  const walk = (i) => {
    if (!Number.isInteger(i) || !doc.nodes[i] || visiting.has(i))
      throw Error("Invalid or cyclic scene.");
    if (visited.has(i))
      throw Error("A model node cannot have multiple parents.");
    visiting.add(i);
    const n = doc.nodes[i];
    for (const key of ["matrix", "translation", "rotation", "scale"])
      if (
        n[key] &&
        (!Array.isArray(n[key]) ||
          n[key].some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6))
      )
        throw Error("Invalid model transform.");
    if (n.mesh !== undefined) {
      const mesh = doc.meshes?.[n.mesh];
      if (!mesh) throw Error("Missing mesh.");
      for (const p of mesh.primitives || []) {
        if ((p.mode ?? 4) !== 4 || p.targets)
          throw Error("Use static triangle meshes.");
        const a = doc.accessors?.[p.attributes?.POSITION],
          idx = doc.accessors?.[p.indices];
        if (!a || a.type !== "VEC3") throw Error("Missing vertex positions.");
        vertices += a.count;
        triangles += (idx?.count ?? a.count) / 3;
      }
    }
    for (const child of n.children || []) walk(child);
    visiting.delete(i);
    visited.add(i);
  };
  const roots = doc.scenes?.[doc.scene ?? 0]?.nodes;
  if (!Array.isArray(roots)) throw Error("Missing model scene.");
  roots.forEach(walk);
  if (visited.size !== doc.nodes.length)
    throw Error("Remove unused nodes from the model.");
  if (
    !triangles ||
    triangles > MODEL_LIMITS.triangles ||
    vertices > MODEL_LIMITS.vertices
  )
    throw Error("Use at most 20,000 triangles and 60,000 vertices.");
  return { doc, triangles, vertices };
}
export async function importModel(buffer, { anchor, height, bearing = 0 }) {
  const info = inspectGLB(buffer);
  if (
    !Array.isArray(anchor) ||
    anchor.length !== 2 ||
    !anchor.every(Number.isFinite) ||
    Math.abs(anchor[0]) > 180 ||
    Math.abs(anchor[1]) > 80 ||
    !Number.isFinite(height) ||
    height < 2 ||
    height > 1000 ||
    !Number.isFinite(bearing)
  )
    throw Error("Invalid model placement.");
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => {
    throw Error("External model resources are disabled.");
  });
  const gltf = await new GLTFLoader(manager).parseAsync(buffer, "");
  const source = gltf.scene;
  try {
    let actual = 0;
    source.traverse((n) => {
      if (n.isMesh) {
        const a = n.geometry.attributes.position;
        for (const v of a.array)
          if (!Number.isFinite(v) || Math.abs(v) > 1e7)
            throw Error("Invalid model coordinates.");
        actual += (n.geometry.index?.count ?? a.count) / 3;
        const original = [n.material].flat();
        n.material = original.map(
          (m) =>
            new THREE.MeshBasicMaterial({
              color: m.color || 0x31424c,
              side: THREE.DoubleSide,
            }),
        );
        if (n.material.length === 1) n.material = n.material[0];
        original.forEach((m) => m.dispose());
      }
    });
    if (actual > MODEL_LIMITS.triangles)
      throw Error("Model exceeds the triangle budget.");
    const box = new THREE.Box3().setFromObject(source),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    if (
      !Number.isFinite(size.y) ||
      size.y < 0.001 ||
      Math.max(size.x, size.z) / size.y > 20
    )
      throw Error("The model must have a finite vertical extent.");
    source.position.set(-center.x, -box.min.y, -center.z);
    const pivot = new THREE.Group();
    pivot.add(source);
    pivot.scale.setScalar(height / size.y);
    pivot.rotation.x = Math.PI / 2;
    const object = new THREE.Group();
    object.add(pivot);
    object.rotation.z = (bearing * Math.PI) / 180;
    object.userData = {
      anchor: [...anchor],
      height,
      bearing,
      triangles: info.triangles,
    };
    return object;
  } catch (error) {
    source.traverse((n) => {
      n.geometry?.dispose();
      [n.material]
        .flat()
        .filter(Boolean)
        .forEach((m) => m.dispose());
    });
    throw error;
  }
}
