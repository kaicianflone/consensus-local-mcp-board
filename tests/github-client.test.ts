import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFileSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

const { fetchStalePRs, fetchFailedChecksPRs, fetchUnreviewedPRs, fetchTriageIssues } = await import('../server/src/adapters/github-client.js');

function ghReturns(data: any) {
  mockExecFileSync.mockReturnValueOnce(JSON.stringify(data));
}

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

describe('GitHub CLI Client', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  // ── fetchStalePRs ──

  describe('fetchStalePRs', () => {
    it('returns empty array when repo is missing', () => {
      expect(fetchStalePRs('', 7)).toEqual([]);
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it('returns empty array when staleDays < 1', () => {
      expect(fetchStalePRs('owner/repo', 0)).toEqual([]);
    });

    it('filters PRs by stale threshold', () => {
      ghReturns([
        { number: 1, title: 'Old PR', author: { login: 'alice' }, url: 'https://github.com/o/r/pull/1', headRefName: 'feat-old', baseRefName: 'main', createdAt: daysAgo(20), updatedAt: daysAgo(10) },
        { number: 2, title: 'Fresh PR', author: { login: 'bob' }, url: 'https://github.com/o/r/pull/2', headRefName: 'feat-new', baseRefName: 'main', createdAt: daysAgo(2), updatedAt: daysAgo(1) },
      ]);

      const result = fetchStalePRs('owner/repo', 7);

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
      expect(result[0].title).toBe('Old PR');
      expect(result[0].author).toBe('alice');
      expect(result[0].daysSinceUpdate).toBeGreaterThanOrEqual(10);
    });

    it('filters by baseBranch when provided', () => {
      ghReturns([
        { number: 1, title: 'Main PR', author: { login: 'alice' }, url: '', headRefName: 'feat', baseRefName: 'main', createdAt: daysAgo(20), updatedAt: daysAgo(10) },
        { number: 2, title: 'Dev PR', author: { login: 'bob' }, url: '', headRefName: 'feat2', baseRefName: 'develop', createdAt: daysAgo(20), updatedAt: daysAgo(10) },
      ]);

      const result = fetchStalePRs('owner/repo', 7, 'main');
      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
    });

    it('returns empty array on gh CLI error', () => {
      mockExecFileSync.mockImplementationOnce(() => { throw new Error('gh not found'); });
      expect(fetchStalePRs('owner/repo', 7)).toEqual([]);
    });
  });

  // ── fetchFailedChecksPRs ──

  describe('fetchFailedChecksPRs', () => {
    it('returns empty array when repo is missing', () => {
      expect(fetchFailedChecksPRs('', 6)).toEqual([]);
    });

    it('finds PRs with failing checks beyond threshold', () => {
      // First call: PR list
      ghReturns([
        { number: 1, title: 'Broken PR', author: { login: 'alice' }, url: '', headRefName: 'feat', baseRefName: 'main' },
        { number: 2, title: 'OK PR', author: { login: 'bob' }, url: '', headRefName: 'feat2', baseRefName: 'main' },
      ]);

      // Second call: checks for PR #1
      ghReturns([
        { name: 'CI', state: 'FAILURE', completedAt: hoursAgo(12), detailsUrl: 'https://ci/1' },
        { name: 'Lint', state: 'SUCCESS', completedAt: hoursAgo(12), detailsUrl: '' },
      ]);

      // Third call: checks for PR #2
      ghReturns([
        { name: 'CI', state: 'SUCCESS', completedAt: hoursAgo(1), detailsUrl: '' },
      ]);

      const result = fetchFailedChecksPRs('owner/repo', 6);

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
      expect(result[0].failedChecks).toHaveLength(1);
      expect(result[0].failedChecks[0].name).toBe('CI');
    });

    it('excludes recently failed checks below hour threshold', () => {
      ghReturns([
        { number: 1, title: 'PR', author: { login: 'alice' }, url: '', headRefName: 'feat', baseRefName: 'main' },
      ]);

      ghReturns([
        { name: 'CI', state: 'FAILURE', completedAt: hoursAgo(2), detailsUrl: '' },
      ]);

      const result = fetchFailedChecksPRs('owner/repo', 6);
      expect(result).toHaveLength(0);
    });
  });

  // ── fetchUnreviewedPRs ──

  describe('fetchUnreviewedPRs', () => {
    it('returns empty array when repo is missing', () => {
      expect(fetchUnreviewedPRs('', 2)).toEqual([]);
    });

    it('finds PRs without approved review beyond threshold', () => {
      ghReturns([
        { number: 1, title: 'Waiting PR', author: { login: 'alice' }, url: '', headRefName: 'feat', baseRefName: 'main', createdAt: daysAgo(5), reviewDecision: '' },
        { number: 2, title: 'Approved PR', author: { login: 'bob' }, url: '', headRefName: 'feat2', baseRefName: 'main', createdAt: daysAgo(5), reviewDecision: 'APPROVED' },
        { number: 3, title: 'New PR', author: { login: 'charlie' }, url: '', headRefName: 'feat3', baseRefName: 'main', createdAt: daysAgo(0), reviewDecision: '' },
      ]);

      const result = fetchUnreviewedPRs('owner/repo', 2);

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
      expect(result[0].reviewDecision).toBe('PENDING');
      expect(result[0].daysPending).toBeGreaterThanOrEqual(5);
    });
  });

  // ── fetchTriageIssues ──

  describe('fetchTriageIssues', () => {
    it('returns empty array when repo is missing', () => {
      expect(fetchTriageIssues('', true, true)).toEqual([]);
    });

    it('returns empty array when both flags are false', () => {
      expect(fetchTriageIssues('owner/repo', false, false)).toEqual([]);
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it('finds unlabeled issues when includeUnlabeled is true', () => {
      ghReturns([
        { number: 1, title: 'No labels', url: '', createdAt: daysAgo(3), labels: [], assignees: [{ login: 'alice' }] },
        { number: 2, title: 'Has labels', url: '', createdAt: daysAgo(3), labels: [{ name: 'bug' }], assignees: [{ login: 'bob' }] },
      ]);

      const result = fetchTriageIssues('owner/repo', true, false);
      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
      expect(result[0].reason).toBe('unlabeled');
    });

    it('finds unassigned issues when includeUnassigned is true', () => {
      ghReturns([
        { number: 1, title: 'Assigned', url: '', createdAt: daysAgo(3), labels: [{ name: 'bug' }], assignees: [{ login: 'alice' }] },
        { number: 2, title: 'Unassigned', url: '', createdAt: daysAgo(3), labels: [{ name: 'feature' }], assignees: [] },
      ]);

      const result = fetchTriageIssues('owner/repo', false, true);
      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(2);
      expect(result[0].reason).toBe('unassigned');
    });

    it('marks issues as both when unlabeled and unassigned', () => {
      ghReturns([
        { number: 1, title: 'Needs triage', url: '', createdAt: daysAgo(1), labels: [], assignees: [] },
      ]);

      const result = fetchTriageIssues('owner/repo', true, true);
      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe('both');
    });
  });
});
