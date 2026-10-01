import { describe, expect, it } from 'vitest';
import { composeProjectName, normalizeCheckoutPath, resolveBlock } from './block';

const SUITE_ENV = {
  WEB_BASE_URL: 'http://localhost:4300',
  API_PORT: '3100',
  WORKER_HEALTH_PORT: '3101',
  MONGO_PORT: '27117',
  REDIS_PORT: '6479',
  OBJECT_STORE_PORT: '9100',
  MAILPIT_SMTP_PORT: '1125',
  MAILPIT_UI_PORT: '8125',
};

describe('normalizeCheckoutPath (design D4, tarea 2.3a)', () => {
  const expected = 'd:/projects/linkvault';

  it.each([
    ['D:/projects/linkvault', 'mayúscula de la unidad'],
    ['d:\\projects\\linkvault', 'barras invertidas'],
    ['d:\\projects\\linkvault\\', 'ruta con \\ final'],
  ])('%s (%s) → d:/projects/linkvault', (input) => {
    expect(normalizeCheckoutPath(input), `entrada ${JSON.stringify(input)}`).toBe(expected);
  });

  it('conserva las rutas POSIX tal cual, salvo la barra final', () => {
    expect(normalizeCheckoutPath('/home/runner/work/linkvault/linkvault/')).toBe('/home/runner/work/linkvault/linkvault');
  });
});

describe('composeProjectName', () => {
  const block = resolveBlock(SUITE_ENV, {});

  it('da linkvault-e2e-<hash8>, el mismo para las tres formas de la misma ruta', () => {
    const names = ['D:\\projects\\linkvault', 'd:/projects/linkvault', 'd:\\projects\\linkvault\\'].map((path) =>
      composeProjectName(path, block),
    );
    expect(names[0]).toMatch(/^linkvault-e2e-[0-9a-f]{8}$/);
    expect(new Set(names).size).toBe(1);
  });

  it('cambia con el bloque efectivo (--api-port=3200)', () => {
    const moved = resolveBlock(SUITE_ENV, { api: 3200 });
    expect(composeProjectName('d:/projects/linkvault', moved)).not.toBe(composeProjectName('d:/projects/linkvault', block));
  });
});

describe('resolveBlock', () => {
  it('lee el bloque de e2e.env, con web desde WEB_BASE_URL y un solo puerto del almacén S3', () => {
    const block = resolveBlock(SUITE_ENV, {});
    expect(block).toMatchObject({ web: 4300, api: 3100, worker: 3101, objectStore: 9100 });
    expect(Object.keys(block)).not.toContain('objectStoreConsole');
  });

  it('rechaza dos servicios en el mismo puerto', () => {
    expect(() => resolveBlock(SUITE_ENV, { api: 3101 })).toThrow(/3101/);
  });
});
