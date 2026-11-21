import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// When the API lives on another origin (VITE_API_URL, e.g. Railway), open the
// connection while the JS is still downloading. Same-origin builds add nothing.
function apiPreconnect(apiUrl: string | undefined): Plugin {
  return {
    name: 'qivo-api-preconnect',
    transformIndexHtml() {
      if (!apiUrl) return
      let origin: string
      try {
        origin = new URL(apiUrl).origin
      } catch {
        return
      }
      return [
        { tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head-prepend' },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), apiPreconnect(env.VITE_API_URL)],
    server: {
      port: 5173,
    },
    build: {
      target: 'es2020',
    },
  }
})
