// Run the acceptance suite against a frozen copy of the tree.
//
// The suite serves src/ straight off disk, so touching a source file while a
// run is in flight invalidates it. With a nine-minute suite that means either
// downing tools for ten minutes at a time or quietly throwing a run away — both
// of which happened before this existed.
//
// So: copy everything the game and the tests need into a temp directory, point
// a server at THAT on a port of its own, and run there. The live tree stays
// editable for as long as the run takes. node_modules is junctioned rather than
// copied, because it is enormous and nothing in a run writes to it.
//
//   node tools/snaptest.mjs                 whole suite
//   node tools/snaptest.mjs -g "cover"      just the matching tests
//
// Anything after the script name is passed through to Playwright.
import { cpSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Everything the page loads plus everything the runner needs. Deliberately a
// list rather than "copy all except": qa-* screenshot directories and
// test-results are large, regenerated, and would double the copy for nothing.
const NEEDED = [
  'src', 'tests', 'tools', 'vendor', 'assets',
  'index.html', 'style.css', 'playwright.config.js', 'package.json',
];

const snap = mkdtempSync(join(tmpdir(), 'kr-snap-'));
let code = 1;
try {
  for (const item of NEEDED) {
    const from = join(ROOT, item);
    if (!existsSync(from)) continue;
    cpSync(from, join(snap, item), { recursive: true });
  }
  // Junction, not a copy: node_modules is hundreds of megabytes and read-only
  // for the duration of a run.
  symlinkSync(join(ROOT, 'node_modules'), join(snap, 'node_modules'), 'junction');

  // A port of its own PER RUN, not per tool.
  //
  // A fixed 8231 was fine until two of these ran at once: reuseExistingServer
  // means the second attaches to the FIRST run's server, so it tests the first
  // run's snapshot rather than its own — and when the first finishes and takes
  // the server with it, the second collapses mid-flight. That looked exactly
  // like a catastrophic regression (thirty failures out of ninety-six) and was
  // entirely this line. Derived from the snapshot directory so concurrent runs
  // cannot land on the same number.
  const spread = [...snap].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 900, 7);
  const port = String(process.env.KR_PORT || (8300 + spread));
  const args = process.argv.slice(2);
  console.log(`snapshot: ${snap}`);
  console.log(`port:     ${port}\n`);

  const res = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test',
      '--reporter=line', ...args],
    { cwd: snap, stdio: 'inherit', env: { ...process.env, KR_PORT: port } },
  );
  code = res.status ?? 1;
} finally {
  // Best effort. A leftover temp directory is untidy; failing the run because
  // Windows still had a handle on it would be worse.
  try { rmSync(snap, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.exit(code);
