// =====================================================================================================================
// Semilla de volumen para probar la medición (design D17 de `staging-host`, tareas 10.3b-10.3e).
// =====================================================================================================================
// SOLO contra un Mongo local y desechable. NUNCA contra staging ni producción: las cuentas sintéticas contarían en
// `measure.mongosh.js` y en `uninvited.mongosh.js` y romperían la línea base de 10.6. Se ejecuta siempre por el
// envoltorio, que valida los parámetros, aplica las guardias de D17 y pone `LV_SEED.guard`:
//
//   bash infra/staging/seed-volume.sh <seed|clean|expect|digest> [--scale N] [--seed N] [--batch <lote>] \
//        [--anchor <ISO>] [--container <nombre>]
//
// Modos (`LV_SEED.mode`):
//   seed    genera el lote en memoria, borra los documentos con la marca del lote cuyo `_id` no está en lo generado y
//           hace `replaceOne` con `upsert` por `_id` en `bulkWrite` desordenados de 1000. Repetirlo igual informa
//           0 insertados, 0 modificados y 0 borrados. Imprime una línea JSON.
//   clean   borra SOLO lo del lote: primero lo de las colecciones de la cascada de borrado de cuenta cuyo `userId` es de
//           un usuario del lote (lo que la aplicación haya creado al usarlo), después `{ lvSeedBatch }` en cada
//           colección de la tabla. Se niega, sin borrar nada, si alguien que no es del lote se relaciona con algo del
//           lote. Nunca usa un filtro vacío. Borra también los eventos de `outbox_events` cuyo payload nombra a un
//           usuario del lote (`userId` o `actorUserId`); se niega si uno nombra a la vez a alguien que no lo es.
//           IMPORTANTE: tras usar la aplicación con cuentas del lote (subir un CV, etc.) hay que ejecutar `clean` ANTES
//           del siguiente `seed`: lo que crea la aplicación no lleva marca y choca con índices únicos (p. ej. el CV
//           por defecto de cada usuario).
//   expect  imprime los doce valores que `measure.mongosh.js` debe dar PARA EL LOTE SOLO, sabidos por construcción del
//           generador (no recalculados con las consultas de `measure`).
//   digest  imprime los documentos del lote, por colección y ordenados por `_id`, en EJSON canónico, una línea cada uno
//           (`<colección><tab><documento>`); la SHA-256 la calcula `node` fuera.
//
// Determinismo: un generador pseudoaleatorio con semilla (`LV_SEED.seed`) lo produce todo, `_id` incluidos (los 4
// primeros bytes son el ancla en segundos; los 8 restantes salen del generador). Todas las fechas son el ancla
// (`LV_SEED.anchor`) menos un desplazamiento del generador. Cada unidad de escala usa su propio generador derivado de
// la semilla y del número de unidad: la unidad 0 es idéntica a escala 1 y a escala 3.
//
// Forma de los documentos: la de los esquemas de Mongoose de la aplicación; cada enum y cada forma lleva un comentario
// con el fichero de origen. Los usuarios llevan el hash Argon2id de una contraseña PÚBLICA: el lote nunca sale de una
// máquina local.
// =====================================================================================================================
'use strict';

const BATCH_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;
const ANCHOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const MODES = ['seed', 'clean', 'expect', 'digest'];
const CHUNK = 1000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Contraseña PÚBLICA del lote, y su hash Argon2id con los parámetros de `ARGON2_OPTIONS`
// (apps/api/src/modules/auth/infrastructure/argon2-password-hasher.ts: m=19456, t=2, p=1). NO ES UN SECRETO: está aquí,
// en el repositorio, a propósito. Con ella se comprueba en 10.3e que la aplicación lee los documentos del lote.
const SEED_PASSWORD_PLAIN = 'SeedVolume-public-0001';
const SEED_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$D39w8pJwGoimyyTvcC8MSw$F/Q/V3ppuICwhtoJi/AphddBCQKRcSq/MUMTwPELkP8';

// Colecciones de la tabla de D17, en el orden en que se escriben, se resumen y se imprimen.
const COLLECTIONS = [
  'users',
  'groups',
  'group_members',
  'job_links',
  'user_links',
  'group_links',
  'applications',
  'application_events',
  'cv_documents',
  'ai_analyses',
  'roadmaps',
  'cv_version_counters',
];

// Cascada de borrado de cuenta, copiada de apps/api/src/modules/users/infrastructure/mongo-account-deletion.cascade.ts
// (y de libs/ai/src/infrastructure/persistence/user-ai-key.schema.ts). `key` dice cómo se guarda el usuario en cada
// una: `hex` (cadena) u `oid` (ObjectId). `application_events` se borra además por `applicationId`, como allí.
const CASCADE = [
  { coll: 'auth_sessions', field: 'userId', key: 'hex' },
  { coll: 'refresh_tokens', field: 'userId', key: 'hex' },
  { coll: 'auth_email_tokens', field: 'userId', key: 'hex' },
  { coll: 'notification_preferences', field: 'userId', key: 'oid' },
  { coll: 'push_subscriptions', field: 'userId', key: 'oid' },
  { coll: 'notification_deliveries', field: 'userId', key: 'oid' },
  { coll: 'group_link_comments', field: 'authorId', key: 'oid' },
  { coll: 'user_links', field: 'userId', key: 'oid' },
  { coll: 'application_events', field: 'userId', key: 'oid' },
  { coll: 'applications', field: 'userId', key: 'oid' },
  { coll: 'cv_documents', field: 'userId', key: 'oid' },
  { coll: 'ai_analyses', field: 'userId', key: 'oid' },
  { coll: 'roadmaps', field: 'userId', key: 'oid' },
  { coll: 'ai_feedback', field: 'userId', key: 'oid' },
  { coll: 'ai_usage', field: 'userId', key: 'hex' },
  { coll: 'user_ai_keys', field: 'userId', key: 'hex' },
  // Eventos del outbox que la aplicación emite al usar una cuenta, con el usuario en el payload en hexadecimal
  // (libs/shared/src/events: `userId` en CvUploaded, CvDeleted, MatchRequested y RoadmapRequested; `actorUserId` en
  // ApplicationStatusNotify y GroupLinkAdded). No llevan `lvSeedBatch`.
  { coll: 'outbox_events', field: 'payload.userId', key: 'hex' },
  { coll: 'outbox_events', field: 'payload.actorUserId', key: 'hex' },
];

// ---- Parámetros y guardia ------------------------------------------------------------------------------------------

function fail(message) {
  throw new Error(`seed-volume: ${message}`);
}

const params = globalThis.LV_SEED;
if (params === undefined || params === null || typeof params !== 'object') {
  fail('falta LV_SEED: ejecuta este script con infra/staging/seed-volume.sh');
}
if (params.guard !== 'local-synthetic-only') {
  fail(
    'sin la guardia local-synthetic-only no se escribe nada: ejecuta este script con infra/staging/seed-volume.sh',
  );
}
if (!MODES.includes(params.mode)) {
  fail(`modo no válido: ${String(params.mode)}`);
}
if (!Number.isInteger(params.scale) || params.scale < 1 || params.scale > 50) {
  fail('scale tiene que ser un entero de 1 a 50');
}
if (
  !Number.isInteger(params.seed) ||
  params.seed < 0 ||
  params.seed > 4294967295
) {
  fail('seed tiene que ser un entero de 32 bits sin signo');
}
if (typeof params.batch !== 'string' || !BATCH_PATTERN.test(params.batch)) {
  fail('batch no casa con ^[a-z0-9][a-z0-9-]{0,30}$');
}
if (
  typeof params.anchor !== 'string' ||
  !ANCHOR_PATTERN.test(params.anchor) ||
  Number.isNaN(Date.parse(params.anchor))
) {
  fail('anchor tiene que ser una fecha ISO UTC (AAAA-MM-DDThh:mm:ssZ)');
}

const MODE = params.mode;
const SCALE = params.scale;
const SEED = params.seed;
const BATCH = params.batch;
const ANCHOR_MS = Date.parse(params.anchor);
const ANCHOR_SECONDS = Math.floor(ANCHOR_MS / 1000);
const lv = db.getSiblingDB('linkvault');

// ---- Generador pseudoaleatorio con semilla (mulberry32) -------------------------------------------------------------

function makeRng(initial) {
  let state = initial >>> 0;
  const rng = {
    next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) {
      return Math.floor(rng.next() * n);
    },
    pick(list) {
      return list[rng.int(list.length)];
    },
    word32() {
      return Math.floor(rng.next() * 4294967296) >>> 0;
    },
  };
  // Calentamiento: las primeras salidas de semillas cercanas se parecen.
  for (let i = 0; i < 8; i += 1) {
    rng.next();
  }
  return rng;
}

function unitSeed(unit) {
  return (
    (Math.imul(SEED ^ 0x9e3779b9, 0x85ebca6b) ^
      Math.imul(unit + 1, 0xc2b2ae35)) >>>
    0
  );
}

const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');
const pad = (n, width) => String(n).padStart(width, '0');
const iso = (ms) => new Date(ms).toISOString();

const usedIds = new Set();
// `_id` de 12 bytes: el ancla en segundos y 8 bytes del generador. Dos iguales se descartan y se vuelve a sortear.
function newId(rng) {
  for (;;) {
    const id = hex8(ANCHOR_SECONDS) + hex8(rng.word32()) + hex8(rng.word32());
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
}

// ---- Enums, copiados de su origen -----------------------------------------------------------------------------------

// libs/shared/src/schemas/link.schema.ts: previewStatusSchema (se reparten en este orden, por k % 10).
const PREVIEW_STATUS_BY_SLOT = [
  'enriched',
  'enriched',
  'enriched',
  'enriched',
  'enriched',
  'partial',
  'partial',
  'pending',
  'failed',
  'manual',
];
// libs/shared/src/schemas/preview.schema.ts: jobModalitySchema, jobSenioritySchema y salaryPeriodSchema.
const MODALITIES = ['remote', 'hybrid', 'onsite'];
const SENIORITIES = ['junior', 'mid', 'senior'];
// libs/shared/src/schemas/preview.schema.ts: enrichmentFailureReasonSchema.
const FAILURE_REASONS = ['blocked', 'not_found', 'timeout', 'no_data'];
// apps/api/src/modules/applications/domain/application-status.ts: APPLICATION_STATUSES, APPLIED_AT_STATUSES y
// STAGE_STATUS.
const APPLICATION_STATUSES = [
  'saved',
  'interested',
  'applied',
  'in_process',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'expired',
];
const APPLIED_AT_STATUSES = ['applied', 'in_process', 'offer', 'accepted'];
// apps/api/src/modules/groups/domain/invite-code.ts: INVITE_CODE_ALPHABET (30 símbolos, 8 caracteres).
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const SKILL_NAMES = ['TypeScript', 'Node.js', 'MongoDB', 'Angular', 'Docker'];

// ---- Plan por unidad de escala --------------------------------------------------------------------------------------
// Por unidad: 100 usuarios, 10 grupos, 60 membresías, 1000 links, 1500 user_links, 500 group_links, 600 postulaciones
// con su evento de alta, 40 CV, 120 análisis y 30 roadmaps (design D17). Todo lo que cuenta `measure.mongosh.js` se
// decide aquí y se apunta en `facts`, que es lo que imprime `expect`.

// Tamaños de grupo de una unidad: 2 a 10, el mayor exactamente 10, suman 60.
const GROUP_SIZES = [10, 9, 8, 7, 6, 6, 5, 4, 3, 2];
const USERS_PER_UNIT = 100;
const USERS_WITH_LINKS = 80; // los 20 últimos de cada unidad no guardan ningún link
const USERS_WITH_CV = 40;
const LINKS_PER_UNIT = 1000;
const GROUP_LINKS_PER_UNIT = 500;
const APPLICATIONS_PER_UNIT = 600;
const ANALYSES_PER_USER = 3;
// Pasos coprimos con 1000: con ellos, `(inicio + k * paso) % 1000` no repite link para ningún k < 1000.
const LINK_STRIDES = [1, 3, 7, 9, 11, 13, 17, 19, 21, 23, 27, 29];

const out = {};
COLLECTIONS.forEach((name) => {
  out[name] = [];
});
const facts = {
  users: 0,
  activatedUsers: 0,
  usersWith3PlusLinks: 0,
  usersWithLinks: 0,
  groups: 0,
  membersInLargestGroup: 0,
  linkIds: new Set(),
  applications: 0,
  groupApplications: 0,
  groupVisibleApplications: 0,
  cvs: 0,
  analyses: 0,
  roadmaps: 0,
  aiGenerated: 0,
};

function generateUnit(unit) {
  const rng = makeRng(unitSeed(unit));
  const userBase = unit * USERS_PER_UNIT;
  const linkBase = unit * LINKS_PER_UNIT;
  const groupBase = unit * GROUP_SIZES.length;

  // -- users (apps/api/src/modules/users/infrastructure/user.schema.ts) --
  const users = [];
  let rest = 0;
  for (let i = 0; i < USERS_PER_UNIT; i += 1) {
    const number = userBase + i + 1;
    const createdAt = ANCHOR_MS - 45 * DAY - rng.int(60 * DAY);
    let linkCount = 0;
    if (i < USERS_WITH_LINKS) {
      if (i % 8 === 5) {
        linkCount = 1;
      } else if (i % 8 === 6) {
        linkCount = 2;
      } else {
        linkCount = 24 + (rest % 2);
        rest += 1;
      }
    }
    // Activación: primer link en menos de 48 h desde el alta (1-40 h) o después (60-360 h).
    const activated = linkCount > 0 && i % 3 !== 2;
    const firstOffset = activated
      ? (1 + rng.int(39)) * HOUR + rng.int(HOUR)
      : (60 + rng.int(300)) * HOUR + rng.int(HOUR);
    const id = newId(rng);
    users.push({
      id,
      number,
      createdAt,
      linkCount,
      activated,
      firstOffset,
      links: [],
    });
    out.users.push({
      _id: ObjectId(id),
      email: `seed-${BATCH}-${pad(number, 4)}@seed.linkvault.invalid`,
      passwordHash: SEED_PASSWORD_HASH,
      passwordChangedAt: new Date(createdAt),
      emailVerified: true,
      displayName: `Seed ${BATCH} ${pad(number, 4)}`,
      aiConsent: {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
      },
      outputLanguage: 'es',
      redactName: true,
      createdAt: new Date(createdAt),
      lvSeedBatch: BATCH,
    });
    facts.users += 1;
    if (linkCount > 0) {
      facts.usersWithLinks += 1;
    }
    if (activated) {
      facts.activatedUsers += 1;
    }
    if (linkCount >= 3) {
      facts.usersWith3PlusLinks += 1;
    }
  }

  // -- groups y group_members (apps/api/src/modules/groups/infrastructure/group.schemas.ts) --
  // Las membresías son porciones contiguas y disjuntas de los 60 primeros usuarios de la unidad; el primero de cada
  // porción es el owner.
  const groups = [];
  let cursor = 0;
  GROUP_SIZES.forEach((size, j) => {
    const number = groupBase + j + 1;
    const members = users.slice(cursor, cursor + size);
    cursor += size;
    const owner = members[0];
    const createdAt = owner.createdAt + rng.int(5 * DAY);
    const id = newId(rng);
    // Cuatro símbolos del generador y cuatro que codifican el número del grupo: único dentro del lote.
    let code = '';
    for (let c = 0; c < 4; c += 1) {
      code += INVITE_ALPHABET[rng.int(INVITE_ALPHABET.length)];
    }
    let rem = number;
    let suffix = '';
    for (let c = 0; c < 4; c += 1) {
      suffix = INVITE_ALPHABET[rem % INVITE_ALPHABET.length] + suffix;
      rem = Math.floor(rem / INVITE_ALPHABET.length);
    }
    groups.push({ id, number, members, createdAt, links: new Set() });
    out.groups.push({
      _id: ObjectId(id),
      name: `Seed ${BATCH} ${pad(number, 2)}`,
      inviteCode: code + suffix,
      settings: { defaultVisibility: 'private' },
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      lvSeedBatch: BATCH,
    });
    facts.groups += 1;
    facts.membersInLargestGroup = Math.max(facts.membersInLargestGroup, size);
    members.forEach((member, m) => {
      member.group = groups[groups.length - 1];
      out.group_members.push({
        _id: ObjectId(newId(rng)),
        groupId: ObjectId(id),
        userId: ObjectId(member.id),
        role: m === 0 ? 'owner' : 'member',
        joinedAt: new Date(
          Math.max(createdAt, member.createdAt) + rng.int(3 * DAY),
        ),
        lvSeedBatch: BATCH,
      });
    });
  });

  // -- job_links (apps/api/src/modules/links/infrastructure/link.schemas.ts y preview.schemas.ts) --
  const links = [];
  for (let k = 0; k < LINKS_PER_UNIT; k += 1) {
    const number = linkBase + k + 1;
    const status = PREVIEW_STATUS_BY_SLOT[k % PREVIEW_STATUS_BY_SLOT.length];
    const createdAt = ANCHOR_MS - (1 + rng.int(40 * 24)) * HOUR;
    const creator = users[rng.int(USERS_WITH_LINKS)];
    const id = newId(rng);
    const url = `https://seed-${BATCH}.linkvault.invalid/jobs/${number}`;
    // Hash sintético de 64 hexadecimales: sirve de identidad (`dedupeKey` único), no es una SHA-256 de la URL.
    const urlHash =
      hex8(rng.word32()) +
      hex8(rng.word32()) +
      hex8(rng.word32()) +
      hex8(rng.word32()) +
      hex8(rng.word32()) +
      hex8(rng.word32()) +
      hex8(rng.word32()) +
      hex8(rng.word32());
    const document = {
      _id: ObjectId(id),
      normalizedUrl: url,
      urlHash,
      dedupeKey: `url:${urlHash}`,
      platform: 'generic',
      displayUrl: url,
      originalUrls: [url],
      previewStatus: status,
      previewVersion: status === 'pending' || status === 'failed' ? 1 : 2,
    };
    const at = iso(createdAt);
    if (status === 'enriched' || status === 'partial' || status === 'manual') {
      const title = `Seed role ${number}`;
      const company = `Seed Company ${pad((number % 97) + 1, 2)}`;
      const location = 'Remote, LATAM';
      const full = {
        title,
        company,
        location,
        modality: MODALITIES[number % MODALITIES.length],
        seniority: SENIORITIES[number % SENIORITIES.length],
        salary: { min: 1000, max: 2000, currency: 'USD', period: 'month' },
        skills: [
          { name: SKILL_NAMES[number % SKILL_NAMES.length], required: true },
          {
            name: SKILL_NAMES[(number + 1) % SKILL_NAMES.length],
            required: false,
          },
        ],
        languages: [{ name: 'English', level: 'B2' }],
        summary: `Synthetic job ${number} for volume measurements.`,
        postedAt: iso(createdAt).slice(0, 10),
        expiresAt: iso(createdAt + 30 * DAY).slice(0, 10),
      };
      let fields = ['title', 'company'];
      if (status === 'enriched') {
        fields = Object.keys(full);
      } else if (status === 'partial') {
        fields = ['title', 'company', 'location', 'summary'];
      }
      document.preview = {};
      document.previewSources = {};
      fields.forEach((field) => {
        document.preview[field] = full[field];
        document.previewSources[field] =
          status === 'manual'
            ? { value: full[field], source: 'manual', by: creator.id, at }
            : { value: full[field], source: 'auto', extractor: 'seed', at };
      });
    }
    if (status === 'failed') {
      document.lastEnrichmentError = { reason: rng.pick(FAILURE_REASONS), at };
    }
    document.previewRequestedAt = new Date(createdAt);
    document.createdBy = ObjectId(creator.id);
    document.createdAt = new Date(createdAt);
    document.updatedAt = new Date(createdAt);
    document.lvSeedBatch = BATCH;
    out.job_links.push(document);
    links.push({ id, previewVersion: document.previewVersion });
  }

  // -- user_links (link.schemas.ts) --
  users.forEach((user) => {
    if (user.linkCount === 0) {
      return;
    }
    const start = rng.int(LINKS_PER_UNIT);
    const stride = rng.pick(LINK_STRIDES);
    let at = user.createdAt + user.firstOffset;
    for (let k = 0; k < user.linkCount; k += 1) {
      if (k > 0) {
        at += (1 + rng.int(24)) * HOUR;
      }
      const index = (start + k * stride) % LINKS_PER_UNIT;
      user.links.push({ index, savedAt: at });
      facts.linkIds.add(links[index].id);
      out.user_links.push({
        _id: ObjectId(newId(rng)),
        userId: ObjectId(user.id),
        linkId: ObjectId(links[index].id),
        savedAt: new Date(at),
        lvSeedBatch: BATCH,
      });
    }
  });

  // -- group_links (link.schemas.ts): compartidos por un miembro, de links que ya tiene guardados; el sharer se sortea
  // entre los 60 miembros, así que cada grupo recibe en proporción a su tamaño --
  const shared = new Set();
  const sharers = users.slice(0, cursor);
  let attempts = 0;
  for (let t = 0; t < GROUP_LINKS_PER_UNIT;) {
    attempts += 1;
    if (attempts > 100 * GROUP_LINKS_PER_UNIT) {
      fail('no caben tantos group_links sin repetir un link en un grupo');
    }
    const sharer = rng.pick(sharers);
    const group = sharer.group;
    const saved = rng.pick(sharer.links);
    const key = `${group.id}|${saved.index}`;
    if (shared.has(key)) {
      continue;
    }
    shared.add(key);
    group.links.add(saved.index);
    const sharedAt = saved.savedAt + (1 + rng.int(48)) * HOUR;
    const document = {
      _id: ObjectId(newId(rng)),
      groupId: ObjectId(group.id),
      linkId: ObjectId(links[saved.index].id),
      sharedBy: ObjectId(sharer.id),
      sharedAt: new Date(sharedAt),
      commentCount: 0,
      commentsRevision: 0,
    };
    if (rng.next() < 0.2) {
      const others = group.members.filter((member) => member !== sharer);
      document.knowSomeoneUserIds = [ObjectId(rng.pick(others).id)];
    }
    document.tags = [];
    document.pinned = false;
    document.lvSeedBatch = BATCH;
    out.group_links.push(document);
    t += 1;
  }

  // -- applications y application_events (apps/api/src/modules/applications/infrastructure/application.schemas.ts) --
  // Alta de cada una con su primer evento (`createApplication`: from ausente, to = estado inicial). Se reparten en
  // círculo entre los usuarios con links, cada una sobre un link que el usuario tiene guardado.
  const next = users.map(() => 0);
  let created = 0;
  let pointer = 0;
  while (created < APPLICATIONS_PER_UNIT) {
    const slot = pointer % USERS_WITH_LINKS;
    pointer += 1;
    const user = users[slot];
    if (next[slot] >= user.linkCount) {
      continue;
    }
    const saved = user.links[next[slot]];
    next[slot] += 1;
    const status = APPLICATION_STATUSES[rng.int(APPLICATION_STATUSES.length)];
    const visibility = rng.next() < 0.6 ? 'group' : 'private';
    const at = saved.savedAt + (1 + rng.int(72)) * HOUR;
    const applicationId = newId(rng);
    const document = {
      _id: ObjectId(applicationId),
      userId: ObjectId(user.id),
      linkId: ObjectId(links[saved.index].id),
      status,
    };
    if (status === 'in_process') {
      document.stageLabel = 'Entrevista técnica';
    }
    document.visibility = visibility;
    document.notes = '';
    if (APPLIED_AT_STATUSES.includes(status)) {
      document.appliedAt = new Date(at);
    }
    document.statusChangedAt = new Date(at);
    document.version = 1;
    document.createdAt = new Date(at);
    document.updatedAt = new Date(at);
    document.lvSeedBatch = BATCH;
    out.applications.push(document);
    const event = {
      _id: ObjectId(newId(rng)),
      applicationId: ObjectId(applicationId),
      userId: ObjectId(user.id),
      to: status,
    };
    if (status === 'in_process') {
      event.stageLabel = 'Entrevista técnica';
    }
    event.at = new Date(at);
    event.lvSeedBatch = BATCH;
    out.application_events.push(event);
    facts.applications += 1;
    created += 1;
    // Visible para otro miembro: visibilidad de grupo sobre un link compartido en un grupo del que el autor es miembro
    // (los grupos tienen siempre al menos dos miembros). Sin grupo, o con el link sin compartir en él, no lo es.
    if (visibility === 'group') {
      facts.groupApplications += 1;
      if (user.group !== undefined && user.group.links.has(saved.index)) {
        facts.groupVisibleApplications += 1;
      }
    }
  }

  // -- cv_documents (apps/api/src/modules/cv/infrastructure/cv.schemas.ts) --
  // Un CV por usuario de los 40 primeros, con el texto extraído y SIN objeto en el almacén.
  const cvs = [];
  for (let i = 0; i < USERS_WITH_CV; i += 1) {
    const user = users[i];
    const cvId = newId(rng);
    const text = `Synthetic CV text for ${BATCH} user ${pad(user.number, 4)}. No personal data.`;
    const uploadedAt = user.createdAt + (1 + rng.int(10)) * DAY;
    cvs.push(cvId);
    // Contador de versiones (apps/api/src/modules/cv/infrastructure/cv.schemas.ts: cvVersionCounterSchema, `_id` = id del
    // usuario en hexadecimal). Su `next` guarda la ÚLTIMA versión entregada (mongo-cv.repository.ts: `$inc` con
    // `returnDocument: 'after'`, la primera vez 1): el CV sembrado es la v1, así que vale 1 y el siguiente CV de la
    // cuenta es la v2. Decisión del owner 2026-10-08.
    out.cv_version_counters.push({
      _id: user.id,
      next: 1,
      lvSeedBatch: BATCH,
    });
    out.cv_documents.push({
      _id: ObjectId(cvId),
      userId: ObjectId(user.id),
      fileKey: `${user.id}/${cvId}`,
      fileName: `seed-${BATCH}-${pad(user.number, 4)}.pdf`,
      fileType: 'pdf',
      sizeBytes: 20000 + rng.int(60000),
      version: 1,
      isDefault: true,
      uploadedAt: new Date(uploadedAt),
      extraction: {
        status: 'extracted',
        textChars: text.length,
        extractedAt: new Date(uploadedAt + 5000),
      },
      extractedText: text,
      truncated: false,
      lvSeedBatch: BATCH,
    });
    facts.cvs += 1;
  }

  // -- ai_analyses (apps/api/src/modules/match/infrastructure/analysis.schemas.ts) y roadmaps (roadmap.schemas.ts) --
  // Tres análisis por usuario con CV, sobre un CV y un link suyos. Por el índice a: a % 4 === 0 y 1 terminan (`done`),
  // 2 sigue `running` y 3 es `failed`; a % 8 === 1 termina degradado. Cada análisis con a % 4 === 0 tiene roadmap.
  let a = 0;
  let r = 0;
  for (let i = 0; i < USERS_WITH_CV; i += 1) {
    const user = users[i];
    for (let t = 0; t < ANALYSES_PER_USER; t += 1) {
      const saved = user.links[t % user.linkCount];
      const link = links[saved.index];
      const analysisId = newId(rng);
      const requestedAt = saved.savedAt + (1 + rng.int(24)) * HOUR;
      const slot = a % 4;
      const document = {
        _id: ObjectId(analysisId),
        userId: ObjectId(user.id),
        linkId: ObjectId(link.id),
        cvId: ObjectId(cvs[i]),
      };
      let finishedAt = null;
      if (slot <= 1) {
        const degraded = a % 8 === 1;
        const durationMs = 2000 + rng.int(8000);
        finishedAt = requestedAt + durationMs;
        document.status = 'done';
        document.step = degraded ? 'done-degraded' : 'done';
        document.previewVersion = link.previewVersion;
        document.promptVersion = 'seed.v1';
        document.provider = 'seed';
        document.model = 'seed-model';
        document.report = {
          score: 40 + rng.int(60),
          matchedSkills: [SKILL_NAMES[a % SKILL_NAMES.length]],
          missingSkills: [
            {
              name: SKILL_NAMES[(a + 2) % SKILL_NAMES.length],
              importance: 'must',
            },
          ],
          suggestions: [],
          degraded,
        };
        if (degraded) {
          document.report.degradedReason = 'no_providers';
          document.degraded = true;
          document.degradedReason = 'no_providers';
        }
        document.consentRequired = false;
        document.wentExternal = false;
        document.requestedAt = new Date(requestedAt);
        document.finishedAt = new Date(finishedAt);
        document.durationMs = durationMs;
        facts.aiGenerated += 1;
      } else if (slot === 2) {
        document.status = 'running';
        document.step = 'comparing-cv';
        document.previewVersion = link.previewVersion;
        document.promptVersion = 'seed.v1';
        document.consentRequired = false;
        document.wentExternal = false;
        document.requestedAt = new Date(requestedAt);
      } else {
        const durationMs = 1000 + rng.int(4000);
        finishedAt = requestedAt + durationMs;
        document.status = 'failed';
        document.step = 'failed';
        document.previewVersion = link.previewVersion;
        document.promptVersion = 'seed.v1';
        document.failureCode = 'internal_error';
        document.consentRequired = false;
        document.wentExternal = false;
        document.requestedAt = new Date(requestedAt);
        document.finishedAt = new Date(finishedAt);
        document.durationMs = durationMs;
      }
      document.lvSeedBatch = BATCH;
      out.ai_analyses.push(document);
      facts.analyses += 1;

      if (slot === 0) {
        const index = Math.floor(a / 4);
        const status =
          index % 3 === 2
            ? index % 2 === 0
              ? 'generating'
              : 'failed'
            : 'ready';
        const createdAt = finishedAt + HOUR;
        const roadmap = {
          _id: ObjectId(newId(rng)),
          analysisId: ObjectId(analysisId),
          userId: ObjectId(user.id),
          status,
        };
        if (status === 'ready') {
          roadmap.items = [
            {
              skill: SKILL_NAMES[(a + 2) % SKILL_NAMES.length],
              priority: 1 + (r % 5),
              estimatedWeeks: 2,
              resources: [
                {
                  type: 'doc',
                  title: 'Synthetic documentation',
                  url: null,
                  provider: 'seed',
                  free: true,
                  verified: false,
                },
              ],
            },
          ];
          facts.aiGenerated += 1;
        }
        roadmap.createdAt = new Date(createdAt);
        roadmap.updatedAt = new Date(createdAt);
        roadmap.lvSeedBatch = BATCH;
        out.roadmaps.push(roadmap);
        facts.roadmaps += 1;
        r += 1;
      }
      a += 1;
    }
  }
}

function generate() {
  for (let unit = 0; unit < SCALE; unit += 1) {
    generateUnit(unit);
  }
}

// ---- Utilidades de escritura ---------------------------------------------------------------------------------------

function chunks(list) {
  const result = [];
  for (let i = 0; i < list.length; i += CHUNK) {
    result.push(list.slice(i, i + CHUNK));
  }
  return result;
}

// Filtro de borrado del lote: nunca vacío. Falla cerrado si el lote no es una cadena válida.
function batchFilter() {
  if (typeof BATCH !== 'string' || !BATCH_PATTERN.test(BATCH)) {
    fail('el lote está vacío o no casa con su expresión: no se borra nada');
  }
  const filter = { lvSeedBatch: BATCH };
  if (Object.keys(filter).length === 0 || filter.lvSeedBatch === '') {
    fail('filtro de borrado vacío: no se borra nada');
  }
  return filter;
}

// `_id` como cadena: ObjectId en casi todas las colecciones; en `cv_version_counters` ya es una cadena (el id del
// usuario en hexadecimal).
function idKey(doc) {
  return typeof doc._id === 'string' ? doc._id : doc._id.toHexString();
}

function existingIds(collection) {
  return lv[collection].find(batchFilter(), { _id: 1 }).toArray().map(idKey);
}

// ---- seed ----------------------------------------------------------------------------------------------------------

function runSeed() {
  generate();
  const counts = {};
  const wanted = {};
  COLLECTIONS.forEach((name) => {
    counts[name] = out[name].length;
    wanted[name] = new Set(out[name].map(idKey));
  });

  // Antes de escribir nada: ningún `_id` generado puede ser de un documento que no es de este lote.
  COLLECTIONS.forEach((name) => {
    chunks(out[name]).forEach((part) => {
      const foreign = lv[name].countDocuments({
        _id: { $in: part.map((doc) => doc._id) },
        lvSeedBatch: { $ne: BATCH },
      });
      if (foreign > 0) {
        fail(
          `${name}: ${foreign} documentos con un _id del lote que no son del lote: no se escribe nada`,
        );
      }
    });
  });

  // Borrar primero lo del lote que ya no se genera: si no, un índice único (email, inviteCode, dedupeKey, ...) chocaría.
  let removed = 0;
  COLLECTIONS.forEach((name) => {
    const stale = existingIds(name).filter((id) => !wanted[name].has(id));
    chunks(stale).forEach((part) => {
      removed += lv[name].deleteMany({
        _id: {
          $in: part.map((id) =>
            name === 'cv_version_counters' ? id : ObjectId(id),
          ),
        },
        lvSeedBatch: BATCH,
      }).deletedCount;
    });
  });

  let inserted = 0;
  let modified = 0;
  COLLECTIONS.forEach((name) => {
    chunks(out[name]).forEach((part) => {
      const result = lv[name].bulkWrite(
        part.map((doc) => ({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        })),
        { ordered: false },
      );
      inserted += result.upsertedCount;
      modified += result.modifiedCount;
    });
  });

  print(
    JSON.stringify({
      mode: 'seed',
      batch: BATCH,
      scale: SCALE,
      seed: SEED,
      inserted,
      modified,
      removed,
      counts,
    }),
  );
}

// ---- digest --------------------------------------------------------------------------------------------------------

function runDigest() {
  COLLECTIONS.forEach((name) => {
    lv[name]
      .find(batchFilter())
      .sort({ _id: 1 })
      .forEach((doc) => {
        print(`${name}\t${EJSON.stringify(doc, { relaxed: false })}`);
      });
  });
}

// ---- expect --------------------------------------------------------------------------------------------------------

function runExpect() {
  generate();
  print(
    JSON.stringify({
      users: facts.users,
      activatedUsers: facts.activatedUsers,
      usersWith3PlusLinks: facts.usersWith3PlusLinks,
      groups: facts.groups,
      membersInLargestGroup: facts.membersInLargestGroup,
      links: facts.linkIds.size,
      applications: facts.applications,
      groupVisibleApplications: facts.groupVisibleApplications,
      cvs: facts.cvs,
      analyses: facts.analyses,
      roadmaps: facts.roadmaps,
      aiGenerated: facts.aiGenerated,
    }),
  );
}

// ---- clean ---------------------------------------------------------------------------------------------------------

function runClean() {
  const filter = batchFilter();
  const batchUsers = lv.users
    .find(filter, { _id: 1 })
    .toArray()
    .map((doc) => doc._id);
  const batchLinks = lv.job_links
    .find(filter, { _id: 1 })
    .toArray()
    .map((doc) => doc._id);
  const batchGroups = lv.groups
    .find(filter, { _id: 1 })
    .toArray()
    .map((doc) => doc._id);

  // 1. Relaciones cruzadas: algo sin la marca del lote, de alguien que no es del lote, que apunta a un link o grupo del
  //    lote. Borrar el lote lo dejaría colgando: se niega, sin borrar nada.
  const hexUsers = batchUsers.map((id) => id.toHexString());
  const notOurs = { lvSeedBatch: { $ne: BATCH } };
  const foreign = (coll, extra) =>
    lv[coll].countDocuments({ ...notOurs, ...extra });
  const cross = {
    user_links: foreign('user_links', {
      userId: { $nin: batchUsers },
      linkId: { $in: batchLinks },
    }),
    group_links: foreign('group_links', {
      sharedBy: { $nin: batchUsers },
      $or: [{ linkId: { $in: batchLinks } }, { groupId: { $in: batchGroups } }],
    }),
    group_members: foreign('group_members', {
      userId: { $nin: batchUsers },
      groupId: { $in: batchGroups },
    }),
    applications: foreign('applications', {
      userId: { $nin: batchUsers },
      linkId: { $in: batchLinks },
    }),
  };
  // Un evento del outbox que nombra a la vez a alguien del lote y a alguien que no lo es.
  cross.outbox_events = foreign('outbox_events', {
    $or: [
      {
        'payload.userId': { $in: hexUsers },
        'payload.actorUserId': { $exists: true, $nin: hexUsers },
      },
      {
        'payload.actorUserId': { $in: hexUsers },
        'payload.userId': { $exists: true, $nin: hexUsers },
      },
    ],
  });
  const crossTotal = Object.values(cross).reduce((sum, n) => sum + n, 0);
  if (crossTotal > 0) {
    fail(
      `no se borra nada: ${crossTotal} documentos de alguien que no es del lote se relacionan con un link o un grupo del lote ${JSON.stringify(cross)}`,
    );
  }

  // 2. Cascada de borrado de cuenta, por usuario del lote.
  const cascade = {};
  CASCADE.forEach(({ coll, field, key }) => {
    const ids = key === 'hex' ? hexUsers : batchUsers;
    let n = 0;
    chunks(ids).forEach((part) => {
      n += lv[coll].deleteMany({ [field]: { $in: part } }).deletedCount;
    });
    cascade[coll] = (cascade[coll] ?? 0) + n;
  });
  // Contador de versiones de CV: su `_id` es el id del usuario en hexadecimal.
  let counters = 0;
  chunks(hexUsers).forEach((part) => {
    counters += lv.cv_version_counters.deleteMany({
      _id: { $in: part },
    }).deletedCount;
  });
  cascade.cv_version_counters = counters;

  // 3. Lo marcado, en cada colección de la tabla.
  const removed = {};
  COLLECTIONS.forEach((name) => {
    removed[name] = lv[name].deleteMany(batchFilter()).deletedCount;
  });

  print(JSON.stringify({ mode: 'clean', batch: BATCH, cascade, removed }));
}

if (MODE === 'seed') {
  runSeed();
} else if (MODE === 'digest') {
  runDigest();
} else if (MODE === 'expect') {
  runExpect();
} else {
  runClean();
}
