import { cvFileKey } from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

// 1.0 de cv-extract-isolation (C3-05): partir el Vitest del worker en dos proyectos no debe perder `unplugin-swc`. Sin
// él, el transformador por defecto de Vite puede no emitir `design:paramtypes` y la inyección por constructor de Nest
// falla; y sin `extends: true` el proyecto pierde también el `env` del preset y los alias `@linkvault/*` de la raíz.
// Vive en el proyecto `worker` (no en el de aislamiento), que es el que podría perder el `extends: true`.

@Injectable()
class Dependency {
  readonly answer = 42;
}

@Injectable()
class NeedsDependency {
  constructor(readonly dependency: Dependency) {}
}

describe('worker project', () => {
  it('worker project keeps decorator metadata', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Dependency, NeedsDependency],
    }).compile();

    expect(moduleRef.get(NeedsDependency).dependency).toBeInstanceOf(
      Dependency,
    );
    expect(moduleRef.get(NeedsDependency).dependency.answer).toBe(42);
  });

  it('worker project inherits the root configuration: preset env and workspace aliases', () => {
    // Lo que se pierde sin `extends: true`: el `env` del preset (IA en mock) y la resolución de `@linkvault/*`.
    expect(process.env['AI_CHAIN']).toBe('mock');
    expect(typeof cvFileKey).toBe('function');
  });
});
