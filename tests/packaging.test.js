import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('site packaging removes staging files after success and import failure', async () => {
  const work = await mkdtemp(join(tmpdir(), 'lumen-package-test-'));
  try {
    for (const dir of ['scripts', 'dist', 'server', 'src/search', 'deploy', 'docs'])
      await mkdir(join(work, dir), { recursive: true });
    // Distribution validation has its own command; isolate the packaging lifecycle here.
    await writeFile(join(work, 'scripts/check-release.mjs'), '');
    await cp('scripts/package-site.mjs', join(work, 'scripts/package-site.mjs'));
    for (const dir of ['server', 'deploy']) await cp(dir, join(work, dir), { recursive: true });
    for (const name of ['area.js', 'validate.js']) await cp(`src/search/${name}`, join(work, 'src/search', name));
    for (const name of ['HOSTING.md', 'HOSTING.zh-TW.md', 'PROVIDERS.md']) await cp(`docs/${name}`, join(work, 'docs', name));
    for (const name of ['package.json', '.env.example', 'LICENSE', 'NOTICE']) await cp(name, join(work, name));
    await writeFile(join(work, 'dist/index.html'), '<!doctype html><title>Package fixture</title>');
    const run = () => spawnSync(process.execPath, ['scripts/package-site.mjs'], { cwd: work, encoding: 'utf8' });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const archive = join(work, 'artifacts/lumen-streets.tar.gz');
    const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
    assert.equal(await readFile(archive + '.sha256', 'utf8'), `${hash}  lumen-streets.tar.gz\n`);
    const members = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    assert.equal(members.status, 0, members.stderr);
    assert(members.stdout.includes('lumen-streets/server/start.mjs'));
    assert(!members.stdout.includes('node_modules'));
    assert(!(await readdir(join(work, 'artifacts'))).some(name => name.startsWith('site-')));

    // A missing transitive server import fails after staging has been allocated.
    await writeFile(join(work, 'server/site.mjs'), "import './missing.mjs';\n");
    const failure = run();
    assert.notEqual(failure.status, 0);
    assert(failure.stderr.includes('missing.mjs'));
    assert(!(await readdir(join(work, 'artifacts'))).some(name => name.startsWith('site-')));
  } finally {
    assert.equal(dirname(resolve(work)), resolve(tmpdir()));
    assert(basename(work).startsWith('lumen-package-test-'));
    await rm(work, { recursive: true, force: true });
  }
});
