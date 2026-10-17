import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const root = import.meta.dirname;
const certDir = path.join(root, 'certs');

/** Lädt die mkcert-Zertifikate für HTTPS im WLAN (siehe scripts/lan-cert.ps1). */
function loadLanCerts() {
  const cert = path.join(certDir, 'dev.pem');
  const key = path.join(certDir, 'dev-key.pem');
  if (!fs.existsSync(cert) || !fs.existsSync(key)) {
    throw new Error('Keine Zertifikate in certs/. Bitte zuerst scripts/lan-cert.ps1 ausführen.');
  }
  return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
}

/**
 * Liefert im LAN-Modus die mkcert-Root-CA unter /__feder/rootCA.pem aus,
 * damit sie sich auf dem iPad direkt in Safari als Profil laden lässt.
 * Es wird nur das öffentliche Zertifikat ausgeliefert, nie der Schlüssel.
 */
function rootCaPlugin(): Plugin {
  const handler = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    if (req.url !== '/__feder/rootCA.pem') return next();
    const file = path.join(certDir, 'rootCA.pem');
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end('rootCA.pem fehlt – scripts/lan-cert.ps1 ausführen.');
      return;
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="feder-dev-rootCA.pem"');
    res.end(fs.readFileSync(file));
  };
  return {
    name: 'feder-root-ca',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  const https = lan ? loadLanCerts() : undefined;
  const isTest = !!process.env.VITEST;

  return {
    base: process.env.FEDER_BASE ?? '/',
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
    plugins: [
      svelte(),
      !isTest &&
        VitePWA({
          registerType: 'prompt',
          injectRegister: false,
          includeAssets: ['icons/*.png', 'icons/*.svg'],
          manifest: {
            name: 'Feder',
            short_name: 'Feder',
            description: 'Handschriftliche Notizen und PDF-Annotation – vollständig offline.',
            lang: 'de',
            display: 'standalone',
            orientation: 'any',
            background_color: '#e8ecf1',
            theme_color: '#e8ecf1',
            icons: [
              { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
              {
                src: 'icons/icon-maskable-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
              },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest,woff2,wasm,bcmap,pfb,ttf,icc}'],
            navigateFallback: 'index.html',
            cleanupOutdatedCaches: true,
            maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          },
        }),
      lan && rootCaPlugin(),
    ],
    server: { host: lan, https, port: 5173 },
    preview: { host: lan, https, port: 4173 },
    build: { target: 'safari16', sourcemap: true },
    worker: { format: 'es' },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.ts'],
      setupFiles: ['tests/unit/setup.ts'],
    },
  };
});
