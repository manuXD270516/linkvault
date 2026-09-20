import {
  CV_TEXT_PREVIEW_CHARS,
  cvDeletedEvent,
  cvTextPreview,
  cvUploadedEvent,
  type CvFileType,
} from '@linkvault/shared';
import type { OutboxEvent } from '../../../../infrastructure/outbox/outbox.port';
import {
  PENDING_EXTRACTION,
  nextVersion,
  promotedAfterRemoval,
  type CvDocumentEntity,
  type CvExtractionState,
} from '../../domain/cv-document';
import { isCvId, isUserId } from '../../domain/identifier';
import type { Clock } from '../ports/clock.port';
import type { CvFileStore } from '../ports/cv-file-store.port';
import type {
  CvLimitDecision,
  CvLimitKey,
  CvLimiter,
  RefundableCvLimitKey,
} from '../ports/cv-limiter.port';
import type {
  CvRepository,
  CvTextPreviewRead,
  NewCvDocument,
} from '../ports/cv-repository.port';

// Dobles de los puertos de `cv` para los tests de casos de uso y para la app de integración del módulo (D12 de
// cv-upload-extract, tarea 6.4). No son adaptadores de producción: los reales viven en `infrastructure/`.
//
// El del almacén de objetos existe para que **ningún test hable con MinIO**: la comprobación contra el almacén real es
// un paso local del RUNBOOK. El del repositorio guarda además los eventos que el alta y el borrado escriben, porque
// esos eventos salen de la misma transacción que el documento y no se pueden observar de otra forma.

export class MovableClock implements Clock {
  constructor(public current = new Date('2026-09-12T10:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Repositorio en memoria con las mismas reglas que el de Mongo: correlatividad de la versión sin reutilizar huecos,
 * como mucho un CV marcado, promoción del más reciente al borrar el marcado, y el texto fuera de toda lectura salvo la
 * de la vista previa.
 */
export class InMemoryCvRepository implements CvRepository {
  private readonly documents = new Map<string, CvDocumentEntity>();
  private readonly texts = new Map<string, string>();
  /** Versiones ya usadas por persona, **incluidas las de los CV borrados**: los números no se reutilizan. */
  private readonly usedVersions = new Map<string, number[]>();
  private readonly events: OutboxEvent[] = [];
  private sequence = 0;
  /** Con algo distinto de `undefined`, la transacción de alta lanza ese error. */
  insertFailure: Error | undefined;

  /** Identificadores con la misma forma que los de Mongo: un `:id` mal formado tiene que comportarse igual aquí. */
  nextId(): string {
    this.sequence += 1;
    return `66e9a0${String(this.sequence).padStart(18, '0')}`;
  }

  countOf(userId: string): Promise<number> {
    return Promise.resolve(this.ownedBy(userId).length);
  }

  insertAsDefault(document: NewCvDocument): Promise<CvDocumentEntity> {
    if (this.insertFailure !== undefined) {
      return Promise.reject(this.insertFailure);
    }
    const used = this.usedVersions.get(document.userId) ?? [];
    const version = nextVersion(used);
    this.usedVersions.set(document.userId, [...used, version]);
    for (const current of this.ownedBy(document.userId)) {
      if (current.isDefault) {
        this.documents.set(current.id, { ...current, isDefault: false });
      }
    }
    const stored: CvDocumentEntity = {
      id: document.id,
      userId: document.userId,
      fileName: document.fileName,
      fileType: document.fileType,
      sizeBytes: document.sizeBytes,
      version,
      isDefault: true,
      uploadedAt: document.uploadedAt,
      extraction: PENDING_EXTRACTION,
    };
    this.documents.set(stored.id, stored);
    this.events.push(
      cvUploadedEvent({ cvId: stored.id, userId: stored.userId }),
    );
    return Promise.resolve(stored);
  }

  listByUser(userId: string): Promise<CvDocumentEntity[]> {
    return Promise.resolve(this.ownedBy(userId).sort(newestFirst));
  }

  findOwned(cvId: string, userId: string): Promise<CvDocumentEntity | null> {
    if (!isCvId(cvId) || !isUserId(userId)) {
      return Promise.resolve(null);
    }
    const document = this.documents.get(cvId);
    return Promise.resolve(
      document !== undefined && document.userId === userId ? document : null,
    );
  }

  async setDefault(cvId: string, userId: string): Promise<boolean> {
    const target = await this.findOwned(cvId, userId);
    if (target === null) {
      return false;
    }
    for (const current of this.ownedBy(userId)) {
      this.documents.set(current.id, {
        ...current,
        isDefault: current.id === cvId,
      });
    }
    return true;
  }

  async remove(cvId: string, userId: string): Promise<boolean> {
    const target = await this.findOwned(cvId, userId);
    if (target === null) {
      return false;
    }
    this.documents.delete(cvId);
    this.texts.delete(cvId);
    if (target.isDefault) {
      const promoted = promotedAfterRemoval(this.ownedBy(userId));
      if (promoted !== undefined) {
        this.documents.set(promoted.id, { ...promoted, isDefault: true });
      }
    }
    this.events.push(cvDeletedEvent({ cvId, userId }));
    return true;
  }

  async textPreviewOf(
    cvId: string,
    userId: string,
  ): Promise<CvTextPreviewRead | null> {
    const document = await this.findOwned(cvId, userId);
    if (document === null) {
      return null;
    }
    const text = this.texts.get(cvId) ?? '';
    // Como el adaptador real: se pide un carácter más que el límite, y así el corte sabe que había más.
    const preview = cvTextPreview(
      [...text].slice(0, CV_TEXT_PREVIEW_CHARS + 1).join(''),
    );
    return {
      status: document.extraction.status,
      text: preview.text,
      chars: preview.chars,
      complete:
        document.extraction.status === 'extracted' &&
        preview.chars === [...text].length,
    };
  }

  // --- Ayudas de test ---

  /** Declara el texto ya extraído de un CV y su estado, como lo dejaría el worker. */
  withExtractedText(cvId: string, text: string): this {
    const document = this.documents.get(cvId);
    if (document !== undefined) {
      this.texts.set(cvId, text);
      this.documents.set(cvId, {
        ...document,
        extraction: {
          status: 'extracted',
          textChars: [...text].length,
          extractedAt: new Date('2026-09-12T10:00:05.000Z'),
        },
      });
    }
    return this;
  }

  /** Deja el CV en el estado de extracción que se quiera probar. */
  withExtraction(cvId: string, extraction: CvExtractionState): this {
    const document = this.documents.get(cvId);
    if (document !== undefined) {
      this.documents.set(cvId, { ...document, extraction });
    }
    return this;
  }

  /** Eventos escritos en el outbox, en orden. */
  get appendedEvents(): readonly OutboxEvent[] {
    return this.events;
  }

  private ownedBy(userId: string): CvDocumentEntity[] {
    return [...this.documents.values()].filter(
      (document) => document.userId === userId,
    );
  }
}

function newestFirst(a: CvDocumentEntity, b: CvDocumentEntity): number {
  const difference = b.uploadedAt.getTime() - a.uploadedAt.getTime();
  return difference === 0 ? b.version - a.version : difference;
}

/** Almacén de objetos en memoria: apunta lo que se sube y puede fingir estar caído. */
export class InMemoryCvFileStore implements CvFileStore {
  readonly objects = new Map<string, { body: Uint8Array; fileType: CvFileType }>();
  readonly putKeys: string[] = [];
  /** Con algo distinto de `undefined`, `put` lanza ese error, como un almacén que no responde. */
  failure: Error | undefined;

  put(key: string, body: Uint8Array, fileType: CvFileType): Promise<void> {
    this.putKeys.push(key);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    this.objects.set(key, { body, fileType });
    return Promise.resolve();
  }
}

/** Contador en memoria con las tres claves separadas, sus devoluciones y la opción de estar caído. */
export class InMemoryCvLimiter implements CvLimiter {
  private readonly counts = new Map<string, number>();
  private readonly limits = new Map<string, number>();
  readonly refunds: string[] = [];
  /** Con `true`, el contador no responde: las tres claves fallan **abiertas**. */
  down = false;

  /** Cuántos intentos caben en esa clave; por defecto, muchos. */
  allow(kind: CvLimitKey['kind'], limit: number): this {
    this.limits.set(kind, limit);
    return this;
  }

  consume(key: CvLimitKey): Promise<CvLimitDecision> {
    if (this.down) {
      return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
    }
    const name = nameOf(key);
    const count = (this.counts.get(name) ?? 0) + 1;
    this.counts.set(name, count);
    const limit = this.limits.get(key.kind) ?? Number.MAX_SAFE_INTEGER;
    return Promise.resolve(
      count <= limit
        ? { allowed: true, retryAfterSeconds: 0 }
        : { allowed: false, retryAfterSeconds: 900 },
    );
  }

  refund(key: RefundableCvLimitKey): Promise<void> {
    const name = nameOf(key);
    this.refunds.push(name);
    this.counts.set(name, Math.max(0, (this.counts.get(name) ?? 0) - 1));
    return Promise.resolve();
  }

  /** Intentos contados en esa clave ahora mismo. */
  countOf(key: CvLimitKey): number {
    return this.counts.get(nameOf(key)) ?? 0;
  }
}

function nameOf(key: CvLimitKey): string {
  return `cv:${key.kind}:${key.userId}`;
}
