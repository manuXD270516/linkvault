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
 */
export function buildSearchAclFilter(input: {
  readonly userId: string;
  readonly memberGroupIds: readonly string[];
  readonly docType?: string;
  readonly groupId?: string;
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

  if (input.docType === undefined) {
    return acl;
  }
  // CV / roadmap: solo owner, aunque el docType filtre.
  if (input.docType === 'cv' || input.docType === 'roadmap') {
    return `(${acl}) AND docType = "${input.docType}" AND ownerUserId = "${escapeMeili(
      input.userId,
    )}"`;
  }
  return `(${acl}) AND docType = "${escapeMeili(input.docType)}"`;
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
