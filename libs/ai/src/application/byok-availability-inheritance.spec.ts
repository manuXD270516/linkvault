import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '../domain/ports/llm-provider.port';
import type { RunContext } from '../domain/run-context';
import type { ByokProviderConfig } from '../infrastructure/config/ai-config.schema';
import { defaultByokConfig } from '../infrastructure/config/default-byok-config';
import { keyHintOf } from '../infrastructure/crypto/key-hint';
import { LibsodiumSecretVault } from '../infrastructure/crypto/libsodium-secret-vault';
import {
  ByokProviderFactory,
  byokProviderId,
  type ByokProvidersSource,
} from '../infrastructure/providers/byok-provider.factory';
import { classifySkillsTask } from '../tasks/classify-skills.task';
import { DefaultProviderEligibility } from './provider-eligibility';
import { RunTask } from './run-task.usecase';
import { FakeLlmProvider } from './testing/fake-llm-provider';
import {
  InMemoryAiLogger,
  InMemoryPromptRegistry,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
  RecordingNullCircuitBreaker,
} from './testing/in-memory-ports';
import { InMemoryUserAiKeysRepository } from './testing/in-memory-user-ai-keys.repository';

// 10-bis.5: LOS OTROS TRES CONSUMIDORES HEREDAN LA CONDICIÓN; SE COMPRUEBA, NO SE SUPONE.
//
// `run-task.usecase.ts` (ejecución de tareas) y `DefaultProviderEligibility` (elegibilidad, de donde sale la
// vigencia del degradado por cuota de `cv/match`) reciben «configuración utilizable» por un único camino: la
// factory BYOK, que pregunta a `isByokVendorConfigUsable`. Ninguno vuelve a preguntar por el modelo.
//
// Por eso estos tests usan la **factory real** con su vault y su repositorio, y no un `providersFor` de mentira: lo
// que se comprueba es precisamente la herencia. Lo único que se sustituye son los objetos construidos, por fakes
// con **el mismo id y las mismas capacidades**, para no hablar por red: quién entra en el universo lo sigue
// decidiendo la factory con la configuración de cada caso.
//
// El desenlace que estas deltas cierran es el del primer caso: cuota agotada y ningún BYOK utilizable tiene que
// salir como `quota_exceeded` —con su instante de vuelta y su registro de cuota— y NO como un degradado por cadena
// vacía (`no_providers`), que diría que no hay IA cuando lo que hay es una cuota agotada.

const ANA = 'ana';
const VAULT_KEY = new Uint8Array(32).fill(7);
const VALID_OUTPUT = {
  skills: [{ name: 'TypeScript', category: 'language' }],
};
const VALID = JSON.stringify(VALID_OUTPUT);
const RETRY_AT = new Date('2026-09-18T10:00:00.000Z');
const USER_CTX: RunContext = {
  aiConsent: { externalProviders: true },
  userId: ANA,
};

/** OpenRouter sin modelo utilizable; `anthropic` y `openai` con su configuración de siempre. */
const OPENROUTER_UNUSABLE: ByokProviderConfig = defaultByokConfig({
  openrouterModel: '',
});

/**
 * Fuente BYOK que delega en la factory real y devuelve fakes con el id y las capacidades de lo que construyó.
 *
 * La decisión que interesa —qué vendors entran— la sigue tomando la factory; lo que se evita es que un
 * `OpenAIProvider` de verdad intente hablar por red en un test unitario.
 */
class HermeticByokSource implements ByokProvidersSource {
  readonly fakes: FakeLlmProvider[] = [];

  constructor(private readonly factory: ByokProviderFactory) {}

  async providersFor(userId: string | undefined): Promise<LlmProvider[]> {
    const built = await this.factory.providersFor(userId);
    return built.map((provider) => {
      const fake = new FakeLlmProvider(provider.id, [VALID], {
        capabilities: provider.capabilities,
      });
      this.fakes.push(fake);
      return fake;
    });
  }
}

/** Fuente BYOK sobre las claves guardadas que se le digan, con la configuración que se le diga. */
async function byokSourceWith(
  vendors: readonly ('anthropic' | 'openai' | 'openrouter')[],
  config: ByokProviderConfig,
): Promise<HermeticByokSource> {
  const vault = new LibsodiumSecretVault({ vaultKey: VAULT_KEY });
  const keys = new InMemoryUserAiKeysRepository();
  for (const vendor of vendors) {
    const apiKey = `sk-${vendor}-ana-secret-key`;
    await keys.upsert({
      userId: ANA,
      vendor,
      ciphertext: await vault.encrypt(apiKey),
      keyHint: keyHintOf(apiKey),
    });
  }
  return new HermeticByokSource(
    new ByokProviderFactory({
      keys,
      vault,
      config,
      logger: new InMemoryAiLogger(),
    }),
  );
}

/** Cuota de plataforma agotada, con instante de vuelta. */
function exhaustedQuota(): InMemoryQuotaPolicy {
  return new InMemoryQuotaPolicy(() =>
    Promise.resolve({ allowed: false, retryAt: RETRY_AT }),
  );
}

function runTaskWith(
  byokFactory: ByokProvidersSource,
  platform: readonly LlmProvider[],
  quota: InMemoryQuotaPolicy,
): { runTask: RunTask; ledger: InMemoryUsageLedger } {
  const ledger = new InMemoryUsageLedger();
  const runTask = new RunTask({
    providers: platform,
    byokFactory,
    prompts: new InMemoryPromptRegistry(),
    cache: new InMemoryResultCache(),
    ledger,
    quota,
    breaker: new RecordingNullCircuitBreaker(),
    clock: new ManualClock(),
    logger: new InMemoryAiLogger(),
    pendingFixtures: null,
  });
  return { runTask, ledger };
}

function eligibilityWith(
  byokFactory: ByokProvidersSource,
  platform: readonly LlmProvider[],
): DefaultProviderEligibility {
  return new DefaultProviderEligibility({
    platformProviders: platform,
    breaker: new RecordingNullCircuitBreaker(),
    byokFactory,
  });
}

describe('la condición de «configuración utilizable» se hereda de la factory', () => {
  it('cuota agotada y el único vendor con clave inutilizable: quota_exceeded, sin contactar a nadie', async () => {
    const byok = await byokSourceWith(['openrouter'], OPENROUTER_UNUSABLE);
    const platform = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask, ledger } = runTaskWith(
      byok,
      [platform],
      exhaustedQuota(),
    );

    const result = await runTask.execute(
      classifySkillsTask,
      { text: 'Backend con TypeScript y NestJS' },
      USER_CTX,
    );

    // El desenlace honesto: la cuota, con su instante de vuelta. No `no_providers`.
    expect(result).toEqual({
      status: 'degraded',
      reason: 'quota_exceeded',
      aiQuotaRetryAt: RETRY_AT.toISOString(),
    });
    expect(platform.calls).toBe(0);
    expect(byok.fakes.every((fake) => fake.calls === 0)).toBe(true);
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]).toMatchObject({
      userId: ANA,
      outcome: 'quota',
      providerId: null,
      model: null,
    });
  });

  it('con un vendor inutilizable y otro utilizable, la cadena restringida se compone solo con el segundo', async () => {
    const byok = await byokSourceWith(
      ['openrouter', 'openai'],
      OPENROUTER_UNUSABLE,
    );
    const platform = new FakeLlmProvider('openrouter', [VALID], {
      capabilities: { external: true },
    });
    const { runTask } = runTaskWith(byok, [platform], exhaustedQuota());

    const result = await runTask.execute(
      classifySkillsTask,
      { text: 'Backend con TypeScript y NestJS' },
      USER_CTX,
    );

    expect(result).toMatchObject({
      status: 'success',
      providerId: byokProviderId(ANA, 'openai'),
    });
    // El inutilizable no llega a estar en el universo: la factory no lo construyó.
    expect(byok.fakes.map((fake) => fake.id)).toEqual([
      byokProviderId(ANA, 'openai'),
    ]);
    expect(platform.calls).toBe(0);
  });

  it('hasEligibleByok sale en falso con el vendor inutilizable y en verdadero con el utilizable', async () => {
    const query = {
      task: {
        requires: classifySkillsTask.requires,
        dataSensitivity: classifySkillsTask.dataSensitivity,
      },
      aiConsent: { externalProviders: true },
      userId: ANA,
    };

    const onlyUnusable = await byokSourceWith(
      ['openrouter'],
      OPENROUTER_UNUSABLE,
    );
    await expect(
      eligibilityWith(onlyUnusable, []).hasEligibleProvider(query),
    ).resolves.toEqual({
      status: 'ready',
      hasEligible: false,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });

    const alsoUsable = await byokSourceWith(
      ['openrouter', 'openai'],
      OPENROUTER_UNUSABLE,
    );
    await expect(
      eligibilityWith(alsoUsable, []).hasEligibleProvider(query),
    ).resolves.toEqual({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: true,
      consentWouldEnable: false,
    });

    // Con la configuración utilizable el mismo vendor sí entra: lo que cambia es la configuración, no el test.
    const usableConfig = await byokSourceWith(
      ['openrouter'],
      defaultByokConfig({ openrouterModel: 'cohere/north-mini-code:free' }),
    );
    await expect(
      eligibilityWith(usableConfig, []).hasEligibleProvider(query),
    ).resolves.toMatchObject({ hasEligibleByok: true });
  });

  // NINGUNO DE LOS CONSUMIDORES REPITE EL PREDICADO. Es la mitad que los tests de comportamiento no cubren: alguien
  // puede añadir mañana la condición en línea «por prudencia» y todo lo de arriba seguiría en verde, con dos
  // verdades que divergen en cuanto una cambie. `isDegradedReasonCurrent` (el tercer consumidor, en `apps/api`) no
  // aparece aquí porque es una función pura que solo recibe `hasEligibleByok`: no tiene de dónde sacar el modelo.
  //
  // Es un grep sobre el fuente, con lo que eso vale: cae también si la palabra aparece en un comentario. Se acepta
  // el falso positivo —cuesta una línea de comentario reescribirla— a cambio de cazar la reimplementación, que es
  // lo que ningún test de comportamiento puede ver mientras la respuesta coincida.
  it('ni runTask ni la elegibilidad vuelven a preguntar por el modelo', () => {
    const consumers = ['./run-task.usecase.ts', './provider-eligibility.ts'];
    const forbidden = [
      'openrouterModel',
      'isOpenRouterModelUsable',
      'isByokVendorConfigUsable',
      ':free',
    ];

    for (const consumer of consumers) {
      const source = readFileSync(
        fileURLToPath(new URL(consumer, import.meta.url)),
        'utf8',
      );
      for (const needle of forbidden) {
        expect(
          source.includes(needle),
          `${consumer} nombra "${needle}": la condición se hereda de la factory, no se repite`,
        ).toBe(false);
      }
    }
  });
});
