import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'
import pkg from './package.json'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    https: {},
  },
  optimizeDeps: {
    // wa-sqlite ships pre-built ESM — prevent esbuild from re-bundling it
    exclude: ['wa-sqlite'],
  },
  worker: {
    // Worker must be an ES module so it can use import statements
    format: 'es',
  },
  plugins: [basicSsl(), react(), tailwindcss(), VitePWA({
    // M-76: 'prompt' + registro manual via `virtual:pwa-register/react` (UpdateToast.tsx) —
    // com 'autoUpdate' o SW novo assumia sozinho (skipWaiting+clientsClaim) sem nenhum aviso,
    // e uma aba aberta há muito tempo podia ficar rodando JS antigo contra chunks que o SW novo
    // já não tinha mais precacheados. 'prompt' só ativa o SW novo quando o usuário confirma.
    registerType: 'prompt',
    injectRegister: null,
    // SEC-15: a fonte precisa entrar no precache. Antes disso o app offline não tinha Inter
    // nenhuma — vinha do Google (inalcançável offline) e `.woff2` não está no globPatterns
    // default do plugin, então nada era precacheado e a tipografia caía para system-ui.
    includeAssets: ['favicon.ico', 'favicon.svg', 'icons/*.png', 'fonts/inter-latin-var.woff2'],
    manifest: {
      name: 'Gimbo — Finanças Pessoais',
      short_name: 'Gimbo',
      description: 'Gestão de finanças pessoais, 100% local e privada.',
      theme_color: '#2D6A4F',
      background_color: '#F4F5F0',
      display: 'standalone',
      orientation: 'portrait',
      icons: [
        { src: 'icons/icon-64.png', sizes: '64x64', type: 'image/png' },
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
  }), cloudflare()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})