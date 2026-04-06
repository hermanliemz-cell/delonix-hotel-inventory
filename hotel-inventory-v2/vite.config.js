import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plugin: auto-sync public/version.json from package.json on build
function versionJsonPlugin() {
  return {
    name: 'version-json',
    buildStart() {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
      const versionFile = path.resolve(__dirname, 'public', 'version.json');
      fs.mkdirSync(path.dirname(versionFile), { recursive: true });
      fs.writeFileSync(versionFile, JSON.stringify({ version: 'v' + pkg.version }));
    },
  };
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify('v' + pkg.version),
  },
  server: {
    port: 4001,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          export: ['jspdf', 'jspdf-autotable', 'xlsx'],
        },
      },
    },
  },
});
