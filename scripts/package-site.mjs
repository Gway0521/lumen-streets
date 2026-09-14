import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import './check-release.mjs';

// Explicit inputs keep credentials and working notes out of the deployment archive.
const out = resolve('artifacts');
await mkdir(out, { recursive: true });
const staging = await mkdtemp(join(out, 'site-'));
try {
  const bundle = join(staging, 'lumen-streets');
  await mkdir(bundle);
  await cp('dist', join(bundle, 'dist'), { recursive: true });
  await mkdir(join(bundle, 'deploy'));
  for (const file of ['lumen-streets.service', 'server.env.example']) {
    await cp(join('deploy', file), join(bundle, 'deploy', file));
  }
  await mkdir(join(bundle, 'server'));
  for (const file of ['config.mjs', 'guard.mjs', 'maps.mjs', 'site.mjs', 'start.mjs']) {
    await cp(join('server', file), join(bundle, 'server', file));
  }
  await mkdir(join(bundle, 'src/search'), { recursive: true });
  for (const file of ['area.js', 'validate.js']) await cp(join('src/search', file), join(bundle, 'src/search', file));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  await writeFile(join(bundle, 'package.json'), JSON.stringify({
    name: pkg.name, version: pkg.version, private: true, type: 'module', license: pkg.license,
    engines: pkg.engines, scripts: { start: pkg.scripts.start },
  }, null, 2) + '\n');
  await cp('.env.example', join(bundle, '.env.example'));
  await cp('docs/HOSTING.md', join(bundle, 'HOSTING.md'));
  await cp('docs/HOSTING.zh-TW.md', join(bundle, 'HOSTING.zh-TW.md'));
  const providerGuide = (await readFile('docs/PROVIDERS.md', 'utf8'))
    .replaceAll('(BUILDINGS.md)', `(https://github.com/Gway0521/lumen-streets/blob/v${pkg.version}/docs/BUILDINGS.md)`)
    .replaceAll('(../ATTRIBUTION.md)', `(https://github.com/Gway0521/lumen-streets/blob/v${pkg.version}/ATTRIBUTION.md)`);
  await writeFile(join(bundle, 'PROVIDERS.md'), providerGuide);
  await cp('LICENSE', join(bundle, 'LICENSE'));
  await cp('NOTICE', join(bundle, 'NOTICE'));
  // Resolve the packaged backend's imports before producing a release archive.
  await import(pathToFileURL(join(bundle, 'server/site.mjs')).href);
  await import(pathToFileURL(join(bundle, 'server/config.mjs')).href);
  const name = 'lumen-streets.tar.gz';
  const archive = join(out, name);
  const ownership = process.platform === 'linux'
    ? ['--owner=0', '--group=0', '--numeric-owner']
    : ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root'];
  const result = spawnSync('tar', ['-czf', archive, ...ownership, '-C', staging, 'lumen-streets'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr);
  const bytes = await readFile(archive);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(archive + '.sha256', `${hash}  ${name}\n`);
  console.log(`${archive} (${(bytes.length / 1048576).toFixed(1)} MiB)\nSHA-256: ${hash}`);
} finally {
  if (dirname(resolve(staging)) !== out || !basename(staging).startsWith('site-'))
    throw Error('Unexpected site staging directory');
  await rm(staging, { recursive: true, force: true });
}
