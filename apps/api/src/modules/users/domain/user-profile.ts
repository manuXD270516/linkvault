// Perfil del usuario (spec users/profile, ADR-018): nombre visible y preferencias que alimentan el contexto de `runTask`.
// Solo tipos y valores por defecto; las reglas de validación viven en user.ts.

/** Idiomas de salida de la IA. Mismo conjunto que `outputLanguageSchema` de `@linkvault/shared` y `OutputLanguage` de `libs/ai`. */
export const OUTPUT_LANGUAGES = ['es', 'en'] as const;
export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number];

export interface AiConsent {
  /** Permiso para enviar datos a proveedores de IA externos. */
  readonly externalProviders: boolean;
  /** Instantánea de la aceptación vigente; `null` hasta la primera o tras revocar. */
  readonly consentedAt: Date | null;
  /** Identificador del texto aceptado; `null` hasta la primera o tras revocar. */
  readonly textVersion: string | null;
}

/**
 * Cambio de consentimiento que llega del `PATCH` (y del contrato compartido): activar exige `textVersion`; revocar no.
 * `consentedAt` lo estampa el caso de uso, no el cliente (D5).
 */
export interface AiConsentChange {
  readonly externalProviders: boolean;
  readonly textVersion?: string;
}

export interface Profile {
  readonly displayName: string;
  readonly aiConsent: AiConsent;
  readonly outputLanguage: OutputLanguage;
  /** Si es true, la IA recibe el nombre propio redactado. */
  readonly redactName: boolean;
}

/**
 * Subconjunto de campos editables listo para persistir; un campo ausente no se modifica. `aiConsent` llega ya
 * estampado por `UpdateMyProfile` (fecha y versión, o nulos al revocar).
 */
export interface ProfileChanges {
  readonly displayName?: string;
  readonly aiConsent?: AiConsent;
  readonly outputLanguage?: OutputLanguage;
  readonly redactName?: boolean;
}

/**
 * Cuerpo editable del `PATCH` antes de estampar el consentimiento. Mismo subconjunto que
 * `updateProfileRequestSchema`.
 */
export interface ProfileUpdateInput {
  readonly displayName?: string;
  readonly aiConsent?: AiConsentChange;
  readonly outputLanguage?: OutputLanguage;
  readonly redactName?: boolean;
}

/**
 * Perfil de un usuario nuevo: sin consentimiento para proveedores externos, salida en español y nombre redactado
 * (ADR-030 §10).
 */
export function defaultProfile(displayName: string): Profile {
  return {
    displayName,
    aiConsent: {
      externalProviders: false,
      consentedAt: null,
      textVersion: null,
    },
    outputLanguage: 'es',
    redactName: true,
  };
}
