import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMongoTestUri } from '@linkvault/testing';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCvTestApp,
  type CvTestApp,
} from '../../../test-support/cv-test-app';
import { IS_PUBLIC_KEY } from '../../../presentation/http/auth-context/public.decorator';
import { DeleteCv } from '../application/delete-cv.usecase';
import { GetCvTextPreview } from '../application/get-cv-text-preview.usecase';
import { ListMyCvs } from '../application/list-my-cvs.usecase';
import { CV_CLOCK } from '../application/ports/clock.port';
import { CV_FILE_STORE } from '../application/ports/cv-file-store.port';
import { CV_LIMITER } from '../application/ports/cv-limiter.port';
import { CV_REPOSITORY } from '../application/ports/cv-repository.port';
import { SetDefaultCv } from '../application/set-default-cv.usecase';
import { UploadCv } from '../application/upload-cv.usecase';
import { CounterCvLimiter } from '../infrastructure/counter-cv-limiter';
import { MongoCvRepository } from '../infrastructure/mongo-cv.repository';
import { CvController } from './cv.controller';

// Cableado del módulo `cv` (tarea 6.10): cada puerto con su adaptador, ninguna ruta pública y ningún import de IA.

let http: CvTestApp;

beforeAll(async () => {
  http = await createCvTestApp('cv-module', getMongoTestUri());
}, 60_000);

afterAll(async () => {
  await http.close();
});

describe('CvModule wiring', () => {
  it.each([
    ['CV_REPOSITORY', CV_REPOSITORY, MongoCvRepository],
    ['CV_LIMITER', CV_LIMITER, CounterCvLimiter],
  ] as const)('resolves %s with its adapter', (_name, token, adapter) => {
    expect(http.app.get(token, { strict: false })).toBeInstanceOf(adapter);
  });

  it('resolves the clock and the object store', () => {
    expect(http.app.get(CV_CLOCK, { strict: false })).toBeDefined();
    // En esta app el almacén está sustituido por su doble: lo que se comprueba es que el token existe y se resuelve.
    expect(http.app.get(CV_FILE_STORE, { strict: false })).toBeDefined();
  });

  it.each([UploadCv, ListMyCvs, SetDefaultCv, DeleteCv, GetCvTextPreview])(
    'resolves the use case %p',
    (useCase) => {
      expect(http.app.get(useCase, { strict: false })).toBeInstanceOf(useCase);
    },
  );

  it('Nada de CV en lo público: no route of the controller is marked public', () => {
    const reflector = http.app.get(Reflector, { strict: false });
    const handlers = Object.getOwnPropertyNames(CvController.prototype).filter(
      (name) => name !== 'constructor',
    );

    expect(handlers.length).toBeGreaterThan(0);
    for (const name of handlers) {
      const handler = (
        CvController.prototype as unknown as Record<string, () => unknown>
      )[name];
      expect(
        reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, CvController]),
      ).not.toBe(true);
    }
  });
});

describe('the cv module and AI', () => {
  it('La extracción no usa inteligencia artificial: no file imports @linkvault/ai', () => {
    // Un `import` o un `require` de verdad; nombrarlo en un comentario para decir que **no** entra es lo contrario.
    const importsAi = /(?:^|\n)\s*(?:import|export)[^\n;]*from\s*['"]@linkvault\/ai['"]|require\(\s*['"]@linkvault\/ai['"]/;
    const offenders = filesUnder(join(import.meta.dirname, '..')).filter(
      (file) => importsAi.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

describe('the cv module and match', () => {
  it('no file imports the match module (dependency is match → cv)', () => {
    const importsMatch =
      /(?:^|\n)\s*(?:import|export)[^\n;]*from\s*['"][^'"]*modules\/match[^'"]*['"]|require\(\s*['"][^'"]*modules\/match[^'"]*['"]/;
    const offenders = filesUnder(join(import.meta.dirname, '..')).filter(
      (file) => importsMatch.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(path));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}
