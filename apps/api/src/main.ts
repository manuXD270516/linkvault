import { Logger } from 'nestjs-pino';
import { createApp } from './app/create-app';
import { loadApiConfigOrExit } from './infrastructure/config/load-api-config';

async function bootstrap(): Promise<void> {
  // La configuración de IA se valida aquí, con la de la app: el arranque falla si alguna es inválida.
  const { config, ai } = loadApiConfigOrExit(process.env);
  const app = await createApp(config, ai);
  app.enableShutdownHooks();
  await app.listen(config.API_PORT);
  app.get(Logger).log(`API listening on port ${config.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(`[api] Startup failed: ${name}\n`);
  process.exit(1);
});
