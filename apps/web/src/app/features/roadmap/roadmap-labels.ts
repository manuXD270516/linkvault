import type { RoadmapItem, RoadmapResourceType } from '@linkvault/shared';

/** Etiqueta de tipo de recurso (i18n en código, como match-badge). */
export function roadmapResourceTypeLabel(type: RoadmapResourceType): string {
  switch (type) {
    case 'course':
      return $localize`:@@roadmap.resource.course:Curso`;
    case 'post':
      return $localize`:@@roadmap.resource.post:Artículo`;
    case 'book':
      return $localize`:@@roadmap.resource.book:Libro`;
    case 'doc':
      return $localize`:@@roadmap.resource.doc:Documentación`;
    case 'video':
      return $localize`:@@roadmap.resource.video:Vídeo`;
  }
}

/**
 * Agrupa ítems por semanas estimadas (vista por semanas, spec web/roadmap).
 * Dentro de cada semana, respeta el orden ya priorizado.
 */
export function groupItemsByWeeks(
  items: readonly RoadmapItem[],
): ReadonlyArray<{ weeks: number; items: RoadmapItem[] }> {
  const groups = new Map<number, RoadmapItem[]>();
  for (const item of items) {
    const key = item.estimatedWeeks;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [item]);
    } else {
      bucket.push(item);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weeks, groupItems]) => ({ weeks, items: groupItems }));
}
