import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import tls from 'node:tls';
import { cvFileKey, type CvFileType } from '@linkvault/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractCvUseCase } from './application/extract-cv.usecase';
import {
  InMemoryCvFileReader,
  InMemoryCvRepository,
  MovableClock,
} from './application/testing/cv-test-doubles';
import { DocxTextExtractor } from './infrastructure/extractors/docx-text.extractor';
import {
  docxWithText,
  pdfWithText,
} from './infrastructure/extractors/fixtures/cv-fixtures';
import { PdfTextExtractor } from './infrastructure/extractors/pdf-text.extractor';

// "Ningún envío externo" (spec `cv/extraction`, "La extracción no usa inteligencia artificial"). El CV no sale de
// nuestra infraestructura, y aquí se comprueba de dos maneras que no se solapan:
//
// 1. **Vigilando el transporte**: se extrae un CV de verdad, con los extractores de producción, y toda salida de red de
//    Node queda interceptada. Las dos salidas legítimas —Mongo y el almacén de objetos— están puestas como dobles en
//    memoria, así que cualquier socket, petición HTTP o resolución de nombre que se abriera durante la extracción
//    sería una de más.
// 2. **Siguiendo los imports** desde el módulo, que es lo único que puede decir algo sobre un proveedor que ni siquiera
//    llega a llamarse. Es una comprobación estática y el nombre de su test lo dice.

const CV_ID = '66e9a0000000000000000c01';
const USER_ID = '66e9a0000000000000000a01';

/** Toda salida de red de Node, anotada y cortada antes de salir. */
let egress: string[];

beforeEach(() => {
  egress = [];
  const blocked = (name: string) => (): never => {
    egress.push(name);
    throw new Error(`the CV extraction reached the network through ${name}`);
  };
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(
    blocked('net.Socket.connect'),
  );
  vi.spyOn(net, 'createConnection').mockImplementation(
    blocked('net.createConnection'),
  );
  vi.spyOn(tls, 'connect').mockImplementation(blocked('tls.connect'));
  vi.spyOn(http, 'request').mockImplementation(blocked('http.request'));
  vi.spyOn(https, 'request').mockImplementation(blocked('https.request'));
  vi.spyOn(dns, 'lookup').mockImplementation(blocked('dns.lookup'));
  vi.spyOn(globalThis, 'fetch').mockImplementation(blocked('fetch'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function useCaseFor(
  fileType: CvFileType,
  bytes: Uint8Array,
): {
  readonly useCase: ExtractCvUseCase;
  readonly repository: InMemoryCvRepository;
} {
  const repository = new InMemoryCvRepository().withCv(CV_ID, {
    userId: USER_ID,
    fileType,
  });
  const files = new InMemoryCvFileReader().withObject(
    cvFileKey(USER_ID, CV_ID),
    bytes,
  );
  return {
    repository,
    useCase: new ExtractCvUseCase(
      repository,
      files,
      { pdf: new PdfTextExtractor(), docx: new DocxTextExtractor() },
      new MovableClock(),
      { timeoutMs: 30_000 },
      { upsert: async () => undefined, delete: async () => undefined },
    ),
  };
}

describe('the CV never leaves our infrastructure', () => {
  it.each([
    ['pdf' as const, pdfWithText()],
    ['docx' as const, docxWithText()],
  ])(
    'Ningún envío externo: extraer un %s no abre ninguna salida de red fuera de Mongo y MinIO',
    async (fileType, bytes) => {
      const { useCase, repository } = useCaseFor(fileType, bytes);

      const result = await useCase.execute({ cvId: CV_ID, userId: USER_ID });

      // La extracción ocurrió de verdad: si no, no habría nada que enviar y el test no diría nada.
      expect(result).toMatchObject({ kind: 'extracted' });
      expect(repository.texts.get(CV_ID)?.text).toContain('Nadia Quispe');
      expect(egress).toEqual([]);
    },
  );

  it('Ningún envío externo, comprobado solo sobre los imports: nada de lo que alcanza el módulo trae un proveedor de IA', () => {
    const reached = reachableFrom([
      join(import.meta.dirname, 'cv.module.ts'),
      join(import.meta.dirname, 'application', 'extract-cv.usecase.ts'),
    ]);

    // El recorrido llegó de verdad hasta la infraestructura; si no, no estaría mirando nada.
    for (const file of [
      'extract-cv.usecase.ts',
      'pdf-text.extractor.ts',
      'docx-text.extractor.ts',
      'mongo-cv.repository.ts',
      's3-cv-file.reader.ts',
    ]) {
      expect([...reached.files].some((path) => path.endsWith(file))).toBe(true);
    }
    // Ni un archivo de `libs/ai`, ni un paquete de ningún proveedor.
    expect(
      [...reached.files].filter((path) =>
        path.includes(`${sep}libs${sep}ai${sep}`),
      ),
    ).toEqual([]);
    expect([...reached.packages].filter(isAiPackage)).toEqual([]);
  });
});

/** Paquetes que hablan con un modelo: el nuestro y los SDK de los proveedores habituales. */
function isAiPackage(specifier: string): boolean {
  return [
    '@linkvault/ai',
    'openai',
    '@anthropic-ai/sdk',
    '@google/generative-ai',
    '@mistralai/mistralai',
    '@aws-sdk/client-bedrock-runtime',
    'cohere-ai',
    'ollama',
  ].some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..', '..');
const ALIASES: Readonly<Record<string, string>> = {
  '@linkvault/shared': join(ROOT, 'libs', 'shared', 'src', 'index.ts'),
  '@linkvault/ai': join(ROOT, 'libs', 'ai', 'src', 'index.ts'),
};

/** Cada `from '…'`, `import('…')` y `require('…')` de un archivo, sin distinguir tipos de valores. */
const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

interface Reached {
  /** Archivos del repositorio a los que se llega siguiendo los imports. */
  readonly files: Set<string>;
  /** Especificadores que no son archivos nuestros: los paquetes de los que depende lo alcanzado. */
  readonly packages: Set<string>;
}

/** Cierre transitivo de los imports desde unos archivos de partida. */
function reachableFrom(entries: readonly string[]): Reached {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || files.has(file)) {
      continue;
    }
    files.add(file);
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(
      SPECIFIER,
    )) {
      if (specifier === undefined || specifier.startsWith('node:')) {
        continue;
      }
      const resolved = specifier.startsWith('.')
        ? fileOf(join(dirname(file), specifier))
        : ALIASES[specifier];
      if (resolved === undefined) {
        packages.add(specifier);
      } else {
        pending.push(resolved);
      }
    }
  }
  return { files, packages };
}

/** El `.ts` de un import relativo, sin extensión o con carpeta e `index`. */
function fileOf(path: string): string | undefined {
  for (const candidate of [`${path}.ts`, join(path, 'index.ts'), path]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // El siguiente candidato; si no hay ninguno, no es un archivo nuestro.
    }
  }
  return undefined;
}
