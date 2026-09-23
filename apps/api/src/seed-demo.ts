import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './app/app.module';
import { loadApiConfigOrExit } from './infrastructure/config/load-api-config';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './modules/applications/application/ports/application-repository.port';
import { TrackLink } from './modules/applications/application/track-link.usecase';
import { Argon2PasswordHasher } from './modules/auth/infrastructure/argon2-password-hasher';
import {
  CV_FILE_STORE,
  type CvFileStore,
} from './modules/cv/application/ports/cv-file-store.port';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './modules/cv/application/ports/cv-repository.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './modules/groups/application/ports/group-repository.port';
import {
  GROUP_LINK_COMMENT_REPOSITORY,
  type GroupLinkCommentRepository,
} from './modules/links/application/ports/group-link-comment-repository.port';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './modules/links/application/ports/group-link-repository.port';
import { SaveLink } from './modules/links/application/save-link.usecase';
import { SetKnowSomeone } from './modules/links/application/set-know-someone.usecase';
import { UpdateLinkPreview } from './modules/links/application/update-link-preview.usecase';
import { BackfillSearch } from './modules/search/application/backfill-search.cli';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './modules/users/application/ports/user-repository.port';
import {
  assertDemoSeedAllowed,
  DemoSeedGuardError,
} from './seed/demo-seed.guards';
import { runSeedDemo } from './seed/seed-demo.runner';

// `nx run api:seed-demo` (ADR-042). AppContext sin HTTP; guards D4 antes de mutar.
// Search vía BackfillSearch / outbox — nunca el SDK Meili desde este proceso.

async function main(): Promise<void> {
  assertDemoSeedAllowed(process.env);

  const { config, ai } = loadApiConfigOrExit(process.env);
  const context = await NestFactory.createApplicationContext(
    AppModule.register({ ...config, OUTBOX_RELAY_ENABLED: false }, ai),
    { bufferLogs: true },
  );
  try {
    const get = <T>(token: object | string | symbol): T =>
      context.get(token as never, { strict: false }) as T;

    await runSeedDemo({
      users: get<UserRepository>(USER_REPOSITORY),
      // Mismo Argon2id que auth (ADR-012); instancia local — AuthModule no exporta PASSWORD_HASHER.
      passwordHasher: new Argon2PasswordHasher(),
      groups: get<GroupRepository>(GROUP_REPOSITORY),
      saveLink: get<SaveLink>(SaveLink),
      updatePreview: get<UpdateLinkPreview>(UpdateLinkPreview),
      trackLink: get<TrackLink>(TrackLink),
      applications: get<ApplicationRepository>(APPLICATION_REPOSITORY),
      groupLinks: get<GroupLinkRepository>(GROUP_LINK_REPOSITORY),
      comments: get<GroupLinkCommentRepository>(GROUP_LINK_COMMENT_REPOSITORY),
      setKnowSomeone: get<SetKnowSomeone>(SetKnowSomeone),
      cvRepository: get<CvRepository>(CV_REPOSITORY),
      cvFiles: get<CvFileStore>(CV_FILE_STORE),
      connection: get<Connection>(getConnectionToken()),
      backfillSearch: get<BackfillSearch>(BackfillSearch),
    });
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof DemoSeedGuardError) {
    process.stderr.write(`[api] seed-demo refused: ${error.message}\n`);
    process.exit(1);
  }
  const name = error instanceof Error ? error.name : 'UnknownError';
  const detail =
    error instanceof Error && error.message !== ''
      ? `: ${error.message}`
      : '';
  process.stderr.write(`[api] seed-demo failed (${name})${detail}\n`);
  process.exit(1);
});
