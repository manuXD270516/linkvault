import { describe, expect, it, vi } from 'vitest';
import { InMemoryAiLogger } from '../../application/testing/in-memory-ports';
import { InMemoryUserAiKeysRepository } from '../../application/testing/in-memory-user-ai-keys.repository';
import { LibsodiumSecretVault } from '../crypto/libsodium-secret-vault';
import { defaultByokConfig } from '../config/default-byok-config';
import { keyHintOf } from '../crypto/key-hint';
import {
  ByokProviderFactory,
  byokProviderId,
} from './byok-provider.factory';
import { OpenRouterProvider } from './openrouter.provider';

const VAULT_KEY = new Uint8Array(32).fill(3);
const ANA_OPENAI = 'sk-openai-ana-secret-key';
const BETO_OPENAI = 'sk-openai-beto-secret-key';

describe('ByokProviderFactory', () => {
  it('builds byok providers only for the requested userId', async () => {
    const vault = new LibsodiumSecretVault({ vaultKey: VAULT_KEY });
    const keys = new InMemoryUserAiKeysRepository();
    await keys.upsert({
      userId: 'ana',
      vendor: 'openai',
      ciphertext: await vault.encrypt(ANA_OPENAI),
      keyHint: keyHintOf(ANA_OPENAI),
    });
    await keys.upsert({
      userId: 'beto',
      vendor: 'openai',
      ciphertext: await vault.encrypt(BETO_OPENAI),
      keyHint: keyHintOf(BETO_OPENAI),
    });
    const factory = new ByokProviderFactory({
      keys,
      vault,
      config: defaultByokConfig(),
      logger: new InMemoryAiLogger(),
    });

    const ana = await factory.providersFor('ana');
    const beto = await factory.providersFor('beto');

    expect(ana.map((p) => p.id)).toEqual([byokProviderId('ana', 'openai')]);
    expect(beto.map((p) => p.id)).toEqual([byokProviderId('beto', 'openai')]);
    expect(ana[0]?.id).not.toBe(beto[0]?.id);
  });

  it('returns empty without vault or userId', async () => {
    const factory = new ByokProviderFactory({
      keys: new InMemoryUserAiKeysRepository(),
      vault: new LibsodiumSecretVault({ vaultKey: undefined }),
      config: defaultByokConfig(),
      logger: new InMemoryAiLogger(),
    });

    await expect(factory.providersFor('ana')).resolves.toEqual([]);
    await expect(factory.providersFor(undefined)).resolves.toEqual([]);
  });

  it('sets OpenRouter dataCollection deny only for :free models', async () => {
    const vault = new LibsodiumSecretVault({ vaultKey: VAULT_KEY });
    const keys = new InMemoryUserAiKeysRepository();
    const apiKey = 'sk-or-byok-test-key-xx';
    await keys.upsert({
      userId: 'ana',
      vendor: 'openrouter',
      ciphertext: await vault.encrypt(apiKey),
      keyHint: keyHintOf(apiKey),
    });

    const freeFactory = new ByokProviderFactory({
      keys,
      vault,
      config: defaultByokConfig({
        openrouterModel: 'meta-llama/llama-3.3-70b-instruct:free',
      }),
      logger: new InMemoryAiLogger(),
    });
    const paidFactory = new ByokProviderFactory({
      keys,
      vault,
      config: defaultByokConfig({
        openrouterModel: 'anthropic/claude-sonnet-4',
      }),
      logger: new InMemoryAiLogger(),
    });

    const [free] = await freeFactory.providersFor('ana');
    const [paid] = await paidFactory.providersFor('ana');

    expect(free).toBeInstanceOf(OpenRouterProvider);
    expect(paid).toBeInstanceOf(OpenRouterProvider);

    const bodies: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => {
        bodies.push(
          init?.body === undefined
            ? undefined
            : JSON.parse(String(init.body)),
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{}' } }],
          }),
          body: { cancel: async () => undefined },
        } as unknown as Response;
      },
    );

    await free?.complete({ system: 's', user: 'u' });
    await paid?.complete({ system: 's', user: 'u' });

    expect(bodies[0]).toMatchObject({
      provider: { data_collection: 'deny' },
    });
    expect(bodies[1]).not.toHaveProperty('provider');

    fetchSpy.mockRestore();
  });
});
