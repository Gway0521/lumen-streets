import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version), 'Invalid release version');
assert.equal(lock.version, pkg.version, 'Lockfile version differs');
assert.equal(lock.packages[''].version, pkg.version, 'Root package version differs');
await readFile(`docs/releases/v${pkg.version}.md`);

// Verify that the packaged server and source belong to this version.
for (const [archive, member] of [
  ['artifacts/lumen-streets.tar.gz', 'lumen-streets/package.json'],
  ['dist/lumen-streets-source.tar.gz', 'lumen-streets/package.json'],
]) {
  const result = spawnSync('tar', ['-xOzf', archive, member], { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).version, pkg.version, 'Archive version differs; rebuild first');
}

const out = join('artifacts', 'releases', `v${pkg.version}`);
await mkdir(out, { recursive: true });
for (const [kind, source] of [
  ['site', 'artifacts/lumen-streets.tar.gz'],
  ['source', 'dist/lumen-streets-source.tar.gz'],
]) {
  const name = `lumen-streets-v${pkg.version}-${kind}.tar.gz`;
  const target = join(out, name);
  await cp(source, target);
  const bytes = await readFile(target);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(target + '.sha256', `${hash}  ${name}\n`);
  console.log(`${target} (${bytes.length} bytes)\nSHA-256: ${hash}`);
}
