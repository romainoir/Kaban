import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use the GitHub Pages base path only in production so that the dev server
// continues to run at "/" and doesn't 404 when fetching local JSON/assets.
const base = process.env.NODE_ENV === 'production' ? '/Kaban/' : '/'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base,
})

