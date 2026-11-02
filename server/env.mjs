import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Existing process variables take precedence; local overrides the base file.
for (const name of ['.env.local', '.env']) {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
export function verifiedConnectionString(value) {
  const url = new URL(value);
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.delete('uselibpqcompat');
  return url.toString();
}
