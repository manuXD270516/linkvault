import { Socket } from 'node:net';
import {
  CHILD_CODE_PATTERN,
  encodeFrame,
  type ChildMessage,
} from '../child-protocol';
import { CV_MAX_RAW_TEXT_CHARS } from '../extraction-limits';
import type { ChildExtraction } from './extraction-result';

// Script del proceso hijo de lectura (D1 y D6 de cv-extract-isolation). **No importa nada del worker**: ni
// `@nestjs/*`, ni `pino`, ni la configuración (H6, D12). Sus bibliotecas se cargan con `import()` de literal dentro de
// un `try`, para poder publicar `boot_error` si no cargan.
//
// Protocolo: `ready` (o `boot_error`) → recibe los bytes por `stdin` → publica `text` o `failed` en el descriptor 3 →
// **espera**: lo mata el padre cuando tiene la línea completa, así una salida nunca trunca un resultado a medio escribir.
// Lo que escribiera en `stdout`/`stderr` no llega a ningún sitio (el padre los descarta).

const channel = new Socket({ fd: 3, readable: false });

function send(message: ChildMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    // Se espera al callback: en un pipe no bloqueante una escritura grande no puede darse por hecha antes.
    channel.write(encodeFrame(message), (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/** Del error de arranque solo sale un código que cumpla el patrón; nunca su mensaje. */
function bootCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string' && CHILD_CODE_PATTERN.test(code)) {
      return code;
    }
  }
  return 'BOOT_ERROR';
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function hold(): void {
  // El padre mata al hijo; mientras tanto, nada que salga por su cuenta.
  setInterval(() => undefined, 60_000);
}

async function main(): Promise<void> {
  const format = process.argv[2];
  let extract: (bytes: Uint8Array) => Promise<ChildExtraction>;
  try {
    if (format === 'pdf') {
      const loaded = await import('./pdf-extract');
      extract = (bytes) => loaded.extractPdf(bytes);
    } else if (format === 'docx') {
      const loaded = await import('./docx-extract');
      extract = loaded.extractDocx;
    } else {
      throw new Error('unknown format');
    }
  } catch (error) {
    await send({ type: 'boot_error', code: bootCodeOf(error) });
    hold();
    return;
  }

  await send({ type: 'ready' });
  const bytes = await readStdin();
  const result = await extract(bytes);
  if (result.kind === 'text') {
    await send({
      type: 'text',
      // Se corta **antes** de serializar: el peor caso (6 bytes por unidad escapada) cabe en el marco de 8 MiB (D6).
      text: result.text.slice(0, CV_MAX_RAW_TEXT_CHARS),
      pagesCapped: result.pagesCapped,
      rawCapped: result.rawCapped,
    });
  } else {
    await send({ type: 'failed', cause: result.cause });
  }
  hold();
}

main().catch(() => {
  process.exit(2);
});
