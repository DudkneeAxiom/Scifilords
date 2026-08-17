import { defineConfig } from '@playwright/test';

// The port is settable so a run can be pointed at a snapshot of the tree on a
// port of its own.
//
// The suite serves src/ straight off disk, so editing a file while a run is in
// flight invalidates the whole run — which in practice meant stopping work for
// ten minutes every time anything needed checking, and one run thrown away when
// that discipline slipped. tools/snaptest.mjs copies the tree and runs against
// the copy, so the live tree stays editable.
const PORT = Number(process.env.KR_PORT) || 8124;

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    // The game renders with WebGL; a headless run has no GPU, so ask for the
    // software rasteriser rather than silently falling back to no context.
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    // process.execPath, not "node".
    //
    // Node is a portable install on this machine and is not on PATH, so the
    // literal `node` here could never spawn. It went unnoticed for a long time
    // because a dev server is usually already listening on 8124 and
    // reuseExistingServer quietly skipped the spawn entirely — the suite only
    // ran because something else had started the server first.
    command: `"${process.execPath}" tools/serve.mjs`,
    port: PORT,
    reuseExistingServer: true,
    // serve.mjs reads PORT; the runner speaks KR_PORT.
    env: { PORT: String(PORT) },
  },
});
