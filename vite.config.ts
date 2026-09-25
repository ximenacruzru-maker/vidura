import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works from any sub-path (GitHub Pages serves it under /vid/).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', assetsDir: '', chunkSizeWarningLimit: 1200 },
})
