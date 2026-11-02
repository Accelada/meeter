import {readFile} from 'node:fs/promises';
export async function manifest(baseUrl){
  const url=new URL(baseUrl);
  if(url.protocol!=='https:' || url.pathname!=='/' || url.search || url.hash || url.username || url.password)throw new Error('La URL del manifiesto debe ser un origen HTTPS.');
  const escaped=url.origin.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  return (await readFile(new URL('../manifest.xml',import.meta.url),'utf8')).replaceAll('https://localhost:3000',escaped);
}
