import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8124',
    viewport: { width: 1280, height: 800 },
    // The game renders with WebGL; a headless run has no GPU, so ask for the
    // software rasteriser rather than silently falling back to no context.
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'node tools/serve.mjs',
    port: 8124,
    reuseExistingServer: true,
  },
});
