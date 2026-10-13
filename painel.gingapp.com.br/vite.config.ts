import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";

// SPA estática: `vite build` gera dist/ servível por nginx (sem SSR). PWA (mesma lib/versão do app): precache do
// shell + assets, atualização por AVISO (registerType "prompt") e NUNCA cache de /api.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "generateSW",
      filename: "sw.js",
      // "prompt": o novo service worker espera; o painel mostra "Nova versão disponível — Atualizar".
      registerType: "prompt",
      injectRegister: null,
      devOptions: { enabled: false },
      manifest: {
        name: "GingApp — Painel de gestão",
        short_name: "GingApp",
        description: "Painel de gestão do grupo de capoeira: alunos, chamada, financeiro e mais.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        lang: "pt-BR",
        theme_color: "#164d38",
        background_color: "#f7f9f7",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Chamada", short_name: "Chamada", url: "/frequencia", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
          { name: "Alunos", short_name: "Alunos", url: "/alunos", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
          { name: "Financeiro", short_name: "Financeiro", url: "/financeiro", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
        ],
      },
      workbox: {
        // Só shell e assets estáticos entram no precache.
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,woff2,woff}"],
        // Navegações caem no shell (SPA); a API (/api/) fica de fora.
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
