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
}
