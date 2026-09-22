import {
  searchDocumentId,
  type SearchDocType,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import type { SearchAggregateLoader } from '../application/ports/search-aggregate-loader.port';
import type {
  SearchIndexDocument,
  SearchVisibilityScope,
} from '../application/ports/meili-search-client.port';

/**
 * Carga agregados desde Mongo y materializa ACL (groupIds / visibilityScope) — D4 / C1.
 */
@Injectable()
export class MongoSearchAggregateLoader implements SearchAggregateLoader {
  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
  ) {}

  async load(
    docType: SearchDocType,
    aggregateId: string,
  ): Promise<SearchIndexDocument | null> {
    switch (docType) {
      case 'job_preview':
        return this.loadJobPreview(aggregateId);
      case 'application':
        return this.loadApplication(aggregateId);
      case 'group_comment':
        return this.loadComment(aggregateId);
      case 'group_link_note':
        return this.loadNote(aggregateId);
      case 'cv':
        return this.loadCv(aggregateId);
      case 'roadmap':
        return this.loadRoadmap(aggregateId);
      default:
        return null;
    }
  }

  private async loadJobPreview(
    linkId: string,
  ): Promise<SearchIndexDocument | null> {
    const oid = toObjectId(linkId);
    if (oid === null) return null;
    const link = await this.connection.collection('job_links').findOne({
      _id: oid,
    });
    if (link === null) return null;

    const relations = await this.connection
      .collection('group_links')
      .find({ linkId: oid })
      .toArray();
    const groupIds = relations.map((r) => String(r['groupId']));
    const ownerUserId = String(link['createdBy'] ?? '');
    const visibilityScope = scopeForPreview(groupIds);
    const preview = (link['preview'] ?? {}) as Record<string, unknown>;
    const skills = Array.isArray(preview['skills'])
      ? (preview['skills'] as { name?: string }[])
          .map((s) => s.name)
          .filter((n): n is string => typeof n === 'string')
      : [];
    const salary = preview['salary'] as
      | { min?: number | null; max?: number | null; currency?: string | null }
      | undefined;
    const salaryText =
      salary === undefined
        ? undefined
        : [salary.min, salary.max, salary.currency]
            .filter((v) => v !== null && v !== undefined)
            .join(' ');

    return {
      id: searchDocumentId('job_preview', linkId),
      docType: 'job_preview',
      ownerUserId,
      groupIds,
      visibilityScope,
      updatedAt: dateMs(link['updatedAt'] ?? link['createdAt']),
      embeddingStatus: 'missing',
      linkId,
      ...(typeof preview['title'] === 'string'
        ? { title: preview['title'] }
        : {}),
      ...(typeof preview['company'] === 'string'
        ? { company: preview['company'] }
        : {}),
      ...(typeof preview['summary'] === 'string'
        ? { description: preview['summary'] }
        : typeof preview['description'] === 'string'
          ? { description: preview['description'] }
          : {}),
      ...(skills.length > 0 ? { skills } : {}),
      ...(typeof preview['location'] === 'string'
        ? { location: preview['location'] }
        : {}),
      ...(typeof preview['modality'] === 'string'
        ? { modality: preview['modality'] }
        : {}),
      ...(salaryText === undefined || salaryText.length === 0
        ? {}
        : { salaryText }),
    };
  }

  private async loadApplication(
    applicationId: string,
  ): Promise<SearchIndexDocument | null> {
    const oid = toObjectId(applicationId);
    if (oid === null) return null;
    const app = await this.connection.collection('applications').findOne({
      _id: oid,
    });
    if (app === null) return null;
    return {
      id: searchDocumentId('application', applicationId),
      docType: 'application',
      ownerUserId: String(app['userId']),
      groupIds: [],
      visibilityScope: 'owner',
      updatedAt: dateMs(app['updatedAt'] ?? app['statusChangedAt']),
      embeddingStatus: 'missing',
      applicationId,
      linkId: String(app['linkId']),
      ...(typeof app['status'] === 'string' ? { status: app['status'] } : {}),
      ...(typeof app['stageLabel'] === 'string'
        ? { stageLabel: app['stageLabel'] }
        : {}),
      ...(typeof app['notes'] === 'string' ? { notes: app['notes'] } : {}),
      title: String(app['stageLabel'] ?? app['status'] ?? 'Application'),
    };
  }

  private async loadComment(
    commentId: string,
  ): Promise<SearchIndexDocument | null> {
    const oid = toObjectId(commentId);
    if (oid === null) return null;
    const comment = await this.connection
      .collection('group_link_comments')
      .findOne({ _id: oid });
    if (comment === null) return null;
    const groupId = String(comment['groupId']);
    return {
      id: searchDocumentId('group_comment', commentId),
      docType: 'group_comment',
      ownerUserId: String(comment['authorId'] ?? comment['userId']),
      groupIds: [groupId],
      visibilityScope: 'group',
      updatedAt: dateMs(comment['createdAt']),
      embeddingStatus: 'missing',
      groupId,
      linkId: String(comment['linkId']),
      body: String(comment['text'] ?? ''),
      title: String(comment['text'] ?? '').slice(0, 80),
    };
  }

  private async loadNote(
    relationKey: string,
  ): Promise<SearchIndexDocument | null> {
    // aggregateId = `${groupId}_${linkId}`
    const [groupId, linkId] = splitRelationKey(relationKey);
    if (groupId === undefined || linkId === undefined) return null;
    const gOid = toObjectId(groupId);
    const lOid = toObjectId(linkId);
    if (gOid === null || lOid === null) return null;
    const relation = await this.connection.collection('group_links').findOne({
      groupId: gOid,
      linkId: lOid,
    });
    if (relation === null) return null;
    const note = relation['note'] as
      | { text?: string; authorId?: string }
      | undefined;
    if (note === undefined || typeof note.text !== 'string') return null;
    return {
      id: searchDocumentId('group_link_note', relationKey),
      docType: 'group_link_note',
      ownerUserId: String(note.authorId ?? relation['sharedBy']),
      groupIds: [groupId],
      visibilityScope: 'group',
      updatedAt: dateMs(relation['sharedAt']),
      embeddingStatus: 'missing',
      groupId,
      linkId,
      note: note.text,
      title: note.text.slice(0, 80),
    };
  }

  private async loadCv(cvId: string): Promise<SearchIndexDocument | null> {
    const oid = toObjectId(cvId);
    if (oid === null) return null;
    const cv = await this.connection.collection('cv_documents').findOne({
      _id: oid,
    });
    if (cv === null) return null;
    const extraction = (cv['extraction'] ?? {}) as {
      skills?: string[];
    };
    const extractedText =
      typeof cv['extractedText'] === 'string' ? cv['extractedText'] : undefined;
    return {
      id: searchDocumentId('cv', cvId),
      docType: 'cv',
      ownerUserId: String(cv['userId']),
      groupIds: [],
      visibilityScope: 'owner',
      updatedAt: dateMs(cv['uploadedAt']),
      embeddingStatus: 'missing',
      cvId,
      ...(extractedText === undefined ? {} : { text: extractedText }),
      ...(Array.isArray(extraction.skills)
        ? { skills: extraction.skills }
        : {}),
      title: String(cv['fileName'] ?? 'CV'),
    };
  }

  private async loadRoadmap(
    roadmapId: string,
  ): Promise<SearchIndexDocument | null> {
    const oid = toObjectId(roadmapId);
    if (oid === null) return null;
    const roadmap = await this.connection.collection('roadmaps').findOne({
      _id: oid,
    });
    if (roadmap === null) return null;
    if (roadmap['status'] !== 'ready') return null;
    const items = Array.isArray(roadmap['items'])
      ? (roadmap['items'] as {
          skill?: string;
          resources?: { title?: string; provider?: string }[];
        }[])
      : [];
    const stepsText = items
      .map((item) => {
        const resources = (item.resources ?? [])
          .map((r) => [r.title, r.provider].filter(Boolean).join(' '))
          .join('; ');
        return [item.skill, resources].filter(Boolean).join(': ');
      })
      .join('\n');
    return {
      id: searchDocumentId('roadmap', roadmapId),
      docType: 'roadmap',
      ownerUserId: String(roadmap['userId']),
      groupIds: [],
      visibilityScope: 'owner',
      updatedAt: dateMs(roadmap['updatedAt'] ?? roadmap['createdAt']),
      embeddingStatus: 'missing',
      roadmapId,
      analysisId:
        roadmap['analysisId'] === undefined
          ? undefined
          : String(roadmap['analysisId']),
      title: items[0]?.skill ?? 'Roadmap',
      ...(stepsText.length > 0 ? { stepsText } : {}),
    };
  }
}

function scopeForPreview(groupIds: readonly string[]): SearchVisibilityScope {
  if (groupIds.length === 0) return 'owner';
  return 'owner_and_groups';
}

function toObjectId(id: string): Types.ObjectId | null {
  if (!Types.ObjectId.isValid(id)) return null;
  return new Types.ObjectId(id);
}

function dateMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : Date.now();
  }
  return Date.now();
}

function splitRelationKey(
  key: string,
): [string | undefined, string | undefined] {
  const idx = key.indexOf('_');
  if (idx <= 0) return [undefined, undefined];
  return [key.slice(0, idx), key.slice(idx + 1)];
}
