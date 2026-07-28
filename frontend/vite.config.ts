import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * `/arc-rpc` → Arc's public JSON-RPC, proxied by the dev server.
 *
 * Why proxy at all, given that rpc.testnet.arc.io *does* answer preflights
 * with a correct `Access-Control-Allow-Origin` on the happy path: it sits
 * behind Cloudflare (`server: cloudflare`, `__cf_bm`), and Cloudflare's own
 * rate-limit / bot-management responses are generated at the edge without
 * the origin's CORS headers. So the moment Arc throttles you ,which it
 * does readily, it will return "request limit reached" under load ,the
 * browser sees a header-less response and reports a CORS failure instead of
 * the 429 underneath. That is the console noise this removes.
 *
 * Proxying sidesteps it entirely: CORS is a browser policy on cross-origin
 * responses, and the app now only ever calls its own origin. It also makes
 * the true status codes observable (see `configure` below).
 *
 * `rewrite` is required: without it a request for `/arc-rpc` would be
 * forwarded to `https://rpc.testnet.arc.io/arc-rpc`. The RPC lives at the
 * root, so the prefix is stripped back to `/`.
 *
 * Keep the path in step with ARC_RPC_PROXY_PATH in src/main.tsx.
 *
 * NOTE: this block is read once at dev-server boot. Editing it does NOT
 * hot-reload ,stop and re-run `npm run dev`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/arc-rpc': {
        target: 'https://rpc.testnet.arc.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/arc-rpc/, '') || '/',
        // Surface upstream throttling in the terminal. Once proxied, a 429
        // reaches the browser as a plain 429 from localhost, so without this
        // the cause is easy to miss.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            const status = proxyRes.statusCode ?? 0
            if (status >= 400) console.warn(`[arc-rpc] upstream ${status} for ${req.method} ${req.url}`)
          })
          proxy.on('error', (err, req) => {
            console.warn(`[arc-rpc] proxy error for ${req.url}: ${err.message}`)
          })
        },
      },
    },
  },
})
