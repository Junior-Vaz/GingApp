import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";

// SPA estática: `vite build` gera dist/ servível por nginx (sem SSR/Nitro).
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "generateSW",
      filename: "sw.js",
      registerType: "autoUpdate",
      injectRegister: null,
      devOptions: { enabled: false },
      manifest: {
        name: "GingApp — A plataforma que conecta a capoeira",
        short_name: "GingApp",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        lang: "pt-BR",
        theme_color: "#164d38",
        background_color: "#f7f9f7",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Só shell e assets estáticos entram no precache.
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,woff2,woff}"],
        // Web Push: handlers de `push`/`notificationclick` ficam em public/sw-push.js e entram no sw.js gerado por
        // importScripts (mantém o generateSW e o precache atuais). O arquivo não vai ao precache: o navegador já o
        // baixa e verifica mudanças como parte do próprio service worker.
        importScripts: ["sw-push.js"],
        globIgnores: ["sw-push.js"],
        // Navegações caem no shell (SPA) - exceto chamadas de API e QR públicos servidos pela API.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Sem runtimeCaching: respostas da API (/api/) NUNCA são cacheadas pelo service worker.
        runtimeCaching: [],
      },
    }),
  ],
  resolve: { tsconfigPaths: true },
  build: { outDir: "dist", sourcemap: false },
});
