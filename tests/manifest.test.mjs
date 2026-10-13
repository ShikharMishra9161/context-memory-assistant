// Guards Chrome Web Store readiness: every referenced file exists and the
// install-time permissions stay minimal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const exists = p => existsSync(new URL(p, root));

test('manifest references only files that exist', () => {
  const files = [
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(cs => cs.js),
    'lib/settings.js',
  ];
  for (const f of files) assert.ok(exists(f), `missing ${f}`);
});

test('icons are real PNGs in all required sizes', () => {
  for (const size of ['16', '32', '48', '128']) {
    const buf = readFileSync(new URL(manifest.icons[size], root));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    assert.equal(buf.readUInt32BE(16), Number(size), `icon-${size} width`);
  }
});

test('install-time permissions are minimal; backend and AI providers are optional', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'clipboardWrite', 'scripting', 'sidePanel', 'storage', 'unlimitedStorage']);
  assert.ok(!manifest.permissions.includes('tabs'), 'tabs permission not needed');
  for (const h of manifest.host_permissions) {
    assert.match(h, /^https:\/\/(chatgpt\.com|chat\.openai\.com|gemini\.google\.com|claude\.ai)\/\*$/, `unexpected host permission ${h}`);
  }
  assert.ok(manifest.optional_host_permissions.includes('http://localhost/*'));
  assert.equal(manifest.side_panel.default_path, 'dist-popup/index.html');
  assert.ok(manifest.description.length <= 132, 'Web Store description limit');
});
