import type { RoadmapItem, RoadmapStatus } from '@linkvault/shared';

// Entidad del roadmap de estudio (study-roadmap). Sin Nest ni Mongo: solo el agregado y el claim.

export interface StudyRoadmap {
  readonly id: string;
  readonly analysisId: string;
  readonly userId: string;
  readonly status: RoadmapStatus;
  /** Solo con `status: 'ready'`. */
  readonly items?: readonly RoadmapItem[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewGeneratingRoadmap {
  readonly id: string;
  readonly analysisId: string;
  readonly userId: string;
  readonly createdAt: Date;
}

/** Claim inicial: `generating`, sin ítems. */
export function createGeneratingRoadmap(
  params: NewGeneratingRoadmap,
): StudyRoadmap {
  return {
    id: params.id,
    analysisId: params.analysisId,
    userId: params.userId,
    status: 'generating',
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  };
}

/** Markdown exportable del plan listo (sin llamar al modelo). */
export function roadmapToMarkdown(roadmap: StudyRoadmap): string {
  if (roadmap.status !== 'ready' || roadmap.items === undefined) {
    throw new Error('Only a ready roadmap can be exported as markdown');
  }
  const lines: string[] = ['# Study roadmap', ''];
  const byWeek = [...roadmap.items].sort(
    (a, b) => a.priority - b.priority || a.estimatedWeeks - b.estimatedWeeks,
  );
  for (const item of byWeek) {
    lines.push(`## ${item.skill} (priority ${String(item.priority)})`);
    lines.push('');
    lines.push(`Estimated weeks: ${String(item.estimatedWeeks)}`);
    lines.push('');
    for (const resource of item.resources) {
      const verified = resource.verified ? 'verified' : 'unverified';
      const link =
        resource.url === null ? resource.title : `[${resource.title}](${resource.url})`;
      lines.push(
        `- ${link} — ${resource.type}, ${resource.provider}, ${resource.free ? 'free' : 'paid'}, ${verified}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
