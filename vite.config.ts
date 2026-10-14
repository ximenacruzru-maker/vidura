import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works from any sub-path (GitHub Pages serves it under the repository name).
// The published build is minified with no source maps and no comments, so the browser only ever gets compact,
// renamed code — not the readable source. (Anything a browser runs can still be downloaded; what keeps the agency's
// data and business rules safe is that they live in the database's row-level security and the server functions.)
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', assetsDir: '', chunkSizeWarningLimit: 1200, sourcemap: false, minify: true },
})
