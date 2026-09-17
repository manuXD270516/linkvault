import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

// Sonda de infraestructura de tests: ProbeConsumer recibe ProbeDependency por constructor sin @Inject,
// así que Nest solo puede resolverla si el transformador emitió design:paramtypes.
@Injectable()
class ProbeDependency {
  readonly id = 'probe-dependency';
}

@Injectable()
class ProbeConsumer {
  constructor(readonly dependency: ProbeDependency) {}
}

@Module({ providers: [ProbeDependency, ProbeConsumer] })
class ProbeModule {}

describe('Nest dependency injection under Vitest', () => {
  it('injects a constructor dependency resolved from decorator metadata', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();

    const consumer = moduleRef.get(ProbeConsumer);

    expect(consumer.dependency).toBeInstanceOf(ProbeDependency);
    expect(consumer.dependency).toBe(moduleRef.get(ProbeDependency));
    expect(consumer.dependency.id).toBe('probe-dependency');

    await moduleRef.close();
  });
});
