import { describe, expect, it } from 'vitest';
import { buildSearchAclFilter } from './acl-filter';

describe('buildSearchAclFilter', () => {
  it('includes owner branch and group branch with visibilityScope', () => {
    const filter = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: ['g1', 'g2'],
    });
    expect(filter).toContain('ownerUserId = "ana"');
    expect(filter).toContain('visibilityScope IN ["owner", "owner_and_groups"]');
    expect(filter).toContain('groupIds = "g1"');
    expect(filter).toContain(
      'visibilityScope IN ["group", "owner_and_groups"]',
    );
    expect(filter).toContain(
      'docType IN ["job_preview", "group_comment", "group_link_note"]',
    );
  });

  it('ignores a groupId the user does not belong to', () => {
    const filter = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: ['g1'],
      groupId: 'strangers',
    });
    expect(filter).not.toContain('strangers');
    expect(filter).toContain('ownerUserId = "ana"');
  });

  it('forces owner-only for cv and roadmap', () => {
    const filter = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: ['g1'],
      docType: 'cv',
    });
    expect(filter).toContain('docType = "cv"');
    expect(filter).toContain('ownerUserId = "ana"');
  });

  it('ANDs LatAm filters mapping applicationStatus to status', () => {
    const filter = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: [],
      modality: 'remote',
      status: 'applied',
      salaryCurrency: 'USD',
    });
    expect(filter).toContain('ownerUserId = "ana"');
    expect(filter).toContain('modality = "remote"');
    expect(filter).toContain('status = "applied"');
    expect(filter).toContain('salaryCurrency = "USD"');
    expect(filter).toMatch(
      /modality = "remote" AND status = "applied" AND salaryCurrency = "USD"$/,
    );
  });

  it('ANDs closedAt IS NULL when openOnly is true', () => {
    const filter = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: [],
      openOnly: true,
    });
    expect(filter).toContain('ownerUserId = "ana"');
    expect(filter).toMatch(/closedAt IS NULL$/);
  });

  it('does not add closedAt clause when openOnly is false or absent', () => {
    expect(
      buildSearchAclFilter({
        userId: 'ana',
        memberGroupIds: [],
        openOnly: false,
      }),
    ).not.toContain('closedAt');
    expect(
      buildSearchAclFilter({ userId: 'ana', memberGroupIds: [] }),
    ).not.toContain('closedAt');
  });

  it('ANDs D1 salary overlap when minSalary and/or maxSalary are set', () => {
    const both = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: [],
      minSalary: 4000,
      maxSalary: 6000,
    });
    expect(both).toContain(
      '((salaryMax >= 4000) OR (salaryMax IS NULL AND salaryMin >= 4000))',
    );
    expect(both).toContain(
      '((salaryMin <= 6000) OR (salaryMin IS NULL AND salaryMax <= 6000))',
    );

    const onlyMin = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: [],
      minSalary: 4000,
    });
    expect(onlyMin).toContain(
      '((salaryMax >= 4000) OR (salaryMax IS NULL AND salaryMin >= 4000))',
    );
    expect(onlyMin).not.toContain('salaryMin <=');

    const onlyMax = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: [],
      maxSalary: 4000,
    });
    expect(onlyMax).toContain(
      '((salaryMin <= 4000) OR (salaryMin IS NULL AND salaryMax <= 4000))',
    );
    expect(onlyMax).not.toContain('salaryMax >=');
  });

  it('does not add salary range clauses when bounds are absent', () => {
    const filter = buildSearchAclFilter({
      userId: 'ana',
      memberGroupIds: [],
    });
    expect(filter).not.toContain('salaryMin');
    expect(filter).not.toContain('salaryMax');
  });
});
