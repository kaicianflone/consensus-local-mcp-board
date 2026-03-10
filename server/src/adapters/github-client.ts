// ── GitHub CLI adapter for cron-triggered events ──
// Uses `gh` CLI (must be authenticated) — follows the same execFileSync pattern as runner.ts.

import { execFileSync } from 'node:child_process';

const GH_TIMEOUT = 15_000;

// ── Types ──

export type StalePR = {
  number: number;
  title: string;
  author: string;
  url: string;
  headBranch: string;
  baseBranch: string;
  createdAt: string;
  updatedAt: string;
  daysSinceUpdate: number;
};

export type FailedCheckPR = {
  number: number;
  title: string;
  author: string;
  url: string;
  headBranch: string;
  failedChecks: { name: string; completedAt: string; detailsUrl: string }[];
};

export type UnreviewedPR = {
  number: number;
  title: string;
  author: string;
  url: string;
  headBranch: string;
  createdAt: string;
  reviewDecision: string;
  daysPending: number;
};

export type TriageIssue = {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  labels: string[];
  assignees: string[];
  reason: 'unlabeled' | 'unassigned' | 'both';
};

// ── Helpers ──

function ghJson(args: string[]): any {
  const raw = execFileSync('gh', args, { encoding: 'utf8', timeout: GH_TIMEOUT }).trim();
  return JSON.parse(raw || '[]');
}

function daysBetween(dateStr: string): number {
  return Math.floor((Date.now() - Date.parse(dateStr)) / 86_400_000);
}

function hoursBetween(dateStr: string): number {
  return Math.floor((Date.now() - Date.parse(dateStr)) / 3_600_000);
}

// ── Fetch stale PRs (no activity in N days) ──

export function fetchStalePRs(
  repo: string,
  staleDays: number,
  baseBranch?: string,
): StalePR[] {
  if (!repo || staleDays < 1) return [];

  try {
    const prs = ghJson([
      'pr', 'list', '--repo', repo, '--state', 'open',
      '--json', 'number,title,author,url,headRefName,baseRefName,createdAt,updatedAt',
      '--limit', '100',
    ]);

    let filtered = prs.filter((pr: any) => daysBetween(pr.updatedAt) >= staleDays);
    if (baseBranch) {
      filtered = filtered.filter((pr: any) => pr.baseRefName === baseBranch);
    }

    return filtered.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      author: pr.author?.login || pr.author?.name || '',
      url: pr.url,
      headBranch: pr.headRefName,
      baseBranch: pr.baseRefName,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      daysSinceUpdate: daysBetween(pr.updatedAt),
    }));
  } catch (e: any) {
    console.warn(`[github-client] fetchStalePRs failed for ${repo}: ${e?.message}`);
    return [];
  }
}

// ── Fetch PRs with failing CI checks ──

export function fetchFailedChecksPRs(
  repo: string,
  failedForHours: number,
  baseBranch?: string,
): FailedCheckPR[] {
  if (!repo || failedForHours < 0) return [];

  try {
    let prs = ghJson([
      'pr', 'list', '--repo', repo, '--state', 'open',
      '--json', 'number,title,author,url,headRefName,baseRefName',
      '--limit', '50',
    ]);

    if (baseBranch) {
      prs = prs.filter((pr: any) => pr.baseRefName === baseBranch);
    }

    const results: FailedCheckPR[] = [];
    for (const pr of prs) {
      try {
        const checks = ghJson([
          'pr', 'checks', String(pr.number), '--repo', repo,
          '--json', 'name,state,completedAt,detailsUrl',
        ]);

        const failed = checks.filter((c: any) =>
          c.state === 'FAILURE' && c.completedAt && hoursBetween(c.completedAt) >= failedForHours
        );

        if (failed.length > 0) {
          results.push({
            number: pr.number,
            title: pr.title,
            author: pr.author?.login || pr.author?.name || '',
            url: pr.url,
            headBranch: pr.headRefName,
            failedChecks: failed.map((c: any) => ({
              name: c.name,
              completedAt: c.completedAt,
              detailsUrl: c.detailsUrl || '',
            })),
          });
        }
      } catch { /* individual PR check fetch is best-effort */ }
    }
    return results;
  } catch (e: any) {
    console.warn(`[github-client] fetchFailedChecksPRs failed for ${repo}: ${e?.message}`);
    return [];
  }
}

// ── Fetch unreviewed PRs (awaiting review beyond threshold) ──

export function fetchUnreviewedPRs(
  repo: string,
  pendingDays: number,
  baseBranch?: string,
): UnreviewedPR[] {
  if (!repo || pendingDays < 0) return [];

  try {
    let prs = ghJson([
      'pr', 'list', '--repo', repo, '--state', 'open',
      '--json', 'number,title,author,url,headRefName,baseRefName,createdAt,reviewDecision',
      '--limit', '100',
    ]);

    if (baseBranch) {
      prs = prs.filter((pr: any) => pr.baseRefName === baseBranch);
    }

    return prs
      .filter((pr: any) => pr.reviewDecision !== 'APPROVED' && daysBetween(pr.createdAt) >= pendingDays)
      .map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        author: pr.author?.login || pr.author?.name || '',
        url: pr.url,
        headBranch: pr.headRefName,
        createdAt: pr.createdAt,
        reviewDecision: pr.reviewDecision || 'PENDING',
        daysPending: daysBetween(pr.createdAt),
      }));
  } catch (e: any) {
    console.warn(`[github-client] fetchUnreviewedPRs failed for ${repo}: ${e?.message}`);
    return [];
  }
}

// ── Fetch issues needing triage (unlabeled and/or unassigned) ──

export function fetchTriageIssues(
  repo: string,
  includeUnlabeled: boolean,
  includeUnassigned: boolean,
): TriageIssue[] {
  if (!repo || (!includeUnlabeled && !includeUnassigned)) return [];

  try {
    const issues = ghJson([
      'issue', 'list', '--repo', repo, '--state', 'open',
      '--json', 'number,title,url,createdAt,labels,assignees',
      '--limit', '100',
    ]);

    return issues
      .filter((issue: any) => {
        const noLabels = !issue.labels || issue.labels.length === 0;
        const noAssignees = !issue.assignees || issue.assignees.length === 0;
        return (includeUnlabeled && noLabels) || (includeUnassigned && noAssignees);
      })
      .map((issue: any) => {
        const noLabels = !issue.labels || issue.labels.length === 0;
        const noAssignees = !issue.assignees || issue.assignees.length === 0;
        const reason = (noLabels && noAssignees) ? 'both' : noLabels ? 'unlabeled' : 'unassigned';
        return {
          number: issue.number,
          title: issue.title,
          url: issue.url,
          createdAt: issue.createdAt,
          labels: (issue.labels || []).map((l: any) => l.name || l),
          assignees: (issue.assignees || []).map((a: any) => a.login || a.name || a),
          reason: reason as 'unlabeled' | 'unassigned' | 'both',
        };
      });
  } catch (e: any) {
    console.warn(`[github-client] fetchTriageIssues failed for ${repo}: ${e?.message}`);
    return [];
  }
}
