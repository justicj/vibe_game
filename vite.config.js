import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Vite plugin that discovers all tile images in public/assets/tiles/
 * and exposes them as a virtual module '@tile-keys'.
 *
 * This ensures the code always matches the actual files on disk,
 * eliminating tile-count mismatches when tiles are added or removed.
 */
function tileDiscoveryPlugin() {
  return {
    name: 'tile-discovery',
    resolveId(source) {
      if (source === '@tile-keys') return '\0tile-keys';
    },
    load(id) {
      if (id === '\0tile-keys') {
        const tilesDir = path.resolve('public/assets/tiles');
        let tileKeys = ['dirt', 'grass'];

        try {
          const files = fs.readdirSync(tilesDir);
          const numberedTiles = [];
          for (const file of files) {
            if (file.endsWith('.png')) {
              const base = file.slice(0, -4); // strip .png
              if (base !== 'dirt' && base !== 'grass') {
                numberedTiles.push(base);
              }
            }
          }
          numberedTiles.sort();
          tileKeys = tileKeys.concat(numberedTiles);
        } catch {
          // Directory doesn't exist yet — fall back to named tiles only
        }

        return `export default ${JSON.stringify(tileKeys)};`;
      }
    },
  };
}

export default defineConfig({
  plugins: [tileDiscoveryPlugin()],
  // Default root is project root where index.html lives
  server: {
    open: true,
  },
  // Build output goes to ./dist (Vite default)
});
