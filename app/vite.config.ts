import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

export default defineConfig({
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
  plugins: [
    basicSsl(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'Gimbo — Finanças Pessoais',
        short_name: 'Gimbo',
        description: 'Gestão de finanças pessoais, 100% local e privada.',
        theme_color: '#2D6A4F',
        background_color: '#F4F5F0',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
