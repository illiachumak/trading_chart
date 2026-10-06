/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Short HEAD hash for bench environment metadata; 'unknown' outside a git checkout. */
function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: { __BUILD_HASH__: JSON.stringify(gitShortHash()) },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // `vite build --mode profiling` keeps <Profiler> timings in the production bundle.
      ...(mode === 'profiling' ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] : []),
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}))
