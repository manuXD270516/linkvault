import {
  InMemoryUserAiKeysRepository,
  LibsodiumSecretVault,
  type ByokVendorAvailability,
} from '@linkvault/ai';
import { AI_VENDORS, type AiVendor } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AiVaultUnavailable } from '../domain/errors';
import type { Clock } from './ports/clock.port';
import { DeleteAllMyAiKeys } from './delete-all-my-ai-keys.usecase';
import { DeleteMyAiKey } from './delete-my-ai-key.usecase';
import { ListMyAiKeys } from './list-my-ai-keys.usecase';
import { UpsertMyAiKey } from './upsert-my-ai-key.usecase';

// Casos de uso BYOK (tarea 1.3): vault + repo en memoria. Sin HTTP ni Mongo.
//
// La disponibilidad entra por el puerto `ByokVendorAvailability` (token `BYOK_VENDOR_AVAILABILITY`), que es todo lo
// que la API conoce del criterio: quién es construible lo decide `libs/ai` y su no divergencia con la factory se
// comprueba allí (`byok-vendor-availability.spec.ts`, 10-bis.3). Aquí se comprueba lo que sí es responsabilidad de
// la API: que pobla el contrato y que no se contradice a sí misma.

const ANA = '66e9a0000000000000000a01';
const VAULT_KEY = new Uint8Array(32).fill(9);
const API_KEY = 'sk-test-openai-key-16+';
const KEY_HINT = API_KEY.slice(-4);

/** Todos construibles: el caso normal de la instancia. */
const ALL_AVAILABLE: ByokVendorAvailability = () => true;

/** OpenRouter sin modelo utilizable: el único vendor que hoy puede salir indisponible (ADR-048 §6). */
const OPENROUTER_UNAVAILABLE: ByokVendorAvailability = (vendor) =>
  vendor !== 'openrouter';

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

describe('BYOK ai-keys use cases', () => {
  const now = new Date('2026-09-22T12:00:00.000Z');
  let vault: LibsodiumSecretVault;
  let keys: InMemoryUserAiKeysRepository;
  let upsert: UpsertMyAiKey;
  let list: ListMyAiKeys;
  let remove: DeleteMyAiKey;
  let removeAll: DeleteAllMyAiKeys;

  beforeEach(() => {
    vault = new LibsodiumSecretVault({ vaultKey: VAULT_KEY });
    keys = new InMemoryUserAiKeysRepository();
    const clock = new FixedClock(now);
    upsert = new UpsertMyAiKey(vault, keys, clock, ALL_AVAILABLE);
    list = new ListMyAiKeys(keys, ALL_AVAILABLE);
    remove = new DeleteMyAiKey(keys);
    removeAll = new DeleteAllMyAiKeys(keys);
  });

  /** Los tres vendors disponibles, en el orden de `AI_VENDORS`. */
  const everyVendorAvailable = AI_VENDORS.map((vendor) => ({
    vendor,
    available: true,
  }));

  it('upserts, lists hint only, and never returns plaintext', async () => {
    const view = await upsert.execute(ANA, 'openai', { apiKey: API_KEY });
    expect(view).toEqual({
      vendor: 'openai',
      keyHint: KEY_HINT,
      updatedAt: now.toISOString(),
      available: true,
    });
    expect(JSON.stringify(view)).not.toContain(API_KEY);

    const listed = await list.execute(ANA);
    expect(listed.keys).toEqual([view]);
    expect(JSON.stringify(listed)).not.toContain(API_KEY);

    const record = await keys.findRecord(ANA, 'openai');
    expect(record).not.toBeNull();
    if (record === null) {
      return;
    }
    expect(record.ciphertext).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(record.ciphertext).toString('utf8')).not.toContain(
      API_KEY,
    );
  });

  it('revokes a vendor so GET no longer lists it', async () => {
    await upsert.execute(ANA, 'anthropic', { apiKey: 'anthropic-secret-key' });
    await remove.execute(ANA, 'anthropic');
    expect(await list.execute(ANA)).toEqual({
      keys: [],
      vendors: everyVendorAvailable,
    });
  });

  it('deletes all keys for the user', async () => {
    await upsert.execute(ANA, 'openai', { apiKey: API_KEY });
    await upsert.execute(ANA, 'openrouter', {
      apiKey: 'or-secret-key-xxxxxx',
    });
    await removeAll.execute(ANA);
    expect(await list.execute(ANA)).toEqual({
      keys: [],
      vendors: everyVendorAvailable,
    });
  });

  it('responds vault_unavailable when the vault has no key', async () => {
    const unavailable = new LibsodiumSecretVault({ vaultKey: undefined });
    const useCase = new UpsertMyAiKey(
      unavailable,
      keys,
      new FixedClock(now),
      ALL_AVAILABLE,
    );
    await expect(
      useCase.execute(ANA, 'openai', { apiKey: API_KEY }),
    ).rejects.toBeInstanceOf(AiVaultUnavailable);
    expect(await list.execute(ANA)).toEqual({
      keys: [],
      vendors: everyVendorAvailable,
    });
  });

  // 10-bis.4: la API **pobla** el estado por vendor y no lo decide. Lo que se comprueba aquí es que el cuerpo sale
  // completo (los tres vendors, tengan clave o no) y que sus dos mitades no pueden contradecirse.
  describe('disponibilidad por vendor en la respuesta del listado', () => {
    it('sin ninguna clave responde keys vacío y los tres estados igualmente', async () => {
      const listing = new ListMyAiKeys(keys, OPENROUTER_UNAVAILABLE);

      await expect(listing.execute(ANA)).resolves.toEqual({
        keys: [],
        vendors: [
          { vendor: 'anthropic', available: true },
          { vendor: 'openai', available: true },
          { vendor: 'openrouter', available: false },
        ],
      });
    });

    it('la vista de un vendor indisponible sale con available false y el resto en true', async () => {
      const saving = new UpsertMyAiKey(
        vault,
        keys,
        new FixedClock(now),
        OPENROUTER_UNAVAILABLE,
      );
      await saving.execute(ANA, 'openrouter', {
        apiKey: 'or-secret-key-xxxxxx',
      });
      await saving.execute(ANA, 'openai', { apiKey: API_KEY });

      const body = await new ListMyAiKeys(
        keys,
        OPENROUTER_UNAVAILABLE,
      ).execute(ANA);

      const availableByVendor = new Map(
        body.keys.map((view) => [view.vendor, view.available]),
      );
      expect(availableByVendor.get('openrouter')).toBe(false);
      expect(availableByVendor.get('openai')).toBe(true);
    });

    it('el PUT devuelve el estado del vendor que se acaba de guardar, no el de antes', async () => {
      const saving = new UpsertMyAiKey(
        vault,
        keys,
        new FixedClock(now),
        OPENROUTER_UNAVAILABLE,
      );

      await expect(
        saving.execute(ANA, 'openrouter', { apiKey: 'or-secret-key-xxxxxx' }),
      ).resolves.toEqual({
        vendor: 'openrouter',
        keyHint: 'xxxx',
        updatedAt: now.toISOString(),
        available: false,
      });
    });

    // COHERENCIA INTERNA DEL CUERPO: `keys[i].available` y la entrada de `vendors` del mismo vendor son el mismo
    // hecho dicho dos veces. Que difieran sería esta misma avería en miniatura, y desde el SPA no habría forma de
    // saber cuál de las dos creer.
    it('ningún keys[i].available difiere del estado del mismo vendor en vendors', async () => {
      for (const unavailable of AI_VENDORS) {
        const availability: ByokVendorAvailability = (vendor) =>
          vendor !== unavailable;
        const repository = new InMemoryUserAiKeysRepository();
        const saving = new UpsertMyAiKey(
          vault,
          repository,
          new FixedClock(now),
          availability,
        );
        for (const vendor of AI_VENDORS) {
          await saving.execute(ANA, vendor, {
            apiKey: `sk-${vendor}-ana-secret-key`,
          });
        }

        const body = await new ListMyAiKeys(repository, availability).execute(
          ANA,
        );

        const declared = new Map<AiVendor, boolean>(
          body.vendors.map((entry) => [entry.vendor, entry.available]),
        );
        expect(declared.size).toBe(AI_VENDORS.length);
        for (const view of body.keys) {
          expect(
            view.available,
            `${view.vendor}: keys[] y vendors[] discrepan con ${unavailable} indisponible`,
          ).toBe(declared.get(view.vendor));
        }
        expect(declared.get(unavailable)).toBe(false);
      }
    });
  });
});
