import { describe, expect, inject, it } from 'vitest';

// El proyecto `worker-isolation` corre en serie, en procesos hijo del runner de Vitest y con `--expose-gc` (1.0, N6, D10):
// los specs de aislamiento no se pisan entre ficheros y las mediciones de memoria parten de una base tomada tras
// `global.gc()`.

describe('the isolation project', () => {
  it('isolation project runs files serially', () => {
    const config = inject('isolationProjectConfig');

    expect(config.name).toBe('worker-isolation');
    expect(config.fileParallelism).toBe(false);
    expect(config.pool).toBe('forks');
    expect(config.execArgv).toContain('--expose-gc');
    // Y se ve desde dentro de un spec: el recolector manual está expuesto.
    expect(typeof global.gc).toBe('function');
  });
});
