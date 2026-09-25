import { describe, expect, it } from 'vitest';
import {
  AI_BYOK_API_KEY_MIN_LENGTH,
  AI_VENDORS,
  aiKeyViewSchema,
  aiVendorAvailabilitySchema,
  aiVendorSchema,
  listAiKeysResponseSchema,
  upsertAiKeyRequestSchema,
} from './ai-byok.schema';

const VIEW = {
  vendor: 'openai' as const,
  keyHint: '3456',
  updatedAt: '2026-09-22T12:00:00.000Z',
  available: true,
};

const ALL_VENDORS = [
  { vendor: 'anthropic' as const, available: true },
  { vendor: 'openai' as const, available: true },
  { vendor: 'openrouter' as const, available: false },
];

describe('ai-byok schemas', () => {
  it('accepts the three vendors', () => {
    expect(aiVendorSchema.options).toEqual([
      'anthropic',
      'openai',
      'openrouter',
    ]);
  });

  it('requires apiKey of at least 16 characters', () => {
    expect(
      upsertAiKeyRequestSchema.safeParse({
        apiKey: 'x'.repeat(AI_BYOK_API_KEY_MIN_LENGTH - 1),
      }).success,
    ).toBe(false);
    expect(
      upsertAiKeyRequestSchema.parse({
        apiKey: 'sk-test-key-123456',
      }),
    ).toEqual({ apiKey: 'sk-test-key-123456' });
  });

  it('accepts a key view and a list response', () => {
    expect(aiKeyViewSchema.parse(VIEW)).toEqual(VIEW);
    expect(
      listAiKeysResponseSchema.parse({ keys: [VIEW], vendors: ALL_VENDORS }),
    ).toEqual({ keys: [VIEW], vendors: ALL_VENDORS });
  });

  it('rejects a keyHint that is not four characters', () => {
    expect(
      aiKeyViewSchema.safeParse({
        vendor: 'anthropic',
        keyHint: 'abc',
        updatedAt: '2026-09-22T12:00:00.000Z',
        available: true,
      }).success,
    ).toBe(false);
  });

  // 10-bis.2: el campo no puede quedar implícito. `strictObject` impide colarlo sin declararlo, y esto impide
  // declararlo opcional por comodidad del productor: una vista sin `available` no es una vista.
  it('rejects a key view without the availability flag', () => {
    const { available: _omitted, ...withoutAvailable } = VIEW;
    expect(aiKeyViewSchema.safeParse(withoutAvailable).success).toBe(false);
  });

  it('rejects a list response without the vendors array', () => {
    expect(listAiKeysResponseSchema.safeParse({ keys: [VIEW] }).success).toBe(
      false,
    );
  });

  // 10-bis.2: cobertura exacta. Un `vendors` a medias obligaría al cliente a decidir qué significa un vendor
  // ausente, que es justo la deducción que la spec de `web/byok` le prohíbe.
  it('rejects a vendors array that leaves a vendor out', () => {
    const incomplete = ALL_VENDORS.filter(
      (entry) => entry.vendor !== 'anthropic',
    );
    expect(
      listAiKeysResponseSchema.safeParse({ keys: [], vendors: incomplete })
        .success,
    ).toBe(false);
  });

  it('rejects a vendors array with a repeated vendor', () => {
    const repeated = [
      ...ALL_VENDORS,
      { vendor: 'openai' as const, available: false },
    ];
    expect(
      listAiKeysResponseSchema.safeParse({ keys: [], vendors: repeated })
        .success,
    ).toBe(false);
  });

  it('accepts a response with no saved keys and the three availability states', () => {
    const body = {
      keys: [],
      vendors: [
        { vendor: 'anthropic' as const, available: false },
        { vendor: 'openai' as const, available: true },
        { vendor: 'openrouter' as const, available: false },
      ],
    };
    expect(listAiKeysResponseSchema.parse(body)).toEqual(body);
    expect(body.vendors).toHaveLength(AI_VENDORS.length);
  });

  // 10-bis.2bis: el tercer conjunto cerrado, el de `ai/data-protection`. Se afirma el CONJUNTO EXACTO de claves del
  // cuerpo, no un subconjunto: un `toMatchObject` dejaría pasar un campo de más, que es precisamente lo que esta
  // comprobación existe para impedir. Falsable: añadir un campo cualquiera al schema hace caer este test.
  describe('the response body carries the availability state and nothing else', () => {
    const body = listAiKeysResponseSchema.parse({
      keys: [VIEW],
      vendors: ALL_VENDORS,
    });

    it('has exactly the declared top-level keys', () => {
      expect(Object.keys(body).sort()).toEqual(['keys', 'vendors']);
    });

    it('has exactly the declared keys in each key view', () => {
      for (const view of body.keys) {
        expect(Object.keys(view).sort()).toEqual([
          'available',
          'keyHint',
          'updatedAt',
          'vendor',
        ]);
      }
    });

    it('has exactly the declared keys in each vendor entry', () => {
      for (const entry of body.vendors) {
        expect(Object.keys(entry).sort()).toEqual(['available', 'vendor']);
      }
    });

    // El plaintext y el ciphertext no entran ni declarándolos: `strictObject` los rechaza en el parseo, así que el
    // controlador no puede devolverlos aunque el caso de uso los ponga.
    it('rejects a view that carries the key or the ciphertext', () => {
      for (const extra of [
        { apiKey: 'sk-test-key-123456' },
        { ciphertext: 'deadbeef' },
      ]) {
        expect(aiKeyViewSchema.safeParse({ ...VIEW, ...extra }).success).toBe(
          false,
        );
      }
    });

    // Un vendor indisponible dice que no está disponible, y nada más: ni el modelo, ni la variable que falta, ni
    // «configura BYOK_OPENROUTER_MODEL». Eso sería revelar la configuración del servidor por el camino.
    it('does not let an unavailable vendor reveal why', () => {
      const unavailable = body.vendors.find((entry) => !entry.available);
      expect(unavailable).toEqual({ vendor: 'openrouter', available: false });
      for (const extra of [
        { reason: 'missing_model' },
        { missingVariable: 'BYOK_OPENROUTER_MODEL' },
        { model: '' },
      ]) {
        expect(
          aiVendorAvailabilitySchema.safeParse({
            vendor: 'openrouter',
            available: false,
            ...extra,
          }).success,
        ).toBe(false);
      }
    });
  });
});
