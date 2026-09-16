import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Use the working files that produced the build, without repository history or local state.
const roots = ['.editorconfig', '.env.example', '.gitattributes', '.gitignore', '.nvmrc',
  'ATTRIBUTION.md', 'CONTRIBUTING.md', 'LICENSE', 'NOTICE', 'README.md', 'README.zh-TW.md',
  'index.html', 'player.html', 'three.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.js'];
const directories = ['src', 'server', 'public', 'data', 'scripts', 'tests', 'docs', 'deploy', '.github'];
async function collect(dir) {
  if (!(await lstat(dir)).isDirectory()) throw Error(`Not a source directory: ${dir}`);
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || /^(AGENTS\.md|node_modules|dist|artifacts|coverage|__pycache__)$/i.test(entry.name) || /\.(log|pem|key)$/i.test(entry.name))
      continue;
    const file = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Source archive cannot contain symlinks: ${file}`);
    if (entry.isDirectory()) files.push(...await collect(file));
    else if (entry.isFile()) files.push(file);
    else throw Error(`Unsupported source archive input: ${file}`);
  }
  return files;
}
const files = [...roots];
for (const dir of directories) files.push(...await collect(dir));
if (!Buffer.from(await readFile('LICENSE')).equals(await readFile('public/license.txt')))
  throw Error('public/license.txt must match LICENSE');
const staging = await mkdtemp(join(tmpdir(), 'lumen-source-'));
try {
  const bundle = join(staging, 'lumen-streets');
  for (const file of files) {
    if (!(await lstat(file)).isFile()) throw Error(`Not a regular source file: ${file}`);
    await mkdir(dirname(join(bundle, file)), { recursive: true });
    await cp(file, join(bundle, file));
  }
  await mkdir('dist', { recursive: true });
  const ownership = process.platform === 'linux'
    ? ['--owner=0', '--group=0', '--numeric-owner']
    : ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root'];
  const result = spawnSync('tar', ['-czf', resolve('dist/lumen-streets-source.tar.gz'),
    ...ownership, '-C', staging, 'lumen-streets'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr);
  console.log(`Source archive: ${files.length} files, including build and deployment instructions.`);
} finally {
  if (dirname(resolve(staging)) !== resolve(tmpdir()) || !basename(staging).startsWith('lumen-source-'))
    throw Error('Unexpected source staging directory');
  await rm(staging, { recursive: true, force: true });
}
