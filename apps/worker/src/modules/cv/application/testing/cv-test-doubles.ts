import type {
  CvExtractionFailureReason,
  CvFileType,
} from '@linkvault/shared';
import type { Clock } from '../ports/clock.port';
import type { CvFileReader } from '../ports/cv-file-reader.port';
import type {
  CvRepository,
  CvToExtract,
  ExtractedCvText,
} from '../ports/cv-repository.port';
import type {
  CvTextExtractor,
  CvTextExtractors,
  ExtractionAttempt,
} from '../ports/cv-text-extractors.port';

// Dobles de los puertos del módulo `cv` del worker. No son adaptadores de producción: los reales viven en
// `infrastructure/`, y el del almacén es lo que permite probar los cuatro cortes de idempotencia sin un almacén S3.

export class MovableClock implements Clock {
  constructor(public current = new Date('2026-09-12T10:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Repositorio en memoria con la misma escritura condicionada que el de Mongo. */
export class InMemoryCvRepository implements CvRepository {
  private readonly documents = new Map<string, CvToExtract>();
  readonly texts = new Map<string, ExtractedCvText>();
  readonly failures = new Map<string, CvExtractionFailureReason>();
  /** Con algo distinto de `undefined`, toda lectura lanza: la base no responde. */
  readFailure: Error | undefined;

  withCv(
    id: string,
    overrides: Partial<CvToExtract> = {},
  ): this {
    this.documents.set(id, {
      id,
      userId: '66e9a0000000000000000a01',
      fileType: 'pdf',
      status: 'pending',
      ...overrides,
    });
    return this;
  }

  findById(cvId: string): Promise<CvToExtract | null> {
    if (this.readFailure !== undefined) {
      return Promise.reject(this.readFailure);
    }
    return Promise.resolve(this.documents.get(cvId) ?? null);
  }

  saveExtractedText(
    cvId: string,
    result: ExtractedCvText,
  ): Promise<boolean> {
    return Promise.resolve(
      this.resolve(cvId, () => {
        this.texts.set(cvId, result);
      }),
    );
  }

  saveFailure(
    cvId: string,
    reason: CvExtractionFailureReason,
  ): Promise<boolean> {
    return Promise.resolve(
      this.resolve(cvId, () => {
        this.failures.set(cvId, reason);
      }),
    );
  }

  /** Estado actual de un CV, para comprobar que el job no tocó nada cuando no debía. */
  statusOf(cvId: string): CvToExtract['status'] | undefined {
    return this.documents.get(cvId)?.status;
  }

  /** Escritura condicionada: solo cambia lo que sigue en `pending`. */
  private resolve(cvId: string, write: () => void): boolean {
    const document = this.documents.get(cvId);
    if (document === undefined || document.status !== 'pending') {
      return false;
    }
    write();
    this.documents.set(cvId, {
      ...document,
      status: this.texts.has(cvId) ? 'extracted' : 'failed',
    });
    return true;
  }
}

/** Almacén en memoria que distingue "no está" de "no responde", que es el corte de idempotencia que importa. */
export class InMemoryCvFileReader implements CvFileReader {
  readonly objects = new Map<string, Uint8Array>();
  readonly removed: string[] = [];
  /** Con algo distinto de `undefined`, leer y borrar lanzan: el almacén no responde. */
  failure: Error | undefined;

  withObject(key: string, bytes: Uint8Array): this {
    this.objects.set(key, bytes);
    return this;
  }

  read(key: string): Promise<Uint8Array | null> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  remove(key: string): Promise<void> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    this.removed.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/** Extractor que responde lo que se le diga; con `never`, no termina nunca (para probar el plazo). */
export class StubExtractor implements CvTextExtractor {
  constructor(
    private readonly outcome: ExtractionAttempt | 'never' | Error,
  ) {}

  extract(): Promise<ExtractionAttempt> {
    if (this.outcome === 'never') {
      return new Promise(() => {
        // A propósito: no resuelve nunca, para que venza el plazo.
      });
    }
    if (this.outcome instanceof Error) {
      return Promise.reject(this.outcome);
    }
    return Promise.resolve(this.outcome);
  }
}

/** Tabla de extractores con el mismo doble para los dos formatos, o uno distinto por formato. */
export function extractorsOf(
  pdf: CvTextExtractor,
  docx: CvTextExtractor = pdf,
): CvTextExtractors {
  return { pdf, docx } satisfies Readonly<Record<CvFileType, CvTextExtractor>>;
}
