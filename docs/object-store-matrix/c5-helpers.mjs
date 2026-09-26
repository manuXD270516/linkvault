// Pasos de `c5.sh` que necesitan `node` (tarea 2.9 de `object-store`, design D2): leer el compose, comprobar el
// contenedor, derivar K2, pedir los objetos del modo C5 y clasificar lo leído. Uso interno de `c5.sh`; cada orden se
// describe en su función. Nunca imprime una clave ni los bytes de un objeto.
//
//   node c5-helpers.mjs compose <compose.yml> <resolved.json> <raw.json> <volumen> <server|sse-c>
//   C5_K1=… node c5-helpers.mjs k1 <resolved.json> <raw.json>          (imprime K1 y nada más)
//   C5_K1=… node c5-helpers.mjs container <inspect.json> <volumen docker> [<variable de la clave>]
//   C5_EXPECT=… node c5-helpers.mjs env-is <inspect.json> <variable de la clave>
//   C5_K1=… node c5-helpers.mjs k2
//   node c5-helpers.mjs get <dir> <A1|A2|B1|B2> [--sse-c-env <VARIABLE>]
//   node c5-helpers.mjs wait-ready <segundos>
//   node c5-helpers.mjs disk <plaintext.json>
//   node c5-helpers.mjs key <plaintext.json>
//   node c5-helpers.mjs log-key-error <log>
//   node c5-helpers.mjs sse-c-error <sse-c-error.json>
//
// Códigos: 0 lo esperado; 2 precondición o uso (c5.sh sale con 2); el resto, según la orden.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { parse as parseYaml } from 'yaml';
import { deriveOtherKey } from './c5-key.mjs';

const SERVICE = 'object-store';
const KEY_VARIABLE = 'OBJECT_STORE_SSE_KEY';
const KEY_REFERENCE = new RegExp(`\\$\\{?${KEY_VARIABLE}(?![A-Za-z0-9_])`);

function out(line) {
  process.stdout.write(`${line}\n`);
}

function usage(message) {
  process.stderr.write(`c5-helpers: ${message}\n`);
  process.exit(2);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Las entradas de `environment` del servicio cuyo valor sin interpolar referencia `OBJECT_STORE_SSE_KEY`. */
function keyEntries(resolved, raw) {
  const rawEnv = raw.services?.[SERVICE]?.environment ?? {};
  const resolvedEnv = resolved.services?.[SERVICE]?.environment ?? {};
  return Object.entries(rawEnv)
    .filter(([, value]) => typeof value === 'string' && KEY_REFERENCE.test(value))
    .map(([name]) => ({ name, value: resolvedEnv[name] ?? '' }));
}

/**
 * Comprueba que el `tar` de un solo volumen es todo el estado del servicio `object-store` y que la copia de (b) no
 * montará el original. Imprime `project=`, `volume=` y, en modo `server`, `keyvar=`; sale con 2 nombrando **cada**
 * causa encontrada.
 */
function compose([yamlFile, resolvedFile, rawFile, volumeKey, mode]) {
  if (volumeKey === undefined || (mode !== 'server' && mode !== 'sse-c')) {
    usage('compose <compose.yml> <resolved.json> <raw.json> <volume> <server|sse-c>');
  }
  const resolved = readJson(resolvedFile);
  const raw = readJson(rawFile);
  // El YAML crudo: `config --format json`, también con `--no-interpolate`, pone `name: <proyecto>_<clave>` en todo
  // volumen con nombre (medido en la 2.6), así que solo el fichero dice si el `name:` es explícito.
  const yaml = parseYaml(readFileSync(yamlFile, 'utf8')) ?? {};
  const causes = [];
  const service = resolved.services?.[SERVICE];
  if (service === undefined) {
    process.stderr.write(`c5: the compose has no service "${SERVICE}"\n`);
    process.exit(2);
  }

  const volumes = [];
  for (const mount of service.volumes ?? []) {
    if (mount.type === 'volume') {
      volumes.push(mount.source ?? '(anónimo)');
    } else if (mount.type === 'bind') {
      if (mount.read_only !== true) {
        causes.push(`writable bind mount ${mount.source} -> ${mount.target}`);
      }
    } else if (mount.type !== 'tmpfs') {
      causes.push(`mount of type ${mount.type} at ${mount.target}`);
    }
  }
  if (Array.isArray(service.volumes_from) && service.volumes_from.length > 0) {
    causes.push(`volumes_from: ${service.volumes_from.join(', ')}`);
  }
  if (volumes.length !== 1) {
    causes.push(`${volumes.length} volumes mounted (${volumes.join(', ') || 'none'}); exactly one is required`);
  } else if (volumes[0] !== volumeKey) {
    causes.push(`the service mounts volume "${volumes[0]}", not "${volumeKey}"`);
  }
  const declared = yaml.volumes?.[volumeKey];
  if (declared !== null && typeof declared === 'object') {
    if (Object.hasOwn(declared, 'name')) {
      causes.push(`volume "${volumeKey}" declares an explicit name: (the copy of test (b) would mount the original)`);
    }
    if (declared.external !== undefined && declared.external !== false) {
      causes.push(`volume "${volumeKey}" is external (the copy of test (b) would mount the original)`);
    }
  }
  if (typeof service.container_name === 'string') {
    causes.push(`container_name "${service.container_name}" is fixed (the copy of test (b) cannot coexist)`);
  }

  let keyVar;
  if (mode === 'server') {
    const entries = keyEntries(resolved, raw);
    if (entries.length !== 1) {
      causes.push(
        `${entries.length} environment entries of "${SERVICE}" reference ${KEY_VARIABLE}` +
          (entries.length > 0 ? ` (${entries.map((e) => e.name).join(', ')})` : '') +
          '; exactly one is required',
      );
    } else if (entries[0].value === '' || entries[0].value === null) {
      causes.push(`the key entry ${entries[0].name} resolves empty (K1)`);
    } else {
      keyVar = entries[0].name;
    }
  }

  const volumeName = resolved.volumes?.[volumeKey]?.name;
  if (volumeName === undefined && volumes.length === 1) {
    causes.push(`volume "${volumeKey}" is not declared at the top level`);
  }
  if (causes.length > 0) {
    for (const cause of causes) {
      process.stderr.write(`c5: refused: ${cause}\n`);
    }
    process.exit(2);
  }
  out(`project=${resolved.name}`);
  out(`volume=${volumeName}`);
  if (keyVar !== undefined) {
    out(`keyvar=${keyVar}`);
  }
}

/** K1: el valor resuelto de la única entrada que referencia `OBJECT_STORE_SSE_KEY` (ya comprobada por `compose`). */
function k1([resolvedFile, rawFile]) {
  const entries = keyEntries(readJson(resolvedFile), readJson(rawFile));
  if (entries.length !== 1 || !entries[0].value) {
    usage('K1 not found (run `compose` first)');
  }
  process.stdout.write(entries[0].value);
}

/**
 * El contenedor en marcha: un solo volumen (el del compose) y ningún bind escribible —lo que el compose no dice, como
 * un `VOLUME` de la imagen, también cuenta— y, en modo `server`, arrancado con K1.
 */
function container([inspectFile, volumeName, keyVar]) {
  const [info] = readJson(inspectFile);
  const causes = [];
  if (info?.State?.Running !== true) {
    causes.push('the object-store container is not running');
  }
  const volumes = [];
  for (const mount of info?.Mounts ?? []) {
    if (mount.Type === 'volume') {
      volumes.push(mount.Name);
    } else if (mount.Type === 'bind') {
      if (mount.RW !== false) {
        causes.push(`writable bind mount ${mount.Source} -> ${mount.Destination} in the running container`);
      }
    } else if (mount.Type !== 'tmpfs') {
      causes.push(`mount of type ${mount.Type} at ${mount.Destination} in the running container`);
    }
  }
  if (volumes.length !== 1 || volumes[0] !== volumeName) {
    causes.push(`the running container mounts ${volumes.length} volumes (${volumes.join(', ') || 'none'}); only ${volumeName} is allowed`);
  }
  if (keyVar !== undefined && keyVar !== '') {
    const entry = (info?.Config?.Env ?? []).find((e) => e.startsWith(`${keyVar}=`));
    if (entry === undefined || entry.slice(keyVar.length + 1) !== process.env.C5_K1) {
      causes.push(`the running container was not started with the K1 of the compose (${keyVar} differs)`);
    }
  }
  if (causes.length > 0) {
    for (const cause of causes) {
      process.stderr.write(`c5: refused: ${cause}\n`);
    }
    process.exit(2);
  }
  out(`container ok: one volume (${volumeName}), no writable bind`);
}

/** El contenedor (creado, arrancado o no) lleva en la variable de la clave el valor de `C5_EXPECT`. 0 sí; 1 no. */
function envIs([inspectFile, keyVar]) {
  const [info] = readJson(inspectFile);
  const entry = (info?.Config?.Env ?? []).find((e) => e.startsWith(`${keyVar}=`));
  if (entry === undefined || entry.slice(keyVar.length + 1) !== process.env.C5_EXPECT) {
    out(`the container's ${keyVar} is not the expected key`);
    process.exitCode = 1;
    return;
  }
  out(`${keyVar} of the container: the expected key`);
}

function k2() {
  const k1Text = process.env.C5_K1 ?? '';
  if (k1Text === '') {
    usage('C5_K1 is empty');
  }
  try {
    process.stdout.write(deriveOtherKey(k1Text));
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
}

function s3Client() {
  const missing = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'].filter((n) => !process.env[n]);
  if (missing.length > 0) {
    usage(`missing ${missing.join(', ')}`);
  }
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  });
}

function describeError(error) {
  const status = error?.$metadata?.httpStatusCode;
  const code = typeof error?.Code === 'string' ? error.Code : error?.name ?? 'UnknownError';
  return { status, code };
}

/**
 * `GET` de un objeto del modo C5 y comparación por bytes con su fichero. Códigos: 0 igual por bytes; 10 rechazado sin
 * bytes (el almacén respondió con un error); 11 devolvió bytes distintos; 12 sin respuesta.
 */
async function get([dir, name, flag, sseCEnv]) {
  if (name === undefined || (flag !== undefined && (flag !== '--sse-c-env' || !sseCEnv))) {
    usage('get <dir> <A1|A2|B1|B2> [--sse-c-env <VARIABLE>]');
  }
  const manifest = readJson(join(dir, 'manifest.json'));
  const object = manifest.objects?.[name];
  if (object === undefined) {
    usage(`${name} is not in the manifest`);
  }
  const expected = readFileSync(join(dir, object.file));
  const input = { Bucket: object.bucket, Key: object.key };
  if (sseCEnv !== undefined) {
    const key = Buffer.from(process.env[sseCEnv] ?? '', 'base64');
    if (key.length !== 32) {
      usage(`${sseCEnv} is not base64 of 32 bytes`);
    }
    input.SSECustomerAlgorithm = 'AES256';
    input.SSECustomerKey = key.toString('base64');
  }
  const client = s3Client();
  const label = sseCEnv === undefined ? name : `${name} (SSE-C de ${sseCEnv})`;
  try {
    const response = await client.send(new GetObjectCommand(input));
    const bytes = Buffer.from((await response.Body?.transformToByteArray()) ?? new Uint8Array());
    if (bytes.equals(expected)) {
      out(`${label}: igual por bytes (${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 16)})`);
      process.exitCode = 0;
    } else {
      out(`${label}: devuelve ${bytes.length} bytes DISTINTOS de los escritos`);
      process.exitCode = 11;
    }
  } catch (error) {
    const { status, code } = describeError(error);
    if (status === undefined) {
      out(`${label}: sin respuesta (${code})`);
      process.exitCode = 12;
    } else {
      out(`${label}: rechazado sin bytes (HTTP ${status} ${code})`);
      process.exitCode = 10;
    }
  } finally {
    client.destroy();
  }
}

/** Espera a que el almacén responda a un `ListBuckets` firmado. 0 listo; 1 no respondió en el plazo. */
async function waitReady([seconds]) {
  const deadline = Date.now() + Number(seconds) * 1000;
  const started = Date.now();
  let last = 'no attempt';
  while (Date.now() < deadline) {
    const client = s3Client();
    try {
      await client.send(new ListBucketsCommand({}));
      out(`almacén listo en ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return;
    } catch (error) {
      const { status, code } = describeError(error);
      last = status === undefined ? code : `HTTP ${status} ${code}`;
    } finally {
      client.destroy();
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  out(`almacén no listo en ${seconds} s (último: ${last})`);
  process.exitCode = 1;
}

/** Lectura del disco (design D2, paso 4). 0 A1 y A2 0/3, B1 y B2 3/3; 1 texto en claro (falla); 3 no concluyente. */
function disk([file]) {
  const { buffers } = readJson(file);
  const plain = ['A1', 'A2'].filter((n) => buffers[n].found > 0);
  const missing = ['B1', 'B2'].filter((n) => buffers[n].found !== buffers[n].of);
  const summary = ['A1', 'A2', 'B1', 'B2'].map((n) => `${n} ${buffers[n].found}/${buffers[n].of}`).join(', ');
  if (missing.length > 0) {
    out(`disco: no concluyente: el control no aparece entero (${missing.join(', ')}); ${summary}`);
    process.exitCode = 3;
  } else if (plain.length > 0) {
    out(`disco: falla: texto en claro del CV en el volumen (${plain.join(', ')}); ${summary}`);
    process.exitCode = 1;
  } else {
    out(`disco: ok (${summary})`);
  }
}

/** Prueba (c): la clave no está en el volumen en ninguna de sus formas. 0 ausente; 1 encontrada. */
function key([file]) {
  const result = readJson(file).key;
  if (result === null) {
    usage('the key was not searched (C5_KEY_TEXT empty)');
  }
  const found = Object.entries(result).filter(([, hit]) => hit).map(([label]) => label);
  const total = Object.keys(result).length;
  if (found.length > 0) {
    out(`(c) falla: la clave está en el volumen (${found.join('; ')}; ${found.length}/${total} formas)`);
    process.exitCode = 1;
  } else {
    out(`(c) ok: la clave, 0/${total} formas en el volumen (${Object.keys(result).join('; ')})`);
  }
}

/** Líneas del log que nombran un error de clave o de descifrado. 0 hay alguna (se imprimen); 1 ninguna. */
function logKeyError([file]) {
  const error = /(error|fatal|fail|unable|invalid|mismatch|panic|cannot|denied)/i;
  const keyish = /(kms|key|decrypt|encrypt|cipher|seal|unseal|authenticat)/i;
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => error.test(line) && keyish.test(line));
  if (lines.length === 0) {
    out('log: ninguna línea nombra un error de clave o de descifrado');
    process.exitCode = 1;
    return;
  }
  for (const line of lines.slice(0, 5)) {
    out(`log: ${line.trim().slice(0, 400)}`);
  }
}

/**
 * Rechazo del `PUT` SSE-C del modo SSE-C de la suite. 0 el servidor lo rechaza nombrando TLS o una conexión segura
 * (`falla: TLS del servidor`); 4 el SDK lo rechaza nombrándolo sin enviar; 1 otro rechazo.
 */
function sseCError([file]) {
  if (!existsSync(file)) {
    out('SSE-C: la suite falló sin rechazo del PUT registrado');
    process.exitCode = 1;
    return;
  }
  const error = readJson(file);
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  const tls = /\bTLS\b|\bSSL\b|HTTPS|secure connection|conexi[oó]n segura|insecure/i.test(text);
  const who = error.side === 'server' ? `el servidor (HTTP ${error.httpStatus} ${error.code})` : `el SDK, sin respuesta del servidor (${error.name})`;
  out(`SSE-C: rechazado por ${who}: ${String(error.message ?? '').slice(0, 300)}`);
  if (tls && error.side === 'server') {
    out('SSE-C: falla: TLS del servidor');
  } else if (tls) {
    out('SSE-C: falla (TLS): el SDK no envía SSE-C por http://');
    process.exitCode = 4;
  } else {
    process.exitCode = 1;
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  compose,
  k1,
  container,
  'env-is': envIs,
  k2,
  get,
  'wait-ready': waitReady,
  disk,
  key,
  'log-key-error': logKeyError,
  'sse-c-error': sseCError,
  'sse-c-key': () => process.stdout.write(randomBytes(32).toString('base64')),
};
const run = commands[command];
if (run === undefined) {
  usage(`unknown command ${command ?? '(none)'}`);
}
await run(rest);
