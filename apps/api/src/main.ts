import { Logger } from 'nestjs-pino';
import {
  createApp,
  LISTEN_HOST,
  listenOnAllInterfaces,
} from './app/create-app';
import { loadApiConfigOrExit } from './infrastructure/config/load-api-config';

async function bootstrap(): Promise<void> {
  // La configuración de IA se valida aquí, con la de la app: el arranque falla si alguna es inválida.
  const { config, ai } = loadApiConfigOrExit(process.env);
  const app = await createApp(config, ai);
  app.enableShutdownHooks();
  await listenOnAllInterfaces(app, config.API_PORT);
  app
    .get(Logger)
    .log(`API listening on ${LISTEN_HOST}:${config.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write(`[api] Startup failed: ${name}\n`);
  process.exit(1);
});
