import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// End-to-end suite: drives the real React app through the DOM, backed by the
// in-memory vault adapter (no Rust / Tauri process required).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['e2e/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
