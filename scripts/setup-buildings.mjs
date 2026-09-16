import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

// One deployment setup, shared by every city and visitor. Never run pip from an
// HTTP request. Dependencies live in an isolated environment owned by the app.
const directory = resolve(".cache/building-venv");
const python =
  process.env.LUMEN_BUILDINGS_PYTHON ||
  resolve(
    directory,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const requirements = resolve("scripts/buildings/requirements.txt");
const marker = resolve(directory, "lumen-requirements.sha256");
const hash = createHash("sha256")
  .update(await readFile(requirements))
  .digest("hex");
function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw Error(`Building runtime setup failed: ${command}`);
}
try {
  try {
    await access(python);
  } catch {
    if (process.env.LUMEN_BUILDINGS_PYTHON)
      throw Error("LUMEN_BUILDINGS_PYTHON does not exist");
    await mkdir(directory, { recursive: true });
    console.log(
      "Preparing the shared building-height runtime (Python 3.12 required).",
    );
    if (process.platform === "win32")
      run("py", ["-3.12", "-m", "venv", directory]);
    else run("python3", ["-m", "venv", directory]);
  }
  let installed;
  try {
    installed = await readFile(marker, "utf8");
  } catch {}
  if (installed !== hash) {
    run(python, [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "-r",
      requirements,
    ]);
    await mkdir(directory, { recursive: true });
    await writeFile(marker, hash);
  }
  const check = spawnSync(
    python,
    ["-c", "import shapely, pyproj, rasterio, duckdb, defusedxml"],
    { windowsHide: true, encoding: "utf8" },
  );
  if (check.status !== 0) throw Error("Building runtime imports failed");
} catch (error) {
  console.error(
    error.message + " Install Python 3.12 and retry; see docs/HOSTING.md.",
  );
  process.exitCode = 1;
}
