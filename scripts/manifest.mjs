import '../server/env.mjs';
import {manifest} from '../server/manifest.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.argv[2] || process.env.PUBLIC_BASE_URL;
if(!origin)throw new Error('Indica el origen HTTPS: npm run manifest -- https://coste.tu-dominio.com');
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
await writeFile(new URL('../dist/manifest.xml',import.meta.url),await manifest(origin));
console.log('Manifiesto generado en dist/manifest.xml');
