import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { get as httpsGet } from 'node:https';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateLocalCerts } from '../scripts/generate-local-certs.mjs';
import { createPhotoServer, localAccessUrls, startServer } from '../server.mjs';

async function makeWorkspace() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'photo-frame-'));
  await mkdir(path.join(rootDir, 'public'), { recursive: true });
  await writeFile(path.join(rootDir, 'public', 'index.html'), '<!doctype html><title>viewer</title>');
  await writeFile(path.join(rootDir, 'public', 'add.html'), '<!doctype html><title>add</title>');
  return rootDir;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function withImageSource({ contentType = 'image/jpeg', body = Buffer.from([0xff, 0xd8, 0xff]), pathName = '/photo.jpg' } = {}) {
  const server = createHttpServer((request, response) => {
    if (request.url !== pathName) {
      response.writeHead(404).end('missing');
      return;
    }

    response.writeHead(200, { 'Content-Type': contentType });
    response.end(body);
  });

  const running = await listen(server);
  return {
    url: `${running.baseUrl}${pathName}`,
    close: running.close,
  };
}

test('GET /favicon.svg serves the favicon as an SVG image', async () => {
  const rootDir = await makeWorkspace();
  try {
    await writeFile(path.join(rootDir, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const app = await listen(createPhotoServer({ rootDir }));
    try {
      const response = await fetch(`${app.baseUrl}/favicon.svg`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/svg+xml');
      assert.match(await response.text(), /<svg/);
    } finally {
      await app.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

async function httpsStatus(url) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, { rejectUnauthorized: false }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });

    request.on('error', reject);
  });
}

test('GET /api/photos lists only app-local web image files', async () => {
  const rootDir = await makeWorkspace();
  try {
    await mkdir(path.join(rootDir, 'photos'), { recursive: true });
    await writeFile(path.join(rootDir, 'photos', 'b.webp'), 'webp');
    await writeFile(path.join(rootDir, 'photos', 'a.jpg'), 'jpg');
    await writeFile(path.join(rootDir, 'photos', 'note.txt'), 'not an image');
    await writeFile(path.join(rootDir, 'photos', '.hidden.png'), 'hidden');

    const app = await listen(createPhotoServer({ rootDir }));
    try {
      const response = await fetch(`${app.baseUrl}/api/photos`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        photos: [
          { id: 'a.jpg', url: '/photos/a.jpg' },
          { id: 'b.webp', url: '/photos/b.webp' },
        ],
      });
    } finally {
      await app.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('GET /photos rejects path traversal attempts', async () => {
  const rootDir = await makeWorkspace();
  try {
    await writeFile(path.join(rootDir, 'secret.jpg'), 'secret');

    const app = await listen(createPhotoServer({ rootDir }));
    try {
      const response = await fetch(`${app.baseUrl}/photos/%2e%2e%2fsecret.jpg`);
      assert.equal(response.status, 404);
      assert.notEqual(await response.text(), 'secret');
    } finally {
      await app.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('POST /api/photos stores an imported image and redirects to the new photo', async () => {
  const rootDir = await makeWorkspace();
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const source = await withImageSource({ contentType: 'image/png', body: imageBytes, pathName: '/source.png' });

  try {
    const app = await listen(createPhotoServer({ rootDir }));
    try {
      const form = new URLSearchParams({ url: source.url });
      const response = await fetch(`${app.baseUrl}/api/photos`, {
        method: 'POST',
        body: form,
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      assert.equal(response.status, 303);
      const location = response.headers.get('location');
      assert.match(location, /^\/\?photo=[a-f0-9]{32}\.png$/);

      const files = await readdir(path.join(rootDir, 'photos'));
      assert.equal(files.length, 1);
      assert.match(files[0], /^[a-f0-9]{32}\.png$/);
      assert.deepEqual(await readFile(path.join(rootDir, 'photos', files[0])), imageBytes);
      assert.equal(files[0].includes('source'), false);
    } finally {
      await app.close();
    }
  } finally {
    await source.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('POST /api/photos rejects non-image responses and removes partial files', async () => {
  const rootDir = await makeWorkspace();
  const source = await withImageSource({ contentType: 'text/plain', body: Buffer.from('not image'), pathName: '/not-image' });

  try {
    const app = await listen(createPhotoServer({ rootDir }));
    try {
      const response = await fetch(`${app.baseUrl}/api/photos`, {
        method: 'POST',
        body: new URLSearchParams({ url: source.url }),
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/add?error=unsupported-image');
      assert.deepEqual(await readdir(path.join(rootDir, 'photos')), []);
    } finally {
      await app.close();
    }
  } finally {
    await source.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('POST /api/photos rejects non-http URLs before fetching', async () => {
  const rootDir = await makeWorkspace();
  try {
    const app = await listen(createPhotoServer({ rootDir }));
    try {
      const response = await fetch(`${app.baseUrl}/api/photos`, {
        method: 'POST',
        body: new URLSearchParams({ url: 'file:///tmp/photo.jpg' }),
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/add?error=invalid-url');
      assert.deepEqual(await readdir(path.join(rootDir, 'photos')), []);
    } finally {
      await app.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('startServer accepts IPv4 and IPv6 localhost connections', async () => {
  const rootDir = await makeWorkspace();
  const server = startServer({ rootDir, port: 0, log: () => {} });

  try {
    await once(server, 'listening');
    const { port } = server.address();

    const ipv4 = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(ipv4.status, 200);
    await ipv4.text();

    const ipv6 = await fetch(`http://[::1]:${port}/`);
    assert.equal(ipv6.status, 200);
    await ipv6.text();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('localAccessUrls uses the requested URL scheme', () => {
  const urls = localAccessUrls(8443, 'https');

  assert.equal(urls[0], 'https://localhost:8443');
  assert.ok(urls.every((url) => url.startsWith('https://')));
});

test('startServer can serve the app over HTTPS with local certificate files', async () => {
  const rootDir = await makeWorkspace();
  try {
    const certDir = path.join(rootDir, 'certs');
    await generateLocalCerts({ certDir, lanIp: '127.0.0.1' });

    const server = startServer({
      rootDir,
      port: 0,
      secure: true,
      log: () => {},
    });

    try {
      await once(server, 'listening');
      const { port } = server.address();

      assert.equal(await httpsStatus(`https://localhost:${port}/add`), 200);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
