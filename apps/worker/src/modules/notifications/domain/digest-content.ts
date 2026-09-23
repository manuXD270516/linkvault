import { GROUP_DIGEST_MAX_TITLES } from '@linkvault/shared';

/** Fila cruda de group_links en la ventana (sin note en la proyección de digest). */
export interface DigestLinkRow {
  readonly linkId: string;
  readonly sharedAt: Date;
  readonly title: string | null;
}

export interface DigestLinkItem {
  readonly linkId: string;
  readonly title: string;
  readonly sharedAt: Date;
}

export interface GroupDigestAggregate {
  readonly items: readonly DigestLinkItem[];
  /** Cuántos quedan tras el tope de títulos. */
  readonly moreCount: number;
  readonly totalInWindow: number;
}

/**
 * Agrega títulos para el email: máx N, sharedAt desc, sin notes.
 * Filas sin título usable se omiten del listado visible pero cuentan en total.
 */
export function aggregateDigestLinks(
  rows: readonly DigestLinkRow[],
  maxTitles: number = GROUP_DIGEST_MAX_TITLES,
): GroupDigestAggregate {
  const sorted = [...rows].sort(
    (a, b) => b.sharedAt.getTime() - a.sharedAt.getTime(),
  );
  const withTitle: DigestLinkItem[] = [];
  for (const row of sorted) {
    const title = row.title?.trim() ?? '';
    if (title.length === 0) {
      continue;
    }
    withTitle.push({
      linkId: row.linkId,
      title,
      sharedAt: row.sharedAt,
    });
  }
  const items = withTitle.slice(0, maxTitles);
  const moreCount = Math.max(0, withTitle.length - items.length);
  return {
    items,
    moreCount,
    totalInWindow: sorted.length,
  };
}

/** ¿Hay algo que notificar? Vacío o solo sin título → no email. */
export function digestHasContent(agg: GroupDigestAggregate): boolean {
  return agg.items.length > 0;
}
