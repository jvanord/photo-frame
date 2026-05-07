import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { generateLocalCerts } from '../scripts/generate-local-certs.mjs';

const execFileAsync = promisify(execFile);

async function certText(filePath) {
  const { stdout } = await execFileAsync('openssl', ['x509', '-in', filePath, '-noout', '-text']);
  return stdout;
}

test('generateLocalCerts creates iOS-compatible CA and server certificate extensions', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'photo-frame-certs-'));

  try {
    const certDir = path.join(rootDir, 'certs');
    await generateLocalCerts({ certDir, lanIp: '192.168.1.164' });

    const ca = await certText(path.join(certDir, 'photo-frame-ca.pem'));
    assert.match(ca, /CA:TRUE/);
    assert.match(ca, /Certificate Sign/);

    const server = await certText(path.join(certDir, 'photo-frame-cert.pem'));
    assert.match(server, /CA:FALSE/);
    assert.match(server, /TLS Web Server Authentication/);
    assert.match(server, /DNS:localhost/);
    assert.match(server, /IP Address:127\.0\.0\.1/);
    assert.match(server, /IP Address:192\.168\.1\.164/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
