import { describeHealthContract } from '@linkvault/testing';
import { createWorkerApp } from '../../app/create-worker-app';
import { buildMongooseConnectOptions } from '../../infrastructure/persistence/mongoose-connect-options';
import {
  workerTestAiConfig,
  workerTestConfig,
} from '../../test-support/test-config';

describeHealthContract({
  service: 'worker',
  mongooseConnectOptions: buildMongooseConnectOptions(),
  async start({ mongoUri, redisUrl }) {
    const config = await workerTestConfig({
      MONGO_URI: mongoUri,
      REDIS_URL: redisUrl,
    });
    const app = await createWorkerApp(config, workerTestAiConfig());
    await app.listen(config.WORKER_HEALTH_PORT, '127.0.0.1');
    return {
      baseUrl: `http://127.0.0.1:${config.WORKER_HEALTH_PORT}`,
      close: () => app.close(),
    };
  },
});
