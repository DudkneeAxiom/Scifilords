// Static file server for development, tests, and just playing the game.
// Node-only on purpose: Node is already required for Playwright, while python3
// is absent on plenty of machines (stock Windows among them).
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = Number(process.env.PORT) || 8124;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    let st = statSync(p, { throwIfNoEntry: false });
    if (st && st.isDirectory()) { p = join(p, 'index.html'); st = statSync(p, { throwIfNoEntry: false }); }
    if (!st) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(p).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(p).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Another copy is already serving — that's fine, point the player there.
    console.log(`KETTLE REACH is already running on http://localhost:${PORT}`);
    process.exit(0);
  }
  throw e;
}).listen(PORT, () => console.log(`KETTLE REACH on http://localhost:${PORT}`));
