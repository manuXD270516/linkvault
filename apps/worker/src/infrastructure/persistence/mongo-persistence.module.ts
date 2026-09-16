import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { WorkerConfig } from '../config/worker-config.schema';
import { APP_CONFIG } from '../config/app-config.module';
import { MongoInitialConnectRetry } from './mongo-initial-connect-retry';

@Module({
  providers: [MongoInitialConnectRetry],
  exports: [MongoInitialConnectRetry],
})
class MongoConnectionRetryModule {}

/**
 * Conexión de Mongoose perezosa (D8): el arranque no espera a MongoDB y `serverSelectionTimeoutMS` queda
 * por defecto; el límite de 500 ms es del indicador de salud, no de la conexión.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [MongoConnectionRetryModule],
      inject: [APP_CONFIG, MongoInitialConnectRetry],
      useFactory: (config: WorkerConfig, retry: MongoInitialConnectRetry) => ({
        uri: config.MONGO_URI,
        lazyConnection: true,
        connectionFactory: (connection: Connection) =>
          retry.attach(connection, config.MONGO_URI),
      }),
    }),
  ],
})
export class MongoPersistenceModule {}
