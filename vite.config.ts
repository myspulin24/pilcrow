import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const host = process.env.TAURI_DEV_HOST
const port = Number(process.env.PILCROW_DEV_PORT ?? 5273)

/**
 * Verze knihoven, na kterých stojí rozhraní.
 *
 * Čtou se z toho, co je opravdu nainstalované v `node_modules`, ne z rozsahů
 * v `package.json`: `^18.3.1` není verze, je to příslib. Sekce „O aplikaci“
 * má říct, co v té binárce doopravdy je.
 */
function frontendVersions(): Record<string, string> {
  const names = ['react', 'typescript', 'vite', 'katex', '@tauri-apps/api']
  const versions: Record<string, string> = {}
  for (const name of names) {
    try {
      const manifest = fileURLToPath(new URL(`./node_modules/${name}/package.json`, import.meta.url))
      versions[name] = JSON.parse(readFileSync(manifest, 'utf8')).version
    } catch {
      // Chybějící balíček není důvod, aby sestavení spadlo; v okně se pak
      // u té řádky ukáže pomlčka.
      versions[name] = ''
    }
  }
  versions.node = process.versions.node
  return versions
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Vloží se při sestavení; za běhu už `node_modules` nikdo nemá.
    __FRONTEND_VERSIONS__: JSON.stringify(frontendVersions()),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Tauri expects a fixed port and fails if it is not available.
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: port + 1 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_', 'PILCROW_'],
  build: {
    target: 'es2021',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
  },
})
