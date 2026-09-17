import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // New service worker versions take over as soon as they're done
      // installing, rather than waiting for every open tab to be closed -
      // simplest option for a two-person household app, at the cost of a
      // tab occasionally needing one extra reload to pick up a change.
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32x32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Splitkhata',
        short_name: 'Splitkhata',
        description: 'A shared household + travel expense ledger.',
        theme_color: '#3D7068',
        background_color: '#F6EFDD',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell (JS/CSS/HTML/icons) is precached here -
        // Firestore's own SDK already handles offline reads/writes and
        // background sync via its IndexedDB persistence layer, so Firebase
        // requests are deliberately left alone rather than double-cached
        // through the service worker too. The one addition is the Google
        // Fonts stylesheet + font files, cached CacheFirst since they're
        // effectively immutable and otherwise silently fall back to system
        // fonts offline.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  build: {
    rollupOptions: {
      output: {
        // Firebase changes far less often than app code - keep it in its own
        // chunk so a deploy doesn't force re-downloading it. recharts is
        // already split out automatically via the lazy() imports in App.jsx.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
});

