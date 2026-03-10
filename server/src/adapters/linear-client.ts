// ── Linear GraphQL API client ──
// Direct fetch against https://api.linear.app/graphql — no @linear/sdk dependency.

const LINEAR_API = 'https://api.linear.app/graphql';

export type LinearSubtask = {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  labels: string[];
  parent: { id: string; title: string } | null;
};

export type LinearMember = {
  id: string;
  name: string;
  displayName: string;
  email: string;
  active: boolean;
  recentTasks: {
    id: string;
    title: string;
    state: string;
    priority: number;
    labels: string[];
  }[];
};

async function gql<T = any>(apiKey: string, query: string, variables?: Record<string, any>): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Linear API ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors.map((e: any) => e.message).join('; ')}`);
  }
  return json.data as T;
}

// ── Fetch unassigned subtasks (issues with a parent and no assignee) ──

export async function fetchUnassignedSubtasks(
  apiKey: string,
  teamId: string,
  projectId?: string,
): Promise<LinearSubtask[]> {
  if (!apiKey || !teamId) return [];

  const filter: Record<string, any> = {
    team: { id: { eq: teamId } },
    assignee: { null: true },
    parent: { null: false },
  };
  if (projectId) {
    filter.project = { id: { eq: projectId } };
  }

  const data = await gql<{ issues: { nodes: any[] } }>(apiKey, `
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 50) {
        nodes {
          id
          title
          description
          priority
          labels { nodes { name } }
          parent { id title }
        }
      }
    }
  `, { filter });

  return (data.issues?.nodes || []).map((n: any) => ({
    id: n.id,
    title: n.title,
    description: n.description ?? null,
    priority: n.priority ?? 0,
    labels: (n.labels?.nodes || []).map((l: any) => l.name),
    parent: n.parent ? { id: n.parent.id, title: n.parent.title } : null,
  }));
}

// ── Fetch team members with their recent assigned tasks ──

export async function fetchTeamMembers(
  apiKey: string,
  teamId: string,
  memberIds?: string[],
): Promise<LinearMember[]> {
  if (!apiKey || !teamId) return [];

  // Step 1: Get team members
  const teamData = await gql<{ team: { members: { nodes: any[] } } }>(apiKey, `
    query($teamId: String!) {
      team(id: $teamId) {
        members(filter: { active: { eq: true } }) {
          nodes { id name displayName email active }
        }
      }
    }
  `, { teamId });

  let members = teamData.team?.members?.nodes || [];
  if (memberIds?.length) {
    const allowed = new Set(memberIds);
    members = members.filter((m: any) => allowed.has(m.id));
  }
  if (!members.length) return [];

  // Step 2: Batch-fetch recent tasks for each member using GraphQL aliases
  const aliases = members.map((m: any, i: number) =>
    `m${i}: issues(filter: { assignee: { id: { eq: "${m.id}" } } }, first: 10, orderBy: updatedAt) {
      nodes { id title state { name } priority labels { nodes { name } } }
    }`
  );
  const batchQuery = `{ ${aliases.join('\n')} }`;
  const taskData = await gql<Record<string, { nodes: any[] }>>(apiKey, batchQuery);

  return members.map((m: any, i: number) => ({
    id: m.id,
    name: m.name,
    displayName: m.displayName || m.name,
    email: m.email || '',
    active: m.active !== false,
    recentTasks: (taskData[`m${i}`]?.nodes || []).map((t: any) => ({
      id: t.id,
      title: t.title,
      state: t.state?.name || '',
      priority: t.priority ?? 0,
      labels: (t.labels?.nodes || []).map((l: any) => l.name),
    })),
  }));
}

// ── Fetch stale tasks (not updated in N days, excluding completed/cancelled) ──

export type LinearStaleTask = {
  id: string;
  title: string;
  priority: number;
  state: { name: string; type: string };
  updatedAt: string;
  assignee: { id: string; name: string } | null;
  labels: string[];
};

export async function fetchStaleTasks(
  apiKey: string,
  teamId: string,
  staleDays: number,
  projectId?: string,
): Promise<LinearStaleTask[]> {
  if (!apiKey || !teamId || staleDays < 1) return [];

  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
  const filter: Record<string, any> = {
    team: { id: { eq: teamId } },
    updatedAt: { lt: cutoff },
    state: { type: { nin: ['completed', 'canceled'] } },
  };
  if (projectId) {
    filter.project = { id: { eq: projectId } };
  }

  const data = await gql<{ issues: { nodes: any[] } }>(apiKey, `
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 50) {
        nodes {
          id
          title
          priority
          state { name type }
          updatedAt
          assignee { id name }
          labels { nodes { name } }
        }
      }
    }
  `, { filter });

  return (data.issues?.nodes || []).map((n: any) => ({
    id: n.id,
    title: n.title,
    priority: n.priority ?? 0,
    state: { name: n.state?.name || '', type: n.state?.type || '' },
    updatedAt: n.updatedAt || '',
    assignee: n.assignee ? { id: n.assignee.id, name: n.assignee.name } : null,
    labels: (n.labels?.nodes || []).map((l: any) => l.name),
  }));
}

// ── Fetch overdue tasks (past due date, excluding completed/cancelled) ──

export type LinearOverdueTask = {
  id: string;
  title: string;
  dueDate: string;
  priority: number;
  state: { name: string };
  assignee: { id: string; name: string } | null;
  labels: string[];
};

export async function fetchOverdueTasks(
  apiKey: string,
  teamId: string,
  projectId?: string,
  priorityFilter?: number,
): Promise<LinearOverdueTask[]> {
  if (!apiKey || !teamId) return [];

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filter: Record<string, any> = {
    team: { id: { eq: teamId } },
    dueDate: { lt: today },
    state: { type: { nin: ['completed', 'canceled'] } },
  };
  if (projectId) {
    filter.project = { id: { eq: projectId } };
  }
  // Linear priority: 1=urgent, 2=high, 3=medium, 4=low — lower number = higher priority
  if (priorityFilter && priorityFilter > 0) {
    filter.priority = { lte: priorityFilter };
  }

  const data = await gql<{ issues: { nodes: any[] } }>(apiKey, `
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 50) {
        nodes {
          id
          title
          dueDate
          priority
          state { name }
          assignee { id name }
          labels { nodes { name } }
        }
      }
    }
  `, { filter });

  return (data.issues?.nodes || []).map((n: any) => ({
    id: n.id,
    title: n.title,
    dueDate: n.dueDate || '',
    priority: n.priority ?? 0,
    state: { name: n.state?.name || '' },
    assignee: n.assignee ? { id: n.assignee.id, name: n.assignee.name } : null,
    labels: (n.labels?.nodes || []).map((l: any) => l.name),
  }));
}

// ── Assign an issue to a team member ──

export async function assignIssue(
  apiKey: string,
  issueId: string,
  assigneeId: string,
): Promise<{ success: boolean; issue?: { id: string; title: string; assignee: string } }> {
  if (!apiKey || !issueId || !assigneeId) {
    return { success: false };
  }

  const data = await gql<{ issueUpdate: { success: boolean; issue: any } }>(apiKey, `
    mutation($issueId: String!, $assigneeId: String!) {
      issueUpdate(id: $issueId, input: { assigneeId: $assigneeId }) {
        success
        issue { id title assignee { name } }
      }
    }
  `, { issueId, assigneeId });

  return {
    success: data.issueUpdate?.success ?? false,
    issue: data.issueUpdate?.issue ? {
      id: data.issueUpdate.issue.id,
      title: data.issueUpdate.issue.title,
      assignee: data.issueUpdate.issue.assignee?.name || '',
    } : undefined,
  };
}
