import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /sb mirrors the Netlify proxy in netlify.toml so the fallback route in
// src/lib/supabase.js also works under `npm run dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/sb': { target: 'https://zjyriyogntcyevlpitpe.supabase.co', changeOrigin: true, secure: true, rewrite: p => p.replace(/^\/sb/, '') },
    },
  },
})
