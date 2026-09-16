import { describeHealthContract } from '@linkvault/testing';
import { createApp } from '../../app/create-app';
import { buildMongooseConnectOptions } from '../../infrastructure/persistence/mongoose-connect-options';
import { apiTestConfig } from '../../test-support/test-config';

describeHealthContract({
  service: 'api',
  mongooseConnectOptions: buildMongooseConnectOptions(),
  async start({ mongoUri, redisUrl }) {
    const app = await createApp(
      await apiTestConfig({ MONGO_URI: mongoUri, REDIS_URL: redisUrl }),
    );
    await app.listen(0, '127.0.0.1');
    return { baseUrl: await app.getUrl(), close: () => app.close() };
  },
});
