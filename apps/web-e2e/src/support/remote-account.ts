import {
  applicationListResponseSchema,
  cvListResponseSchema,
  groupSummarySchema,
  linkPageSchema,
  type UserProfile,
  userProfileSchema,
} from '@linkvault/shared';
import type { SuiteApi } from './suite-api';

/**
 * Prefijo de lo que crea la suite (design D10): los grupos del recorrido se llaman `e2e-…` y los CV, `e2e-*`, para que
 * la limpieza previa y final de la cuenta remota sepa qué es suyo.
 */
export const SUITE_PREFIX = 'e2e-';

/** Alias que declara una cuenta de prueba (design D10): un buzón del autor con `+e2e`. */
export const TEST_ACCOUNT_ALIAS = '+e2e';

/**
 * Por qué una cuenta **no** puede usarse como cuenta de prueba remota (design D10), a partir de `GET /api/users/me`.
 * Vacío = los tres guardias pasan: email sin verificar (con él recibiría avisos por correo real), permiso de IA externa
 * apagado (con él el CV iría a un proveedor externo y gastaría la cuota compartida) y email con el alias `+e2e` (sin él
 * podría ser la cuenta de una persona).
 */
export function remoteAccountProblems(profile: Pick<UserProfile, 'email' | 'emailVerified' | 'aiConsent'>): string[] {
  const problems: string[] = [];
  if (profile.emailVerified) {
    problems.push('the email is verified (emailVerified: true): the account would receive product emails');
  }
  if (profile.aiConsent.externalProviders) {
    problems.push(
      'the external AI permission is granted (aiConsent.externalProviders: true): the CV would go to an external provider',
    );
  }
  const [localPart = ''] = profile.email.split('@');
  if (!localPart.includes(TEST_ACCOUNT_ALIAS)) {
    problems.push(`the email ${profile.email} has no ${TEST_ACCOUNT_ALIAS} alias: it could be a person's account`);
  }
  return problems;
}

/** Solo este módulo puede dar fe de que los guardias pasaron: la limpieza exige un `GuardedAccount`. */
const GUARDS_PASSED = Symbol('remote account guards passed');

/** Cuenta remota cuyos guardias pasaron. Solo la crea `assertRemoteAccountGuards`: sin ella no se limpia nada. */
export class GuardedAccount {
  constructor(
    token: typeof GUARDS_PASSED,
    readonly api: SuiteApi,
    readonly email: string,
  ) {
    if (token !== GUARDS_PASSED) {
      throw new Error('GuardedAccount is only created by assertRemoteAccountGuards');
    }
  }
}

/**
 * Guardias de la cuenta remota por `GET /api/users/me` (design D10, tarea 4.3a), **antes** de cualquier cambio en la
 * cuenta, incluida la limpieza: si alguno falla, lanza nombrándolo y la cuenta queda como estaba.
 */
export async function assertRemoteAccountGuards(api: SuiteApi): Promise<GuardedAccount> {
  const profile = await api.get('users/me', userProfileSchema);
  const problems = remoteAccountProblems(profile);
  if (problems.length > 0) {
    throw new Error(
      `the remote test account ${profile.email} fails its guards (design D10); nothing in the account was changed: ${problems.join('; ')}`,
    );
  }
  return new GuardedAccount(GUARDS_PASSED, api, profile.email);
}

export interface SweepReport {
  readonly groups: number;
  readonly applications: number;
  readonly cvs: number;
}

/** Ids de todos los links de un grupo, página a página. */
async function groupLinkIds(api: SuiteApi, groupId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const query = cursor === undefined ? 'limit=50' : `limit=50&cursor=${encodeURIComponent(cursor)}`;
    const page = await api.get(`groups/${groupId}/links?${query}`, linkPageSchema);
    ids.push(...page.items.map((link) => link.id));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return ids;
}

/**
 * Borra de la cuenta lo que es de la suite (design D10, tarea 4.2): las postulaciones sobre los links de los grupos de
 * la suite, esos grupos (con `SUITE_PREFIX` y de los que la cuenta es dueña) y los CV `e2e-*`. Las postulaciones van
 * antes que los grupos: si se interrumpe a mitad, lo que queda sigue colgando de un grupo de la suite y el barrido
 * siguiente lo encuentra. Sirve para el barrido al empezar (lo que dejó una corrida interrumpida) y para el borrado al
 * terminar. Solo acepta una cuenta cuyos guardias pasaron.
 */
export async function sweepSuiteLeftovers(account: GuardedAccount): Promise<SweepReport> {
  const { api } = account;
  const groups = (await api.get('groups', groupSummarySchema.array())).filter(
    (group) => group.role === 'owner' && group.name.startsWith(SUITE_PREFIX),
  );
  const linkIds = new Set<string>();
  for (const group of groups) {
    for (const id of await groupLinkIds(api, group.id)) {
      linkIds.add(id);
    }
  }
  const applications = (await api.get('applications', applicationListResponseSchema)).items.filter((application) =>
    linkIds.has(application.linkId),
  );
  for (const application of applications) {
    await api.delete(`applications/${application.id}`);
  }
  for (const group of groups) {
    await api.delete(`groups/${group.id}`);
  }
  const cvs = (await api.get('cv', cvListResponseSchema)).items.filter((cv) => cv.fileName.startsWith(SUITE_PREFIX));
  for (const cv of cvs) {
    await api.delete(`cv/${cv.id}`);
  }
  return { groups: groups.length, applications: applications.length, cvs: cvs.length };
}

export function describeSweep(report: SweepReport): string {
  return `${report.groups} groups, ${report.applications} applications, ${report.cvs} CVs of the suite deleted`;
}
