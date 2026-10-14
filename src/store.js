// -----------------------------------------------------------------------------
// Small JSON files under /data, the only writable volume of the container.
//
// Written to a temporary file then renamed, so a container stopped mid-write
// never leaves half a file behind; readable by the container user only (the
// session file holds the Emporia tokens).
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? '/data';

/**
 * @param {string} dir
 * @param {string} name file name, e.g. "session.json"
 */
export function createJsonFile(dir, name) {
  const path = join(dir, name);
  return {
    path,

    /** The stored object, or `fallback` when absent or unreadable. */
    async read(fallback = null) {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return fallback;
      }
    },

    /** @param {unknown} value */
    async write(value) {
      await mkdir(dir, { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
      await rename(tmp, path);
    },
  };
}
