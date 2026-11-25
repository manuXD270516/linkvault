import type { Platform, PreviewStatus } from '@linkvault/shared';

// Puerto hacia `links` (D1 de applications-tracking). `applications` NO lee las colecciones de links: el adaptador de
// producción va sobre `LinksFacade`, su única entrada pública. Cada método es una sola consulta. Solo tipos y el token.

export const APPLICATION_LINKS = Symbol('APPLICATION_LINKS');

/** Ficha de un link para pintar la tarjeta del tablero, sin contexto de grupo (ADR-024 §5). */
export interface LinkCard {
  readonly id: string;
  readonly displayUrl: string;
  readonly platform: Platform;
  readonly previewStatus: PreviewStatus;
  readonly title?: string;
  readonly company?: string;
}

/**
 * Señales de un link para «Tu semana» (D7 de weekly-plan): la ficha mínima, si el link está cerrado, su `expiresAt`
 * (`YYYY-MM-DD`, ausente si no hay) y el **conteo** de «conozco a alguien». El tipo no tiene userIds ni nombres.
 */
export interface LinkPlanSignals {
  readonly id: string;
  readonly displayUrl: string;
  readonly title?: string;
  readonly company?: string;
  readonly closed: boolean;
  readonly expiresAt?: string;
  readonly knowSomeoneCount: number;
  readonly knowSomeoneGroupId?: string;
}

export interface ApplicationLinks {
  /** `true` si la persona ve el link (lista privada o grupo suyo). Un id mal formado responde `false`. */
  canRead(userId: string, linkId: string): Promise<boolean>;
  /** Fichas de esos links, en una sola consulta; los que no existen o están mal formados no aportan nada. */
  cardsOf(linkIds: readonly string[]): Promise<LinkCard[]>;
  /** De esos links, cuáles están compartidos ahora en el grupo, en una sola consulta. */
  linkIdsSharedIn(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<Set<string>>;
  /**
   * Señales de plan de esos links para `userId`, **una sola llamada** a `LinksFacade.planSignalsOf` sea cual sea el número
   * de links (C10 de weekly-plan). Por link trae la ficha, `closed`, `expiresAt` y `knowSomeoneCount`, que es el conteo
   * del grupo de `userId` con más marcas de **otras** personas (sin contarle), con su `knowSomeoneGroupId`. Nunca trae
   * identidades: ni ids ni nombres de quienes marcaron. Los links que no existen o están mal formados no aparecen.
   */
  planSignalsOf(
    userId: string,
    linkIds: readonly string[],
  ): Promise<ReadonlyMap<string, LinkPlanSignals>>;
}
