import { defineConfig } from 'vite';
export default defineConfig({
  // Relative assets let the same build run on a domain or GitHub Pages subpath.
  base: './',
  build: {
    // The bundled WebGL engine is ~545 kB before gzip; keep a deliberate engine budget.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/build/') || id.includes('node_modules/three/src/'))
            return 'three-core';
          if (id.includes('node_modules/three/')) return 'three-effects';
        },
      },
    },
  },
});
