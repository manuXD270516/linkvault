// Perfil del usuario (spec users/profile, ADR-018): nombre visible y preferencias que alimentan el contexto de `runTask`.
// Solo tipos y valores por defecto; las reglas de validación viven en user.ts.

/** Idiomas de salida de la IA. Mismo conjunto que `outputLanguageSchema` de `@linkvault/shared` y `OutputLanguage` de `libs/ai`. */
export const OUTPUT_LANGUAGES = ['es', 'en'] as const;
export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number];

export interface AiConsent {
  /** Permiso para enviar datos a proveedores de IA externos. */
  readonly externalProviders: boolean;
}

export interface Profile {
  readonly displayName: string;
  readonly aiConsent: AiConsent;
  readonly outputLanguage: OutputLanguage;
  /** Si es true, la IA recibe el nombre propio redactado. */
  readonly redactName: boolean;
}

/** Subconjunto de campos editables del perfil; un campo ausente no se modifica. */
export interface ProfileChanges {
  readonly displayName?: string;
  readonly aiConsent?: AiConsent;
  readonly outputLanguage?: OutputLanguage;
  readonly redactName?: boolean;
}

/** Perfil de un usuario nuevo: sin consentimiento para proveedores externos, salida en español y sin redactar el nombre. */
export function defaultProfile(displayName: string): Profile {
  return {
    displayName,
    aiConsent: { externalProviders: false },
    outputLanguage: 'es',
    redactName: false,
  };
}
