/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
