import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve('.');
async function markdown(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await markdown(file));
    else if (entry.name.endsWith('.md')) files.push(file);
  }
  return files;
}
const files = ['README.md', 'README.zh-TW.md', 'CONTRIBUTING.md', 'ATTRIBUTION.md', ...await markdown('docs')];
let links = 0;
for (const file of files) {
  const text = (await readFile(file, 'utf8')).replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  const targets = [
    ...text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),
    ...text.matchAll(/(?:src|href)="([^"]+)"/g),
  ];
  for (const [, raw] of targets) {
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(raw)) continue;
    const name = decodeURIComponent(raw.split(/[?#]/)[0]);
    const target = resolve(dirname(file), name);
    assert(target.startsWith(root + sep), `Documentation path escapes repository: ${file}: ${raw}`);
    assert((await stat(target)).isFile(), `Missing documentation target: ${file}: ${raw}`);
    links++;
  }
}
console.log(`Documentation: ${files.length} files, ${links} local links checked.`);
