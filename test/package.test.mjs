import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('start:https keeps 8443 as a default without overriding PORT from the caller', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const script = packageJson.scripts['start:https'];

  assert.match(script, /PHOTO_FRAME_HTTPS=1/);
  assert.match(script, /PORT=\$\{PORT:-8443\}/);
  assert.doesNotMatch(script, /PORT=8443\b/);
});

test('certs script generates local certificate files', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.scripts.certs, 'node scripts/generate-local-certs.mjs');
});
