import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CERT_NAMES = {
  caConfig: 'photo-frame-ca.cnf',
  caKey: 'photo-frame-ca-key.pem',
  caCert: 'photo-frame-ca.pem',
  serverConfig: 'photo-frame-server.cnf',
  serverExt: 'photo-frame-server.ext',
  serverKey: 'photo-frame-key.pem',
  serverCsr: 'photo-frame.csr',
  serverCert: 'photo-frame-cert.pem',
};

export async function generateLocalCerts({
  certDir = path.join(process.cwd(), 'certs'),
  lanIp = process.env.LAN_IP,
  openssl = process.env.OPENSSL || 'openssl',
} = {}) {
  if (!isIP(lanIp)) {
    throw new Error('Set LAN_IP to the iPhone-reachable IP only, for example: LAN_IP=192.168.1.164 npm run certs');
  }

  await mkdir(certDir, { recursive: true });

  const files = Object.fromEntries(
    Object.entries(CERT_NAMES).map(([key, fileName]) => [key, path.join(certDir, fileName)]),
  );

  await writeFile(files.caConfig, caConfig());
  await writeFile(files.serverConfig, serverConfig(lanIp));
  await writeFile(files.serverExt, serverExtensions(lanIp));

  await execFileAsync(openssl, ['genrsa', '-out', files.caKey, '2048']);
  await execFileAsync(openssl, [
    'req',
    '-x509',
    '-new',
    '-nodes',
    '-key',
    files.caKey,
    '-sha256',
    '-days',
    '3650',
    '-out',
    files.caCert,
    '-config',
    files.caConfig,
    '-extensions',
    'ca_ext',
  ]);

  await execFileAsync(openssl, ['genrsa', '-out', files.serverKey, '2048']);
  await execFileAsync(openssl, [
    'req',
    '-new',
    '-key',
    files.serverKey,
    '-out',
    files.serverCsr,
    '-config',
    files.serverConfig,
  ]);
  await execFileAsync(openssl, [
    'x509',
    '-req',
    '-in',
    files.serverCsr,
    '-CA',
    files.caCert,
    '-CAkey',
    files.caKey,
    '-CAcreateserial',
    '-out',
    files.serverCert,
    '-days',
    '397',
    '-sha256',
    '-extfile',
    files.serverExt,
    '-extensions',
    'server_ext',
  ]);

  return {
    caCert: files.caCert,
    serverCert: files.serverCert,
    serverKey: files.serverKey,
  };
}

function caConfig() {
  return `[req]
distinguished_name = dn
prompt = no

[dn]
CN = Photo Frame Local CA

[ca_ext]
basicConstraints = critical,CA:true
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`;
}

function serverConfig(lanIp) {
  return `[req]
distinguished_name = dn
prompt = no
req_extensions = server_req

[dn]
CN = ${lanIp}

[server_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ${lanIp}
`;
}

function serverExtensions(lanIp) {
  return `[server_ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ${lanIp}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await generateLocalCerts();
    console.log(`Created CA certificate: ${result.caCert}`);
    console.log(`Created server certificate: ${result.serverCert}`);
    console.log(`Created server key: ${result.serverKey}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
