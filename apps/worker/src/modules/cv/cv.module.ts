import { type DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_CONFIG } from '../../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { DeleteCvFileUseCase } from './application/delete-cv-file.usecase';
import { ExtractCvUseCase } from './application/extract-cv.usecase';
import { CV_CLOCK, type Clock } from './application/ports/clock.port';
import {
  CV_FILE_READER,
  type CvFileReader,
} from './application/ports/cv-file-reader.port';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './application/ports/cv-repository.port';
import {
  CV_TEXT_EXTRACTORS,
  type CvTextExtractors,
} from './application/ports/cv-text-extractors.port';
import { DocxTextExtractor } from './infrastructure/extractors/docx-text.extractor';
import { PdfTextExtractor } from './infrastructure/extractors/pdf-text.extractor';
import {
  CV_DOCUMENT_MODEL_NAME,
  cvDocumentSchema,
} from './infrastructure/persistence/cv.schemas';
import { MongoCvRepository } from './infrastructure/persistence/mongo-cv.repository';
import { DeleteCvFileConsumer } from './infrastructure/queue/delete-cv-file.consumer';
import { ExtractCvConsumer } from './infrastructure/queue/extract-cv.consumer';
import {
  S3CvFileReader,
  createS3CvObjectClient,
} from './infrastructure/storage/s3-cv-file.reader';
import { SystemClock } from './infrastructure/system-clock';

// Módulo `cv` del worker (ADR-028 §7 y §8): la lectura del CV y el borrado de su archivo, cada una con su cola.
//
// **Los consumidores no se registran en los tests.** Un `Worker` abre conexión a Redis nada más crearse, y la suite
// del worker no tiene ninguno: todo lo demás del módulo sí se construye, así que los tests de inyección siguen
// comprobando que el grafo resuelve. Es la misma decisión que tomó `EnrichmentModule`.
//
// **`@linkvault/ai` no entra aquí.** Este change no manda ningún CV a ninguna IA, ni entero ni en fragmentos, y un
// test de imports lo comprueba. El texto se queda en MongoDB a la espera del change que sí lo use, con su
// consentimiento y su redacción de datos personales.

@Module({})
export class CvModule {
  static register(config: WorkerConfig): DynamicModule {
    // `NODE_ENV=test` es lo único que apaga los consumidores: es la diferencia entre "el proceso existe para consumir"
    // y "la suite no habla con Redis".
    const consumersEnabled = config.NODE_ENV !== 'test';

    return {
      module: CvModule,
      imports: [
        MongooseModule.forFeature([
          { name: CV_DOCUMENT_MODEL_NAME, schema: cvDocumentSchema },
        ]),
      ],
      providers: [
        { provide: CV_CLOCK, useClass: SystemClock },
        { provide: CV_REPOSITORY, useClass: MongoCvRepository },
        {
          provide: CV_FILE_READER,
          inject: [APP_CONFIG],
          useFactory: (worker: WorkerConfig) =>
            new S3CvFileReader(
              createS3CvObjectClient({
                endpoint: worker.S3_ENDPOINT,
                region: worker.S3_REGION,
                accessKey: worker.S3_ACCESS_KEY,
                secretKey: worker.S3_SECRET_KEY,
                bucket: worker.S3_BUCKET,
              }),
            ),
        },
        {
          // Un extractor por formato. Que la tabla los cubra todos lo garantiza el tipo del puerto.
          provide: CV_TEXT_EXTRACTORS,
          useFactory: (): CvTextExtractors => ({
            pdf: new PdfTextExtractor(),
            docx: new DocxTextExtractor(),
          }),
        },
        {
          provide: ExtractCvUseCase,
          inject: [CV_REPOSITORY, CV_FILE_READER, CV_TEXT_EXTRACTORS, CV_CLOCK, APP_CONFIG],
          useFactory: (
            repository: CvRepository,
            files: CvFileReader,
            extractors: CvTextExtractors,
            clock: Clock,
            worker: WorkerConfig,
          ) =>
            new ExtractCvUseCase(repository, files, extractors, clock, {
              timeoutMs: worker.CV_EXTRACTION_TIMEOUT_MS,
            }),
        },
        {
          provide: DeleteCvFileUseCase,
          inject: [CV_FILE_READER],
          useFactory: (files: CvFileReader) => new DeleteCvFileUseCase(files),
        },
        ...(consumersEnabled
          ? [
              {
                provide: ExtractCvConsumer,
                inject: [ExtractCvUseCase, APP_CONFIG],
                useFactory: (
                  useCase: ExtractCvUseCase,
                  worker: WorkerConfig,
                ) =>
                  new ExtractCvConsumer(useCase, {
                    redisUrl: worker.REDIS_URL,
                    concurrency: worker.CV_EXTRACT_CONCURRENCY,
                    timeoutMs: worker.CV_EXTRACTION_TIMEOUT_MS,
                  }),
              },
              {
                provide: DeleteCvFileConsumer,
                inject: [DeleteCvFileUseCase, APP_CONFIG],
                useFactory: (
                  useCase: DeleteCvFileUseCase,
                  worker: WorkerConfig,
                ) =>
                  new DeleteCvFileConsumer(useCase, {
                    redisUrl: worker.REDIS_URL,
                  }),
              },
            ]
          : []),
      ],
    };
  }
}
