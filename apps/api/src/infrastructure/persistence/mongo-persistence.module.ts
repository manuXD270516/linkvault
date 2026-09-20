import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { ApiConfig } from '../config/api-config.schema';
import { APP_CONFIG } from '../config/app-config.module';
import { MongoInitialConnectRetry } from './mongo-initial-connect-retry';
import { buildMongooseConnectOptions } from './mongoose-connect-options';

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
      useFactory: (config: ApiConfig, retry: MongoInitialConnectRetry) => {
        const connectOptions = buildMongooseConnectOptions(config.NODE_ENV);
        return {
          ...connectOptions,
          uri: config.MONGO_URI,
          lazyConnection: true,
          connectionFactory: (connection: Connection) =>
            retry.attach(connection, config.MONGO_URI, connectOptions),
        };
      },
    }),
  ],
})
export class MongoPersistenceModule {}
