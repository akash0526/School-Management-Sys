import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser only ever calls relative /api/... URLs; Vite proxies them to the API.
// Same-origin means the httpOnly refresh cookie (path /api/v1/auth, SameSite=Strict) just works.
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:4000'

const server = {
  host: '0.0.0.0',
  port: 5173,
  strictPort: true,
  allowedHosts: ['.e2b.app', 'localhost'],
  proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server,
  preview: server,
})
