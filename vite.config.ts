import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works from any sub-path (GitHub Pages serves it under the repository name).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', assetsDir: '', chunkSizeWarningLimit: 1200 },
})
