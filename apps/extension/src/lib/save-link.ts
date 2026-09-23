/**
 * Cuerpo de `POST /api/links` desde la extensión: privado por defecto (sin `groupId`).
 * Sin `note` en v1 (design Non-Goals).
 */
export interface SaveLinkRequestBody {
  url: string;
  groupId?: string;
}

export function buildSaveLinkRequest(
  url: string,
  groupId?: string | null,
): SaveLinkRequestBody {
  const trimmed = url.trim();
  if (groupId === undefined || groupId === null || groupId === '') {
    return { url: trimmed };
  }
  return { url: trimmed, groupId };
}

/** Fragmento de `SaveLinkResponse` que el popup necesita para el copy. */
export interface SaveLinkOutcomeInput {
  shared: 'created' | 'already_there';
  sharedBy?: { displayName: string };
  alreadyInGroups: ReadonlyArray<{ name: string }>;
}

export type SaveOutcomeKind = 'saved' | 'already_there';

export interface SaveOutcomeView {
  kind: SaveOutcomeKind;
  /** Clave i18n principal (sin prometer preview enriquecido). */
  primaryMessageKey:
    | 'saveSuccess'
    | 'saveAlreadyThere'
    | 'saveAlreadyThereNamed';
  sharerName?: string;
  alreadyInGroupNames: string[];
}

/**
 * Mapea la respuesta de guardado a copy de UI. `already_there` se distingue de un alta nueva;
 * no se afirma que el JobPreview esté listo.
 */
export function mapSaveOutcome(response: SaveLinkOutcomeInput): SaveOutcomeView {
  const alreadyInGroupNames = response.alreadyInGroups.map((group) => group.name);
  if (response.shared === 'already_there') {
    const sharerName = response.sharedBy?.displayName;
    return {
      kind: 'already_there',
      primaryMessageKey:
        sharerName === undefined ? 'saveAlreadyThere' : 'saveAlreadyThereNamed',
      sharerName,
      alreadyInGroupNames,
    };
  }
  return {
    kind: 'saved',
    primaryMessageKey: 'saveSuccess',
    alreadyInGroupNames,
  };
}
