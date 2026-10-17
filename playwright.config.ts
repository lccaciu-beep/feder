import { defineConfig } from '@playwright/test';

// Smoke-Tests in WebKit (Safari-Engine) gegen den Produktions-Build.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    browserName: 'webkit',
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { FEDER_BASE: '/' },
  },
});
