import { randomBytes } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const HOST = '::';
const DEFAULT_PORT = 8080;
const PHOTO_EXTENSIONS = new Set(['.avif', '.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp']);
const EXTENSION_BY_MIME = new Map([
  ['image/avif', '.avif'],
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp'],
]);
const STATIC_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);
const PHOTO_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);
const MAX_FORM_BYTES = 16 * 1024;
const DEFAULT_TLS_CERT_PATH = path.join('certs', 'photo-frame-cert.pem');
const DEFAULT_TLS_KEY_PATH = path.join('certs', 'photo-frame-key.pem');

export function createPhotoServer({ rootDir = process.cwd(), fetchImpl = fetch } = {}) {
  return createHttpServer(createPhotoRequestHandler({ rootDir, fetchImpl }));
}

export function createSecurePhotoServer({
  rootDir = process.cwd(),
  fetchImpl = fetch,
  certPath = process.env.PHOTO_FRAME_TLS_CERT || DEFAULT_TLS_CERT_PATH,
  keyPath = process.env.PHOTO_FRAME_TLS_KEY || DEFAULT_TLS_KEY_PATH,
} = {}) {
  const tlsOptions = {
    cert: readFileSync(resolveRootPath(rootDir, certPath)),
    key: readFileSync(resolveRootPath(rootDir, keyPath)),
  };

  return createHttpsServer(tlsOptions, createPhotoRequestHandler({ rootDir, fetchImpl }));
}

function createPhotoRequestHandler({ rootDir, fetchImpl }) {
  const publicDir = path.join(rootDir, 'public');
  const photoDir = path.join(rootDir, 'photos');

  return async (request, response) => {
    try {
      await mkdir(photoDir, { recursive: true });
      const url = new URL(request.url ?? '/', 'http://photo-frame.local');

      if (request.method === 'GET' && url.pathname === '/') {
        await sendFile(response, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
        return;
      }

      if (request.method === 'GET' && url.pathname === '/add') {
        await sendFile(response, path.join(publicDir, 'add.html'), 'text/html; charset=utf-8');
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/photos') {
        const photos = await listPhotos(photoDir);
        sendJson(response, { photos });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/photos') {
        await handleImport(request, response, photoDir, fetchImpl);
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/photos/')) {
        await handlePhotoRequest(response, photoDir, url.pathname);
        return;
      }

      if (request.method === 'GET') {
        await handleStaticRequest(response, publicDir, url.pathname);
        return;
      }

      response.writeHead(405, { Allow: 'GET, POST' }).end('Method not allowed');
    } catch (error) {
      console.error(error);
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal server error');
    }
  };
}

function resolveRootPath(rootDir, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
}

export async function listPhotos(photoDir) {
  await mkdir(photoDir, { recursive: true });
  const entries = await readdir(photoDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && PHOTO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, url: `/photos/${encodeURIComponent(id)}` }));
}

async function handleImport(request, response, photoDir, fetchImpl) {
  let tempPath;

  try {
    const body = await readRequestBody(request, MAX_FORM_BYTES);
    const form = new URLSearchParams(body);
    const sourceUrl = parseImportUrl(form.get('url'));
    const imported = await importPhoto(sourceUrl, photoDir, fetchImpl);

    response.writeHead(303, { Location: `/?photo=${encodeURIComponent(imported.id)}` }).end();
  } catch (error) {
    if (error?.tempPath) {
      tempPath = error.tempPath;
    }

    if (tempPath) {
      await rm(tempPath, { force: true });
    }

    const code = error?.code === 'invalid-url' || error?.code === 'unsupported-image' ? error.code : 'import-failed';
    response.writeHead(303, { Location: `/add?error=${code}` }).end();
  }
}

async function importPhoto(sourceUrl, photoDir, fetchImpl) {
  await mkdir(photoDir, { recursive: true });

  const response = await fetchImpl(sourceUrl);
  if (!response.ok || !response.body) {
    throw importError('import-failed');
  }

  const contentType = normalizeContentType(response.headers.get('content-type'));
  const extension = extensionForResponse(contentType, sourceUrl);
  if (!extension) {
    throw importError('unsupported-image');
  }

  const id = `${randomBytes(16).toString('hex')}${extension}`;
  const tempPath = path.join(photoDir, `.${id}.tmp`);
  const finalPath = path.join(photoDir, id);

  try {
    await writeBodyToFile(response.body, tempPath);
    await rename(tempPath, finalPath);
  } catch (error) {
    error.tempPath = tempPath;
    throw error;
  }

  return { id };
}

function parseImportUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl ?? '');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw importError('invalid-url');
    }
    return parsed.toString();
  } catch {
    throw importError('invalid-url');
  }
}

function extensionForResponse(contentType, sourceUrl) {
  if (contentType && EXTENSION_BY_MIME.has(contentType)) {
    return EXTENSION_BY_MIME.get(contentType);
  }

  if (contentType && contentType !== 'application/octet-stream' && contentType !== 'binary/octet-stream') {
    return undefined;
  }

  const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  return PHOTO_EXTENSIONS.has(extension) ? extension : undefined;
}

function normalizeContentType(contentType) {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase();
}

async function writeBodyToFile(body, filePath) {
  const file = await open(filePath, 'w');
  try {
    for await (const chunk of body) {
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
}

async function handlePhotoRequest(response, photoDir, pathname) {
  const encodedId = pathname.slice('/photos/'.length);
  const id = safePhotoId(encodedId);
  if (!id) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  const filePath = path.join(photoDir, id);
  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  await sendFile(response, filePath, PHOTO_TYPES.get(path.extname(id).toLowerCase()) ?? 'application/octet-stream');
}

async function handleStaticRequest(response, publicDir, pathname) {
  const filePath = safeStaticPath(publicDir, pathname);
  if (!filePath) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  await sendFile(response, filePath, STATIC_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream');
}

function safePhotoId(encodedId) {
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return undefined;
  }

  if (!id || id !== path.basename(id) || id.startsWith('.') || !PHOTO_EXTENSIONS.has(path.extname(id).toLowerCase())) {
    return undefined;
  }

  return id;
}

function safeStaticPath(publicDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const relativePath = decoded.replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0')) {
    return undefined;
  }

  const filePath = path.resolve(publicDir, relativePath);
  const publicRoot = path.resolve(publicDir);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    return undefined;
  }

  return filePath;
}

function sendJson(response, value) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function sendFile(response, filePath, contentType) {
  response.writeHead(200, { 'Content-Type': contentType });
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(response);
  });
}

async function readRequestBody(request, limit) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) {
      throw importError('invalid-url');
    }
  }

  return body;
}

function importError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function localAccessUrls(port, protocol = 'http') {
  const urls = [`${protocol}://localhost:${port}`];

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`${protocol}://${address.address}:${port}`);
      }
    }
  }

  return urls;
}

export function startServer({
  rootDir = process.cwd(),
  port = Number(process.env.PORT) || DEFAULT_PORT,
  log = console.log,
  secure = process.env.PHOTO_FRAME_HTTPS === '1',
  certPath = process.env.PHOTO_FRAME_TLS_CERT,
  keyPath = process.env.PHOTO_FRAME_TLS_KEY,
} = {}) {
  const server = secure
    ? createSecurePhotoServer({ rootDir, certPath, keyPath })
    : createPhotoServer({ rootDir });

  server.listen(port, HOST, () => {
    const actualPort = server.address().port;
    const protocol = secure ? 'https' : 'http';
    log(`Photo Frame is running on port ${actualPort}`);
    for (const url of localAccessUrls(actualPort, protocol)) {
      log(`  ${url}`);
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('server.mjs')) {
  startServer();
}
