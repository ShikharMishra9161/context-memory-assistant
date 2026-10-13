// Copies shared/handoff-core into backend/src/vendor/handoff-core so the
// backend deploys on its own (e.g. Render with root directory "backend").
// Run after editing shared/handoff-core: npm run sync-core
import { cpSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../shared/handoff-core/', import.meta.url));
const dest = fileURLToPath(new URL('../backend/src/vendor/handoff-core/', import.meta.url));

export function filesDiffer() {
  const list = dir => readdirSync(dir).filter(f => f.endsWith('.js') || f === 'package.json').sort();
  let destFiles;
  try { destFiles = list(dest); } catch { return ['(vendor copy missing)']; }
  const srcFiles = list(src);
  const diffs = srcFiles.filter(f => !destFiles.includes(f) || readFileSync(src + f, 'utf8') !== readFileSync(dest + f, 'utf8'));
  return diffs.concat(destFiles.filter(f => !srcFiles.includes(f)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Synced shared/handoff-core → backend/src/vendor/handoff-core`);
}
