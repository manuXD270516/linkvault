import { AI_VENDORS } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { InMemoryAiLogger } from '../../application/testing/in-memory-ports';
import { InMemoryUserAiKeysRepository } from '../../application/testing/in-memory-user-ai-keys.repository';
import type { ByokProviderConfig } from '../config/ai-config.schema';
import { defaultByokConfig } from '../config/default-byok-config';
import { LibsodiumSecretVault } from '../crypto/libsodium-secret-vault';
import { keyHintOf } from '../crypto/key-hint';
import { ByokProviderFactory, byokProviderId } from './byok-provider.factory';
import {
  byokVendorAvailabilityOf,
  isByokVendorConfigUsable,
} from './byok-vendor-availability';

const VAULT_KEY = new Uint8Array(32).fill(7);
const USER = 'ana';

/** Factory con clave descifrable de los tres vendors: lo único que varía entre casos es la configuración. */
async function factoryWithEveryVendor(
  config: ByokProviderConfig,
): Promise<ByokProviderFactory> {
  const vault = new LibsodiumSecretVault({ vaultKey: VAULT_KEY });
  const keys = new InMemoryUserAiKeysRepository();
  for (const vendor of AI_VENDORS) {
    const apiKey = `sk-${vendor}-ana-secret-key`;
    await keys.upsert({
      userId: USER,
      vendor,
      ciphertext: await vault.encrypt(apiKey),
      keyHint: keyHintOf(apiKey),
    });
  }
  return new ByokProviderFactory({
    keys,
    vault,
    config,
    logger: new InMemoryAiLogger(),
  });
}

/**
 * Tabla de configuraciones. El caso «sin modelo» no se alcanza **vaciando** la variable —`EnvReader` lee la cadena
 * vacía como ausente y `parseByok` repone el valor por defecto del código, que es un `:free` vivo—; por entorno solo
 * llega con un valor de solo espacios, que es el caso `'   '` de abajo. Aquí se fija pasando directamente lo que
 * llegaría a la factory, sin pasar por el parseo.
 */
const CASES: { name: string; config: ByokProviderConfig }[] = [
  {
    name: 'OpenRouter con modelo :free',
    config: defaultByokConfig({
      openrouterModel: 'cohere/north-mini-code:free',
    }),
  },
  {
    name: 'OpenRouter con modelo de pago',
    config: defaultByokConfig({ openrouterModel: 'anthropic/claude-sonnet-4' }),
  },
  {
    name: 'OpenRouter con modelo vacío',
    config: defaultByokConfig({ openrouterModel: '' }),
  },
  {
    name: 'OpenRouter con modelo de solo espacios',
    config: defaultByokConfig({ openrouterModel: '   ' }),
  },
  {
    name: 'anthropic y openai con sus modelos',
    config: defaultByokConfig(),
  },
  {
    name: 'anthropic y openai sin modelo',
    config: defaultByokConfig({ anthropicModel: '', openaiModel: '' }),
  },
];

describe('isByokVendorConfigUsable', () => {
  it('solo OpenRouter tiene condición hoy, y es la del modelo utilizable', () => {
    const usable = defaultByokConfig({ openrouterModel: 'x/y:free' });
    const unusable = defaultByokConfig({ openrouterModel: '' });

    expect(isByokVendorConfigUsable('openrouter', usable)).toBe(true);
    expect(isByokVendorConfigUsable('openrouter', unusable)).toBe(false);
    expect(isByokVendorConfigUsable('anthropic', unusable)).toBe(true);
    expect(isByokVendorConfigUsable('openai', unusable)).toBe(true);
  });

  it('el predicado atado a una configuración responde lo mismo que el libre', () => {
    const config = defaultByokConfig({ openrouterModel: '' });
    const availability = byokVendorAvailabilityOf(config);

    for (const vendor of AI_VENDORS) {
      expect(availability(vendor)).toBe(
        isByokVendorConfigUsable(vendor, config),
      );
    }
  });

  // TEST DE NO DIVERGENCIA (10-bis.3, ADR-048 §6-ter). Ata los dos lados del mismo criterio: lo que la factory
  // construye y lo que el predicado promete. Sin él, la API podría anunciar `available: true` para un vendor que el
  // enrutado no va a usar —o al revés—, y nada en el repositorio se enteraría.
  describe('no diverge de lo que ByokProviderFactory construye', () => {
    for (const { name, config } of CASES) {
      it(`${name}: providersFor incluye el vendor si y solo si el predicado lo declara utilizable`, async () => {
        const factory = await factoryWithEveryVendor(config);
        const availability = byokVendorAvailabilityOf(config);

        const built = new Set(
          (await factory.providersFor(USER)).map((provider) => provider.id),
        );

        for (const vendor of AI_VENDORS) {
          expect(
            built.has(byokProviderId(USER, vendor)),
            `${name} / ${vendor}: la factory y el predicado discrepan`,
          ).toBe(availability(vendor));
        }
      });
    }
  });
});
