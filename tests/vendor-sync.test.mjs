import test from 'node:test';
import assert from 'node:assert/strict';
import { filesDiffer } from '../scripts/sync-core.mjs';

test('backend vendored handoff-core matches shared/handoff-core', () => {
  const diffs = filesDiffer();
  assert.deepEqual(diffs, [], `Out of sync: ${diffs.join(', ')}. Run "npm run sync-core" from the repo root.`);
});
