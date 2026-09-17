import type { BuildRequest, WorkerResult, SceneRecipe } from "../../src/three/contracts.ts";
import { parseHeightTile } from "../../src/three/height-tiles.js";
import { validateScene } from "../../src/three/scene-recipe.js";

// These examples are type-checked, never executed.
export function rejectInvalidContracts(build: BuildRequest, reply: WorkerResult) {
  // @ts-expect-error Coordinates cannot be a city label.
  build.center = "Shanghai";
  // @ts-expect-error A build must carry its generation and data sources.
  const incomplete: BuildRequest = { type: "build", city: "shanghai" };
  // @ts-expect-error Successful geometry is unavailable before narrowing the result.
  reply.geometry.position;
  if (reply.error === undefined) reply.geometry.position.byteLength;
  const tile = parseHeightTile(new ArrayBuffer(0));
  // @ts-expect-error GERS identities remain strings across the wire.
  tile.features[0].id = 123;
  // @ts-expect-error Unknown height methods cannot be passed to the renderer.
  tile.features[0].properties.height_method = "guessed";
  const scene: SceneRecipe = validateScene({});
  // @ts-expect-error Only the supported recipe version can be emitted.
  scene.version = 2;
  // @ts-expect-error Saved traffic uses stable edge names, not graph indices.
  scene.traffic!.cars[0].edge = 17;
  return incomplete;
}
