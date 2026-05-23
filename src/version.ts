import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // After bundling, this file lives in dist/; in dev (tsx) it lives in src/.
  // package.json sits one directory above either location.
  const pkgPath = resolve(here, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  if (!pkg.version) {
    throw new Error(`Missing "version" in ${pkgPath}`);
  }
  return pkg.version;
}

export const VERSION = readVersion();
