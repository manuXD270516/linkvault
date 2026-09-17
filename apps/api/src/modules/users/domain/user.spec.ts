import {
  DISPLAY_NAME_MAX_LENGTH as SHARED_DISPLAY_NAME_MAX_LENGTH,
  displayNameSchema,
  emailSchema,
  outputLanguageSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { InvalidDisplayName, InvalidProfileChanges } from './errors';
import {
  applyProfileChanges,
  createUser,
  DISPLAY_NAME_MAX_LENGTH,
  normalizeDisplayName,
  normalizeEmail,
  normalizeProfileChanges,
} from './user';
import { OUTPUT_LANGUAGES, type Profile } from './user-profile';

const now = new Date('2026-09-17T10:00:00.000Z');
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

describe('normalizeEmail', () => {
  it.each([
    ['  Ana@Example.com ', 'ana@example.com'],
    ['ANA@EXAMPLE.COM', 'ana@example.com'],
    ['ana@example.com', 'ana@example.com'],
    ['\tana@example.com\n', 'ana@example.com'],
  ])('normalizes %j to %j', (raw, normalized) => {
    expect(normalizeEmail(raw)).toBe(normalized);
  });

  it.each(['  Ana@Example.com ', 'Ana.Maria@Example.COM', 'ana@EXAMPLE.com'])(
    'matches the normalization of the shared contract for %j',
    (raw) => {
      expect(normalizeEmail(raw)).toBe(emailSchema.parse(raw));
    },
  );
});

describe('normalizeDisplayName', () => {
  it('trims outer whitespace', () => {
    expect(normalizeDisplayName('  Ana  ')).toBe('Ana');
  });

  it.each(['', '   ', 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)])(
    'rejects %j',
    (raw) => {
      expect(() => normalizeDisplayName(raw)).toThrow(InvalidDisplayName);
    },
  );

  it('accepts the maximum length after trimming', () => {
    const name = 'a'.repeat(DISPLAY_NAME_MAX_LENGTH);

    expect(normalizeDisplayName(`  ${name}  `)).toBe(name);
  });

  it.each([
    '😀'.repeat(DISPLAY_NAME_MAX_LENGTH),
    '😀'.repeat(DISPLAY_NAME_MAX_LENGTH + 1),
    'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1),
    ' Ana ',
  ])('agrees with the shared displayName contract for %j', (raw) => {
    const contract = displayNameSchema.safeParse(raw).success;

    let domain = true;
    try {
      normalizeDisplayName(raw);
    } catch {
      domain = false;
    }

    expect(domain).toBe(contract);
  });

  it('uses the same limit as the shared contract', () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(SHARED_DISPLAY_NAME_MAX_LENGTH);
  });
});

describe('createUser', () => {
  it('Perfil tras el registro', () => {
    const user = createUser({
      email: 'ana@example.com',
      passwordHash: HASH,
      displayName: 'Ana',
      now,
    });

    expect(user.profile).toEqual({
      displayName: 'Ana',
      aiConsent: { externalProviders: false },
      outputLanguage: 'es',
      redactName: false,
    });
  });

  it('normalizes the email and the display name', () => {
    const user = createUser({
      email: '  Ana@Example.com ',
      passwordHash: HASH,
      displayName: ' Ana ',
      now,
    });

    expect(user.email).toBe('ana@example.com');
    expect(user.profile.displayName).toBe('Ana');
  });

  it('sets createdAt and passwordChangedAt to the creation time', () => {
    const user = createUser({
      email: 'ana@example.com',
      passwordHash: HASH,
      displayName: 'Ana',
      now,
    });

    expect(user.createdAt).toEqual(now);
    expect(user.passwordChangedAt).toEqual(now);
    expect(user.passwordHash).toBe(HASH);
  });

  it('rejects an invalid display name', () => {
    expect(() =>
      createUser({
        email: 'ana@example.com',
        passwordHash: HASH,
        displayName: '  ',
        now,
      }),
    ).toThrow(InvalidDisplayName);
  });
});

describe('profile changes', () => {
  const profile: Profile = {
    displayName: 'Ana',
    aiConsent: { externalProviders: false },
    outputLanguage: 'es',
    redactName: false,
  };

  it('offers the same output languages as the shared contract', () => {
    expect(OUTPUT_LANGUAGES).toEqual(outputLanguageSchema.options);
  });

  it('keeps only the sent fields and trims the display name', () => {
    expect(
      normalizeProfileChanges({
        displayName: ' Ana María ',
        redactName: true,
      }),
    ).toEqual({ displayName: 'Ana María', redactName: true });
  });

  it('rejects empty changes', () => {
    expect(() => normalizeProfileChanges({})).toThrow(InvalidProfileChanges);
  });

  it('rejects an unsupported output language naming the field', () => {
    const changes = JSON.parse('{"outputLanguage":"fr"}') as Parameters<
      typeof normalizeProfileChanges
    >[0];

    expect(() => normalizeProfileChanges(changes)).toThrow(
      expect.objectContaining({ field: 'outputLanguage' }),
    );
  });

  it('applies only the sent fields', () => {
    expect(
      applyProfileChanges(profile, { aiConsent: { externalProviders: true } }),
    ).toEqual({ ...profile, aiConsent: { externalProviders: true } });
  });
});
