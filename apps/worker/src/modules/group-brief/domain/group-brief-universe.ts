// Universo canónico del cálculo (design D3, D13): solo datos de las ofertas, nunca de quién las compartió.
// Está en el orden del universo: `sharedAt` desc y, a igualdad, `id` desc. Ningún campo de miembro, nota ni etiqueta.

export interface UniverseOffer {
  /** Id opaco de la oferta (el `linkId` en hexadecimal). */
  readonly id: string;
  /** Instante ISO en que se compartió en el grupo. */
  readonly sharedAt: string;
  /** Instante ISO del cierre detectado, o `null` si sigue abierta. */
  readonly closedAt: string | null;
  /** `YYYY-MM-DD` de vencimiento, o `null` si no lo dice. */
  readonly expiresAt: string | null;
  /** Nombres de habilidad ya validados con `jobSkillSchema`; la normalización la hace el cálculo. */
  readonly skills: readonly string[];
}

export interface GroupBriefUniverse {
  /** Fecha UTC del cálculo, `YYYY-MM-DD`. */
  readonly asOf: string;
  /** Hasta `GROUP_BRIEF_SCAN_MAX + 1` ofertas: la de más sirve para saber que hubo más. */
  readonly offers: readonly UniverseOffer[];
}
