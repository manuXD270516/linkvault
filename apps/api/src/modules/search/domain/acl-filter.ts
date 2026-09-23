/**
 * Filtro ACL server-side (D6 / C14). El cliente NO puede ampliar alcance.
 *
 * (ownerUserId = me AND visibilityScope IN [owner, owner_and_groups])
 * OR (
 *   groupIds IN mis grupos
 *   AND visibilityScope IN [group, owner_and_groups]
 *   AND docType IN [job_preview, group_comment, group_link_note]
 * )
 *
 * CV y roadmap solo por owner (impuesto además si se pide docType).
 *
 * Filtros LatAm (search-latam-filters D1) se AND al ACL: modality, status
 * (desde query `applicationStatus`), salaryCurrency.
 */
export function buildSearchAclFilter(input: {
  readonly userId: string;
  readonly memberGroupIds: readonly string[];
  readonly docType?: string;
  readonly groupId?: string;
  readonly modality?: string;
  /** Atributo Meili `status` (mapeado desde query param `applicationStatus`). */
  readonly status?: string;
  readonly salaryCurrency?: string;
}): string {
  const ownerBranch = `(ownerUserId = "${escapeMeili(
    input.userId,
  )}" AND visibilityScope IN ["owner", "owner_and_groups"])`;

  const groupIds = filterAllowedGroups(
    input.memberGroupIds,
    input.groupId,
  );
  let groupBranch: string | null = null;
  if (groupIds.length > 0) {
    const groupsExpr = groupIds
      .map((id) => `groupIds = "${escapeMeili(id)}"`)
      .join(' OR ');
    groupBranch = `((${groupsExpr}) AND visibilityScope IN ["group", "owner_and_groups"] AND docType IN ["job_preview", "group_comment", "group_link_note"])`;
  }

  const acl =
    groupBranch === null
      ? ownerBranch
      : `(${ownerBranch} OR ${groupBranch})`;

  let filter: string;
  if (input.docType === undefined) {
    filter = acl;
  } else if (input.docType === 'cv' || input.docType === 'roadmap') {
    // CV / roadmap: solo owner, aunque el docType filtre.
    filter = `(${acl}) AND docType = "${input.docType}" AND ownerUserId = "${escapeMeili(
      input.userId,
    )}"`;
  } else {
    filter = `(${acl}) AND docType = "${escapeMeili(input.docType)}"`;
  }

  return appendLatAmFilters(filter, input);
}

function appendLatAmFilters(
  base: string,
  input: {
    readonly modality?: string;
    readonly status?: string;
    readonly salaryCurrency?: string;
  },
): string {
  const clauses: string[] = [base];
  if (input.modality !== undefined) {
    clauses.push(`modality = "${escapeMeili(input.modality)}"`);
  }
  if (input.status !== undefined) {
    clauses.push(`status = "${escapeMeili(input.status)}"`);
  }
  if (input.salaryCurrency !== undefined) {
    clauses.push(`salaryCurrency = "${escapeMeili(input.salaryCurrency)}"`);
  }
  return clauses.length === 1 ? clauses[0]! : clauses.join(' AND ');
}

function filterAllowedGroups(
  memberGroupIds: readonly string[],
  requested?: string,
): string[] {
  if (requested === undefined) {
    return [...memberGroupIds];
  }
  return memberGroupIds.includes(requested) ? [requested] : [];
}

function escapeMeili(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
