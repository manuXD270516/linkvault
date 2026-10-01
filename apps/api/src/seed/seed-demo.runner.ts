import { cvFileKey } from '@linkvault/shared';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import type { PasswordHasher } from '../modules/auth/application/ports/password-hasher.port';
import type { ApplicationStatus } from '../modules/applications/domain/application-status';
import { changeStatus } from '../modules/applications/domain/application.entity';
import type { ApplicationRepository } from '../modules/applications/application/ports/application-repository.port';
import type { TrackLink } from '../modules/applications/application/track-link.usecase';
import type { CvFileStore } from '../modules/cv/application/ports/cv-file-store.port';
import type { CvRepository } from '../modules/cv/application/ports/cv-repository.port';
import type { GroupRepository } from '../modules/groups/application/ports/group-repository.port';
import {
  GROUPS_COLLECTION,
  GROUP_MEMBERS_COLLECTION,
} from '../modules/groups/infrastructure/group.schemas';
import type { Group } from '../modules/groups/domain/group';
import { JOB_LINKS_COLLECTION } from '../modules/links/infrastructure/link.schemas';
import type { SaveLink } from '../modules/links/application/save-link.usecase';
import type { SetKnowSomeone } from '../modules/links/application/set-know-someone.usecase';
import type { UpdateLinkPreview } from '../modules/links/application/update-link-preview.usecase';
import type { GroupLinkRepository } from '../modules/links/application/ports/group-link-repository.port';
import type { GroupLinkCommentRepository } from '../modules/links/application/ports/group-link-comment-repository.port';
import { createGroupLinkComment } from '../modules/links/domain/group-link-comment';
import type { BackfillSearch } from '../modules/search/application/backfill-search.usecase';
import { createUser, normalizeEmail } from '../modules/users/domain/user';
import type { UserRepository } from '../modules/users/application/ports/user-repository.port';
import { APPLICATIONS_COLLECTION } from '../modules/applications/infrastructure/application.schemas';
import {
  DEMO_ANA,
  DEMO_BOB,
  DEMO_COMMENT_TEXT,
  DEMO_CV_FILE_NAME,
  DEMO_GROUP_INVITE_CODE,
  DEMO_GROUP_NAME,
  DEMO_LINKS,
  DEMO_SPA_URL,
} from './demo-seed.dataset';

/** Dependencias del runner: casos de uso / repos del grafo Nest (sin HTTP). */
export interface SeedDemoDeps {
  readonly users: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly groups: GroupRepository;
  readonly saveLink: SaveLink;
  readonly updatePreview: UpdateLinkPreview;
  readonly trackLink: TrackLink;
  readonly applications: ApplicationRepository;
  readonly groupLinks: GroupLinkRepository;
  readonly comments: GroupLinkCommentRepository;
  readonly setKnowSomeone: SetKnowSomeone;
  readonly cvRepository: CvRepository;
  readonly cvFiles: CvFileStore;
  readonly connection: Connection;
  /** Mismo camino que `api:backfill-search` — NUNCA el SDK Meili. */
  readonly backfillSearch: BackfillSearch;
  readonly now?: Date;
  readonly log?: (line: string) => void;
}

export interface SeedDemoReport {
  readonly anaId: string;
  readonly bobId: string;
  readonly groupId: string;
  readonly linkIds: Readonly<Record<string, string>>;
  readonly search: { readonly found: number; readonly enqueued: number };
  readonly cvSkipped: boolean;
}

/**
 * Semilla idempotente del dataset demo (D2–D3). Upsert por email, inviteCode del grupo,
 * normalizedUrl de cada link, (userId, linkId) de apps, texto del comentario, know-someone de Bob.
 */
export async function runSeedDemo(deps: SeedDemoDeps): Promise<SeedDemoReport> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const ana = await ensureDemoUser(deps, DEMO_ANA, now);
  const bob = await ensureDemoUser(deps, DEMO_BOB, now);
  const group = await ensureDemoGroup(deps, ana.id, now);

  await deps.groups.addMember({
    groupId: group.id,
    userId: bob.id,
    now,
  });

  const linkIds: Record<string, string> = {};
  for (const [key, seed] of Object.entries(DEMO_LINKS)) {
    const saved = await deps.saveLink.execute(ana.id, {
      url: seed.url,
      groupId: group.id,
    });
    linkIds[key] = saved.link.id;
    await ensurePreview(deps, ana.id, saved.link.id, seed);
  }

  await markClosedRecheck(deps.connection, linkIds['closedRecheck'] ?? '');

  await ensureApplication(deps, ana.id, linkIds['openSalary'] ?? '', {
    status: DEMO_LINKS.openSalary.appStatus,
  });
  await ensureApplication(deps, ana.id, linkIds['closedRecheck'] ?? '', {
    status: DEMO_LINKS.closedRecheck.appStatus,
    stageLabel: DEMO_LINKS.closedRecheck.stageLabel,
  });
  await ensureApplication(deps, ana.id, linkIds['rejectedApp'] ?? '', {
    status: DEMO_LINKS.rejectedApp.appStatus,
  });
  const stale = await ensureApplication(
    deps,
    ana.id,
    linkIds['staleApp'] ?? '',
    { status: DEMO_LINKS.staleApp.appStatus },
  );
  await markStaleStatusChangedAt(
    deps.connection,
    stale.applicationId,
    daysAgo(now, DEMO_LINKS.staleApp.staleDays),
  );

  await ensureComment(deps, ana.id, group.id, linkIds['openSalary'] ?? '', now);
  await deps.setKnowSomeone.execute(bob.id, group.id, linkIds['openSalary'] ?? '', {
    flagged: true,
  });

  const cvSkipped = await ensureCvBestEffort(deps, ana.id, now, log);

  // Search: mismo camino que api:backfill-search / outbox — nunca Meili SDK aquí.
  const search = await deps.backfillSearch.execute({
    limit: 500,
    dryRun: false,
    reembed: false,
  });

  log('');
  log('[api] seed-demo: listo');
  log(`  Ana: ${DEMO_ANA.email} / ${DEMO_ANA.password}`);
  log(`  Bob: ${DEMO_BOB.email} / ${DEMO_BOB.password}`);
  log(`  Grupo: ${DEMO_GROUP_NAME} (código ${DEMO_GROUP_INVITE_CODE})`);
  log(`  SPA: ${DEMO_SPA_URL}`);
  if (cvSkipped) {
    log('  CV: omitido (almacén de objetos no disponible)');
  }
  log(
    `  Search backfill: enqueued ${search.enqueued} of ${search.found} candidates`,
  );

  return {
    anaId: ana.id,
    bobId: bob.id,
    groupId: group.id,
    linkIds,
    search,
    cvSkipped,
  };
}

async function ensureDemoUser(
  deps: SeedDemoDeps,
  account: typeof DEMO_ANA | typeof DEMO_BOB,
  now: Date,
): Promise<{ readonly id: string }> {
  const email = normalizeEmail(account.email);
  const passwordHash = await deps.passwordHasher.hash(account.password);
  const existing = await deps.users.findByEmail(email);
  if (existing !== null) {
    await deps.users.setPasswordHash(existing.id, passwordHash, now);
    return { id: existing.id };
  }
  const created = await deps.users.create(
    createUser({
      email,
      passwordHash,
      displayName: account.displayName,
      now,
    }),
  );
  return { id: created.id };
}

/**
 * Grupo demo por inviteCode fijo. Si no existe, inserción directa (CreateGroup no fija el código).
 */
async function ensureDemoGroup(
  deps: SeedDemoDeps,
  ownerId: string,
  now: Date,
): Promise<Group> {
  const byCode = await deps.groups.findByInviteCode(DEMO_GROUP_INVITE_CODE);
  if (byCode !== null) {
    if (byCode.name !== DEMO_GROUP_NAME) {
      const renamed = await deps.groups.rename(
        byCode.id,
        DEMO_GROUP_NAME,
        now,
      );
      return renamed ?? byCode;
    }
    return byCode;
  }

  // Reutilizar un «Demo LatAm» previo de Ana (sin código fijo) y fijar el inviteCode.
  const owned = await deps.groups.listGroupsOfUser(ownerId);
  const byName = owned.find((row) => row.group.name === DEMO_GROUP_NAME);
  if (byName !== undefined) {
    await deps.connection.collection(GROUPS_COLLECTION).updateOne(
      { _id: new Types.ObjectId(byName.group.id) },
      { $set: { inviteCode: DEMO_GROUP_INVITE_CODE, updatedAt: now } },
    );
    const updated = await deps.groups.findByInviteCode(DEMO_GROUP_INVITE_CODE);
    if (updated !== null) {
      return updated;
    }
  }

  const groupId = new Types.ObjectId();
  const ownerOid = new Types.ObjectId(ownerId);
  const session = await deps.connection.startSession();
  try {
    await session.withTransaction(async () => {
      await deps.connection.collection(GROUPS_COLLECTION).insertOne(
        {
          _id: groupId,
          name: DEMO_GROUP_NAME,
          inviteCode: DEMO_GROUP_INVITE_CODE,
          settings: { defaultVisibility: 'public' },
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      await deps.connection.collection(GROUP_MEMBERS_COLLECTION).insertOne(
        {
          groupId,
          userId: ownerOid,
          role: 'owner',
          joinedAt: now,
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  const created = await deps.groups.findByInviteCode(DEMO_GROUP_INVITE_CODE);
  if (created === null) {
    throw new Error('demo group insert did not persist');
  }
  return created;
}

async function ensurePreview(
  deps: SeedDemoDeps,
  userId: string,
  linkId: string,
  seed: (typeof DEMO_LINKS)[keyof typeof DEMO_LINKS],
): Promise<void> {
  const fields: Record<string, unknown> = {
    title: seed.title,
    company: seed.company,
    location: seed.location,
    modality: seed.modality,
  };
  if ('salary' in seed && seed.salary !== undefined) {
    fields['salary'] = seed.salary;
  }
  await deps.updatePreview.execute(userId, linkId, { fields });
}

async function markClosedRecheck(
  connection: Connection,
  linkId: string,
): Promise<void> {
  if (linkId === '' || !Types.ObjectId.isValid(linkId)) {
    return;
  }
  const closedAt = new Date('2026-09-20T12:00:00.000Z');
  await connection.collection(JOB_LINKS_COLLECTION).updateOne(
    { _id: new Types.ObjectId(linkId) },
    { $set: { closedAt, closedReason: 'recheck', updatedAt: closedAt } },
  );
}

async function ensureApplication(
  deps: SeedDemoDeps,
  userId: string,
  linkId: string,
  desired: {
    readonly status: ApplicationStatus;
    readonly stageLabel?: string;
  },
): Promise<{ readonly applicationId: string }> {
  const tracked = await deps.trackLink.execute(userId, {
    linkId,
    status: desired.status,
    ...(desired.stageLabel === undefined
      ? {}
      : { stageLabel: desired.stageLabel }),
  });
  const applicationId = tracked.application.id;
  if (
    tracked.application.status !== desired.status ||
    tracked.application.stageLabel !== desired.stageLabel
  ) {
    const current = await deps.applications.findOwned(applicationId, userId);
    if (current !== null) {
      const change = changeStatus(
        current,
        {
          status: desired.status,
          ...(desired.stageLabel === undefined
            ? {}
            : { stageLabel: desired.stageLabel }),
        },
        deps.now ?? new Date(),
      );
      if (change.kind === 'changed') {
        await deps.applications.changeStatus(
          current.id,
          userId,
          change.write,
          change.event,
        );
      }
    }
  }
  return { applicationId };
}

async function markStaleStatusChangedAt(
  connection: Connection,
  applicationId: string,
  statusChangedAt: Date,
): Promise<void> {
  if (!Types.ObjectId.isValid(applicationId)) {
    return;
  }
  await connection.collection(APPLICATIONS_COLLECTION).updateOne(
    { _id: new Types.ObjectId(applicationId) },
    { $set: { statusChangedAt } },
  );
}

async function ensureComment(
  deps: SeedDemoDeps,
  authorId: string,
  groupId: string,
  linkId: string,
  now: Date,
): Promise<void> {
  const page = await deps.comments.page(groupId, linkId, { limit: 50 });
  if (page.items.some((c) => c.text === DEMO_COMMENT_TEXT)) {
    return;
  }
  const draft = createGroupLinkComment({
    groupId,
    linkId,
    authorId,
    text: DEMO_COMMENT_TEXT,
    now,
  });
  await deps.groupLinks.addComment(draft);
}

async function ensureCvBestEffort(
  deps: SeedDemoDeps,
  userId: string,
  now: Date,
  log: (line: string) => void,
): Promise<boolean> {
  const existing = await deps.cvRepository.listByUser(userId);
  if (existing.some((doc) => doc.fileName === DEMO_CV_FILE_NAME)) {
    return false;
  }
  const bytes = minimalPdfBytes();
  try {
    const cvId = deps.cvRepository.nextId();
    await deps.cvFiles.put(cvFileKey(userId, cvId), bytes, 'pdf');
    await deps.cvRepository.insertAsDefault({
      id: cvId,
      userId,
      fileKey: cvFileKey(userId, cvId),
      fileName: DEMO_CV_FILE_NAME,
      fileType: 'pdf',
      sizeBytes: bytes.byteLength,
      uploadedAt: now,
    });
    return false;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown';
    log(`[api] seed-demo: CV skipped (${detail})`);
    return true;
  }
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** PDF mínimo válido para el almacén de objetos (best-effort; no se parsea en el seed). */
function minimalPdfBytes(): Uint8Array {
  return new TextEncoder().encode(
    '%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
  );
}
