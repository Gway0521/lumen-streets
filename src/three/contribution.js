import { inspectGLB } from "./model-import.js";

const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const b of data) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
/** Small, uncompressed ZIP: filenames are application-owned, never user paths. */
export function storedZip(files) {
  if (
    files.length > 8 ||
    files.reduce((n, f) => n + f.bytes.byteLength, 0) > 12 * 1024 * 1024
  )
    throw Error("Package too large");
  const parts = [],
    directory = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    if (!/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/.test(name))
      throw Error("Invalid package filename");
    const filename = encoder.encode(name),
      crc = crc32(bytes),
      header = new Uint8Array(30 + filename.length),
      v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 33, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, bytes.length, true);
    v.setUint32(22, bytes.length, true);
    v.setUint16(26, filename.length, true);
    header.set(filename, 30);
    const central = new Uint8Array(46 + filename.length),
      d = new DataView(central.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint16(14, 33, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, bytes.length, true);
    d.setUint32(24, bytes.length, true);
    d.setUint16(28, filename.length, true);
    d.setUint32(42, offset, true);
    central.set(filename, 46);
    parts.push(header, bytes);
    directory.push(central);
    offset += header.length + bytes.length;
  }
  const end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.length, true);
  v.setUint16(10, files.length, true);
  v.setUint32(
    12,
    directory.reduce((n, d) => n + d.length, 0),
    true,
  );
  v.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}

export async function contributionPackage(buffer, manifest, preview) {
  inspectGLB(buffer);
  const text = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(value);
  if (
    !text(manifest.name) ||
    !text(manifest.creator) ||
    !["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"].includes(manifest.license)
  )
    throw Error("Invalid contribution details");
  if (
    !Array.isArray(manifest.anchor) ||
    manifest.anchor.length !== 2 ||
    !manifest.anchor.every(Number.isFinite) ||
    Math.abs(manifest.anchor[0]) > 180 ||
    Math.abs(manifest.anchor[1]) > 85
  )
    throw Error("Invalid location");
  if (
    !Number.isFinite(manifest.height) ||
    manifest.height < 2 ||
    manifest.height > 1000 ||
    !Number.isFinite(manifest.bearing) ||
    Math.abs(manifest.bearing) > 360
  )
    throw Error("Invalid placement");
  const hash = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const data = {
    version: 1,
    name: manifest.name.trim(),
    format: "glb",
    file: "model.glb",
    sha256: hash,
    anchor: manifest.anchor,
    height: manifest.height,
    bearing: manifest.bearing,
    creator: manifest.creator.trim(),
    license: manifest.license,
    triangles: manifest.triangles,
  };
  const licenseURL =
    manifest.license === "CC0-1.0"
      ? "https://creativecommons.org/publicdomain/zero/1.0/"
      : `https://creativecommons.org/licenses/${manifest.license === "CC-BY-4.0" ? "by" : "by-sa"}/4.0/`;
  const readme = `Lumen Streets landmark contribution\n\nModel: ${data.name}\nCreator: ${data.creator}\nLicense: ${data.license}\n${licenseURL}\n\nFiles\n- model.glb: submitted model\n- landmark.json: placement, dimensions, license and SHA-256\n- preview.png: model in the current city view\n\nSubmit\nOpen https://github.com/Gway0521/lumen-streets/issues/new?template=landmark.md\nAttach this ZIP and describe the building and your reference sources.\nOnly submit work you have the right to license. Publication follows review.\n\nReview\nCheck the GLB digest, geometry budget, origin, height, orientation and license.\nThe model uses metres, a centred ground origin and a Y-up coordinate system.\nCheck placement against its neighbours before adding it to the landmark catalog.\n\nPreview map data © OpenStreetMap contributors, ODbL.\nhttps://www.openstreetmap.org/copyright\n`;
  return storedZip([
    { name: "model.glb", bytes: new Uint8Array(buffer) },
    {
      name: "landmark.json",
      bytes: encoder.encode(JSON.stringify(data, null, 2) + "\n"),
    },
    { name: "README.txt", bytes: encoder.encode(readme) },
    { name: "preview.png", bytes: new Uint8Array(await preview.arrayBuffer()) },
  ]);
}
