import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const assetsDir = path.join(distDir, 'assets');
const needle = 'compile(code){this.native;';
const replacement = 'compile(code){const native=this.native;';
const textExtensions = new Set(['.js', '.html', '.json', '.webmanifest']);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(target);
    else yield target;
  }
}

let patched = 0;
for (const file of await readdir(assetsDir)) {
  if (!file.startsWith('worker-') || !file.endsWith('.js')) continue;
  const target = path.join(assetsDir, file);
  const source = await readFile(target, 'utf8');
  if (!source.includes(needle)) continue;

  await writeFile(target, source.replaceAll(needle, replacement));

  // Renombrar para romper el caché inmutable del bundle original.
  const newName = file.replace(/^worker-/, 'worker-patched-');
  await rename(target, path.join(assetsDir, newName));

  // Actualizar la referencia en todo el dist (bundles, index.html y el precache del SW).
  for await (const other of walk(distDir)) {
    if (!textExtensions.has(path.extname(other))) continue;
    const content = await readFile(other, 'utf8');
    if (!content.includes(file)) continue;
    await writeFile(other, content.replaceAll(file, newName));
  }

  console.log(`[patch-protodef] ${file} -> ${newName}`);
  patched++;
}

if (patched === 0) {
  console.warn('[patch-protodef] No se encontró el patrón esperado; revisa protodef/prismarine-nbt.');
}
