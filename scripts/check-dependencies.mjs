import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(resolve(dir, e.name)) : resolve(dir, e.name))))
    .flat().filter(p => /\.[jt]s$/.test(p) && !p.endsWith(".d.ts"));
}
const files = await walk(resolve("src")), known = new Set(files), graph = new Map();
for (const file of files) {
  const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
  const edges = [];
  const add = (node) => {
    if (!node || !ts.isStringLiteral(node) || !node.text.startsWith(".")) return;
    const target = resolve(dirname(file), node.text.split("?")[0]);
    if (known.has(target)) edges.push(target);
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source); graph.set(file, edges);
}
const done = new Set(), active = new Set(), stack = [];
function visit(file) {
  if (active.has(file)) throw Error(`Circular dependency: ${[...stack.slice(stack.indexOf(file)), file].map(f => relative(process.cwd(), f)).join(" → ")}`);
  if (done.has(file)) return;
  active.add(file); stack.push(file);
  for (const target of graph.get(file)) visit(target);
  stack.pop(); active.delete(file); done.add(file);
}
for (const file of files) visit(file);
console.log(`Dependencies: ${files.length} modules, no cycles.`);
