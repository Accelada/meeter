import {cp, mkdir, readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {manifest} from '../server/manifest.mjs';
import '../server/env.mjs';
import {writeFile} from 'node:fs/promises';
import {openApi} from '../server/openapi.mjs';
const root = new URL('../', import.meta.url);
for (const folder of ['src', 'server', 'scripts']) {
  for (const file of await readdir(new URL(`${folder}/`, root))) {
    if (/\.(mjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`${folder}/${file}`, root))], {stdio:'inherit'});
  }
}
await mkdir(new URL('dist/', root), {recursive:true});
for (const path of ['taskpane.html', 'portal.html', 'commands.html', 'manifest.xml', 'src', 'assets', 'data']) {
  await cp(new URL(path, root), new URL(`dist/${path}`, root), {recursive:true});
}
await build({entryPoints:[fileURLToPath(new URL('src/on-send.js',root))],outfile:fileURLToPath(new URL('dist/src/on-send.bundle.js',root)),bundle:true,format:'iife',target:'es2017'});
await build({entryPoints:[fileURLToPath(new URL('src/identity.js',root))],outfile:fileURLToPath(new URL('dist/src/identity.bundle.js',root)),bundle:true,format:'esm',target:'es2020'});
await writeFile(new URL('dist/manifest.xml',root),await manifest(process.env.PUBLIC_BASE_URL || 'https://localhost:3000'));
console.log('Build OK: módulos verificados y recursos públicos generados en dist/.');
await writeFile(new URL('docs/openapi-companies.json',root),JSON.stringify(await openApi(true),null,2)+'\n');
