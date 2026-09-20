import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { LimitsModule } from '../../../infrastructure/limits/limits.module';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { DeleteCv } from '../application/delete-cv.usecase';
import { GetCvTextPreview } from '../application/get-cv-text-preview.usecase';
import { ListMyCvs } from '../application/list-my-cvs.usecase';
import { CV_CLOCK } from '../application/ports/clock.port';
import { CV_FILE_STORE } from '../application/ports/cv-file-store.port';
import { CV_LIMITER } from '../application/ports/cv-limiter.port';
import { CV_REPOSITORY } from '../application/ports/cv-repository.port';
import { SetDefaultCv } from '../application/set-default-cv.usecase';
import { UploadCv } from '../application/upload-cv.usecase';
import { CounterCvLimiter } from '../infrastructure/counter-cv-limiter';
import { MongoCvRepository } from '../infrastructure/mongo-cv.repository';
import {
  S3CvFileStore,
  createS3CvFileUploader,
} from '../infrastructure/s3-cv-file.store';
import { SystemClock } from '../infrastructure/system-clock';
import { CvController } from './cv.controller';

/**
 * Módulo `cv` (ADR-028). Usa la conexión Mongoose por defecto de la app, así que quien lo importa debe registrar
 * `MongooseModule.forRoot*`.
 *
 * No depende de ningún otro módulo de dominio y nadie depende de él: no hay `CvFacade` todavía, porque no hay ningún
 * consumidor —la creará `cv-match-suggestions`, que será quien lea el texto—. Lo que sí toma de plataforma son dos
 * contratos compartidos: el **outbox** (`OUTBOX`, el mismo token que usa `links`) y el **contador de ventana fija**,
 * sobre el que `cv` declara su propio puerto con sus tres claves.
 *
 * **`@linkvault/ai` no entra aquí, y eso es una regla, no un olvido**: este change no manda ningún CV a ninguna IA, y
 * un test de imports lo comprueba.
 */
@Module({
  imports: [OutboxModule, LimitsModule],
  controllers: [CvController],
  providers: [
    { provide: CV_REPOSITORY, useClass: MongoCvRepository },
    { provide: CV_LIMITER, useClass: CounterCvLimiter },
    { provide: CV_CLOCK, useClass: SystemClock },
    {
      provide: CV_FILE_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: ApiConfig) =>
        new S3CvFileStore(
          createS3CvFileUploader({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            accessKey: config.S3_ACCESS_KEY,
            secretKey: config.S3_SECRET_KEY,
            bucket: config.S3_BUCKET,
          }),
        ),
    },
    UploadCv,
    ListMyCvs,
    SetDefaultCv,
    DeleteCv,
    GetCvTextPreview,
  ],
})
export class CvModule {}
