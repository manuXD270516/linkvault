import { Logger } from 'nestjs-pino';
import { createWorkerApp } from './app/create-worker-app';
import { loadWorkerConfigOrExit } from './infrastructure/config/load-worker-config';

async function bootstrap(): Promise<void> {
  const { config, ai } = loadWorkerConfigOrExit(process.env);
  const app = await createWorkerApp(config, ai);
  app.enableShutdownHooks();
  await app.listen(config.WORKER_HEALTH_PORT);
  app
    .get(Logger)
    .log(
      `Worker health listening on port ${config.WORKER_HEALTH_PORT}`,
      'Bootstrap',
    );
}

bootstrap().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(`[worker] Startup failed: ${name}\n`);
  process.exit(1);
});
