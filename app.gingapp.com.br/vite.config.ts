import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'GingApp',
        short_name: 'GingApp',
        description: 'PWA do Capoeirista — acompanhe sua jornada, aulas e comunidade.',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // Tema claro do app (PLANO_PROJETO.md §10.19) — mesmas cores usadas no
        // Tailwind (src/style.css @theme: --color-bg / --color-accent).
        background_color: '#f4f5f7',
        theme_color: '#f4f5f7',
        lang: 'pt-BR',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Rota sensível (financeiro): nunca serve o app-shell do cache para
        // essa navegação — força ida à rede, mesmo offline-first no resto do
        // app (PLANO_PROJETO.md §6: "dados sensíveis sempre online").
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/app\/financeiro/],
        runtimeCaching: [
          {
            // Endpoints financeiros: nunca cacheados.
            urlPattern: /\/api\/finance(\/|$)/,
            handler: 'NetworkOnly',
          },
          {
            // Demais chamadas de API: tenta rede, cai para cache curto se offline.
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gingapp-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5, // 5 minutos
              },
              networkTimeoutSeconds: 5,
            },
          },
          {
            // Imagens (fotos de rodas/eventos etc.): cache leve, revalida em segundo plano.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'gingapp-images-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 dias
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 4173,
  },
})
