import type {
  MeiliSearchClient,
  MeiliSearchHit,
  MeiliSearchQuery,
  MeiliSearchResult,
  SearchIndexDocument,
} from '../application/ports/meili-search-client.port';

// Fake in-memory Meili para tests unitarios (task 4.2 / 5.1). Sin red.

export class InMemoryMeiliSearchClient implements MeiliSearchClient {
  readonly configured: boolean;
  readonly documents = new Map<string, SearchIndexDocument>();
  healthyFlag = true;
  failNextWrite = false;
  deleteByFilterCalls: string[] = [];
  searchCalls: MeiliSearchQuery[] = [];

  constructor(configured = true) {
    this.configured = configured;
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(this.configured && this.healthyFlag);
  }

  ensureIndex(): Promise<void> {
    return Promise.resolve();
  }

  upsert(documents: readonly SearchIndexDocument[]): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error('meili upsert failed'));
    }
    for (const doc of documents) {
      this.documents.set(doc.id, doc);
    }
    return Promise.resolve();
  }

  delete(ids: readonly string[]): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error('meili delete failed'));
    }
    for (const id of ids) {
      this.documents.delete(id);
    }
    return Promise.resolve();
  }

  deleteByFilter(filter: string): Promise<void> {
    this.deleteByFilterCalls.push(filter);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error('meili deleteByFilter failed'));
    }
    if (!this.healthyFlag) {
      return Promise.reject(new Error('meili unavailable'));
    }
    const ownerMatch = /ownerUserId\s*=\s*"([^"]+)"/.exec(filter);
    const groupMatch = /groupIds\s*=\s*"([^"]+)"/.exec(filter);
    for (const [id, doc] of [...this.documents.entries()]) {
      if (ownerMatch !== null && doc.ownerUserId === ownerMatch[1]) {
        this.documents.delete(id);
        continue;
      }
      if (groupMatch !== null && doc.groupIds.includes(groupMatch[1])) {
        this.documents.delete(id);
      }
    }
    return Promise.resolve();
  }

  search(query: MeiliSearchQuery): Promise<MeiliSearchResult> {
    this.searchCalls.push(query);
    if (!this.healthyFlag) {
      return Promise.reject(new Error('meili unavailable'));
    }
    const q = query.q.trim().toLowerCase();
    const all = [...this.documents.values()].filter((doc) =>
      matchesSearchFilter(doc, query.filter),
    );
    const matched = all.filter((doc) => {
      if (q.length === 0) return false;
      const hay = [
        doc.title,
        doc.company,
        doc.description,
        doc.body,
        doc.note,
        doc.notes,
        doc.text,
        doc.stepsText,
        ...(doc.skills ?? []),
      ]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
    const page = matched.slice(query.offset, query.offset + query.limit);
    const hits: MeiliSearchHit[] = page.map((doc) => ({
      id: doc.id,
      docType: doc.docType,
      score: 1,
      ...(doc.title === undefined ? {} : { title: doc.title }),
      ...(doc.body === undefined ? {} : { body: doc.body }),
      ...(doc.note === undefined ? {} : { note: doc.note }),
      ...(doc.notes === undefined ? {} : { notes: doc.notes }),
      ...(doc.text === undefined ? {} : { text: doc.text }),
      ...(doc.description === undefined ? {} : { description: doc.description }),
      ...(doc.linkId === undefined ? {} : { linkId: doc.linkId }),
      ...(doc.groupId === undefined ? {} : { groupId: doc.groupId }),
      ...(doc.applicationId === undefined
        ? {}
        : { applicationId: doc.applicationId }),
      ...(doc.cvId === undefined ? {} : { cvId: doc.cvId }),
      ...(doc.roadmapId === undefined ? {} : { roadmapId: doc.roadmapId }),
      ...(doc.analysisId === undefined ? {} : { analysisId: doc.analysisId }),
    }));
    return Promise.resolve({ hits, estimatedTotal: matched.length });
  }
}

function matchesSearchFilter(doc: SearchIndexDocument, filter: string): boolean {
  if (!matchesEqualityFilters(doc, filter)) {
    return false;
  }
  if (!matchesIsNullFilters(doc, filter)) {
    return false;
  }
  if (!matchesSalaryRangeFilters(doc, filter)) {
    return false;
  }
  return matchesAclFilter(doc, filter);
}

/**
 * `attr IS NULL` del builder openOnly: en este fake equivale a clave ausente
 * (`doc.closedAt === undefined`), alineado al loader que nunca escribe `null`.
 * (Los IS NULL de salaryMin/Max se evalúan en `matchesSalaryRangeFilters`.)
 */
function matchesIsNullFilters(
  doc: SearchIndexDocument,
  filter: string,
): boolean {
  if (!/\bclosedAt\s+IS\s+NULL\b/i.test(filter)) {
    return true;
  }
  return doc.closedAt === undefined;
}

/**
 * Solape D1 / ADR-040. Evalúa comparaciones `>=` / `<=` e `IS NULL` sobre
 * salaryMin/salaryMax (null o ausente = NULL). Docs sin ningún número fallan.
 */
function matchesSalaryRangeFilters(
  doc: SearchIndexDocument,
  filter: string,
): boolean {
  const minMatch = /\(\(salaryMax\s*>=\s*(\d+)\)\s*OR\s*\(salaryMax\s+IS\s+NULL\s+AND\s+salaryMin\s*>=\s*\1\)\)/i.exec(
    filter,
  );
  if (minMatch !== null) {
    const m = Number(minMatch[1]);
    if (!evalMinSalaryOverlap(doc, m)) {
      return false;
    }
  }
  const maxMatch = /\(\(salaryMin\s*<=\s*(\d+)\)\s*OR\s*\(salaryMin\s+IS\s+NULL\s+AND\s+salaryMax\s*<=\s*\1\)\)/i.exec(
    filter,
  );
  if (maxMatch !== null) {
    const x = Number(maxMatch[1]);
    if (!evalMaxSalaryOverlap(doc, x)) {
      return false;
    }
  }
  return true;
}

function salaryField(
  doc: SearchIndexDocument,
  attr: 'salaryMin' | 'salaryMax',
): number | null {
  const value = doc[attr];
  return typeof value === 'number' ? value : null;
}

/** minSalary=M → (salaryMax >= M) OR (salaryMax IS NULL AND salaryMin >= M) */
function evalMinSalaryOverlap(doc: SearchIndexDocument, m: number): boolean {
  const max = salaryField(doc, 'salaryMax');
  const min = salaryField(doc, 'salaryMin');
  if (max !== null && max >= m) {
    return true;
  }
  return max === null && min !== null && min >= m;
}

/** maxSalary=X → (salaryMin <= X) OR (salaryMin IS NULL AND salaryMax <= X) */
function evalMaxSalaryOverlap(doc: SearchIndexDocument, x: number): boolean {
  const min = salaryField(doc, 'salaryMin');
  const max = salaryField(doc, 'salaryMax');
  if (min !== null && min <= x) {
    return true;
  }
  return min === null && max !== null && max <= x;
}

/** Igualdades AND del builder (docType / modality / status / salaryCurrency). */
function matchesEqualityFilters(
  doc: SearchIndexDocument,
  filter: string,
): boolean {
  const checks: ReadonlyArray<{
    readonly attr: string;
    readonly value: string | undefined;
  }> = [
    { attr: 'modality', value: doc.modality },
    { attr: 'status', value: doc.status },
    { attr: 'salaryCurrency', value: doc.salaryCurrency },
  ];
  for (const { attr, value } of checks) {
    const required = equalityValue(filter, attr);
    if (required !== undefined && required !== value) {
      return false;
    }
  }
  // docType = "…" (no confundir con docType IN […])
  const docTypeEq = /(?:^|[^I])\s*docType\s*=\s*"([^"]+)"/.exec(
    filter.replace(/docType\s+IN\s*\[[^\]]*]/g, ''),
  );
  if (docTypeEq !== null && docTypeEq[1] !== doc.docType) {
    return false;
  }
  return true;
}

function equalityValue(filter: string, attr: string): string | undefined {
  const re = new RegExp(`(?:^|[\\s(])${attr}\\s*=\\s*"([^"]+)"`);
  const match = re.exec(filter);
  return match?.[1];
}

function matchesAclFilter(doc: SearchIndexDocument, filter: string): boolean {
  // Filtros simplificados para tests: comprueba ownerUserId y/o groupIds + visibilityScope.
  if (filter.includes(`ownerUserId = "${doc.ownerUserId}"`)) {
    if (
      doc.visibilityScope === 'owner' ||
      doc.visibilityScope === 'owner_and_groups'
    ) {
      return true;
    }
  }
  for (const groupId of doc.groupIds) {
    if (
      filter.includes(`groupIds = "${groupId}"`) &&
      (doc.visibilityScope === 'group' ||
        doc.visibilityScope === 'owner_and_groups')
    ) {
      const groupDocs = ['job_preview', 'group_comment', 'group_link_note'];
      if (groupDocs.includes(doc.docType)) {
        return true;
      }
    }
  }
  return false;
}
