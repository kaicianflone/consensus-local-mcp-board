import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking fetch
const { fetchUnassignedSubtasks, fetchTeamMembers, assignIssue, fetchStaleTasks, fetchOverdueTasks } = await import('../server/src/adapters/linear-client.js');

function mockGraphQLResponse(data: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data }),
    text: async () => JSON.stringify({ data }),
  });
}

function mockGraphQLError(message: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ errors: [{ message }] }),
    text: async () => JSON.stringify({ errors: [{ message }] }),
  });
}

describe('Linear GraphQL Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('fetchUnassignedSubtasks', () => {
    it('returns empty array when apiKey is missing', async () => {
      const result = await fetchUnassignedSubtasks('', 'team-1');
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty array when teamId is missing', async () => {
      const result = await fetchUnassignedSubtasks('lin_api_xxx', '');
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches and parses unassigned subtasks', async () => {
      mockGraphQLResponse({
        issues: {
          nodes: [
            {
              id: 'issue-1',
              title: 'Fix login bug',
              description: 'Users cannot login',
              priority: 1,
              labels: { nodes: [{ name: 'bug' }, { name: 'auth' }] },
              parent: { id: 'parent-1', title: 'Auth overhaul' },
            },
            {
              id: 'issue-2',
              title: 'Add tests',
              description: null,
              priority: 3,
              labels: { nodes: [] },
              parent: { id: 'parent-1', title: 'Auth overhaul' },
            },
          ],
        },
      });

      const result = await fetchUnassignedSubtasks('lin_api_xxx', 'team-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'issue-1',
        title: 'Fix login bug',
        description: 'Users cannot login',
        priority: 1,
        labels: ['bug', 'auth'],
        parent: { id: 'parent-1', title: 'Auth overhaul' },
      });
      expect(result[1].description).toBeNull();
      expect(result[1].labels).toEqual([]);

      // Verify the fetch was called with correct auth header
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.linear.app/graphql');
      expect(opts.headers.Authorization).toBe('lin_api_xxx');
    });

    it('throws on GraphQL errors', async () => {
      mockGraphQLError('Invalid API key');
      await expect(fetchUnassignedSubtasks('bad-key', 'team-1')).rejects.toThrow('Linear GraphQL error: Invalid API key');
    });
  });

  describe('fetchTeamMembers', () => {
    it('returns empty array when apiKey is missing', async () => {
      const result = await fetchTeamMembers('', 'team-1');
      expect(result).toEqual([]);
    });

    it('fetches team members and their recent tasks', async () => {
      // First call: team members
      mockGraphQLResponse({
        team: {
          members: {
            nodes: [
              { id: 'user-1', name: 'Alice', displayName: 'Alice A', email: 'alice@co.com', active: true },
              { id: 'user-2', name: 'Bob', displayName: 'Bob B', email: 'bob@co.com', active: true },
            ],
          },
        },
      });

      // Second call: batched recent tasks
      mockGraphQLResponse({
        m0: {
          nodes: [
            { id: 't1', title: 'Task A', state: { name: 'Done' }, priority: 1, labels: { nodes: [{ name: 'frontend' }] } },
          ],
        },
        m1: {
          nodes: [
            { id: 't2', title: 'Task B', state: { name: 'In Progress' }, priority: 2, labels: { nodes: [] } },
          ],
        },
      });

      const result = await fetchTeamMembers('lin_api_xxx', 'team-1');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Alice');
      expect(result[0].recentTasks).toHaveLength(1);
      expect(result[0].recentTasks[0].title).toBe('Task A');
      expect(result[0].recentTasks[0].labels).toEqual(['frontend']);
      expect(result[1].name).toBe('Bob');
      expect(result[1].recentTasks[0].state).toBe('In Progress');
    });

    it('filters members by memberIds when provided', async () => {
      mockGraphQLResponse({
        team: {
          members: {
            nodes: [
              { id: 'user-1', name: 'Alice', displayName: 'Alice', email: '', active: true },
              { id: 'user-2', name: 'Bob', displayName: 'Bob', email: '', active: true },
              { id: 'user-3', name: 'Charlie', displayName: 'Charlie', email: '', active: true },
            ],
          },
        },
      });

      // Only user-1 and user-3 pass the filter → batched query for 2 members
      mockGraphQLResponse({
        m0: { nodes: [] },
        m1: { nodes: [] },
      });

      const result = await fetchTeamMembers('lin_api_xxx', 'team-1', ['user-1', 'user-3']);

      expect(result).toHaveLength(2);
      expect(result.map(m => m.name)).toEqual(['Alice', 'Charlie']);
    });
  });

  describe('fetchStaleTasks', () => {
    it('returns empty array when apiKey is missing', async () => {
      const result = await fetchStaleTasks('', 'team-1', 7);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty array when staleDays < 1', async () => {
      const result = await fetchStaleTasks('lin_api_xxx', 'team-1', 0);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches and parses stale tasks with updatedAt filter', async () => {
      mockGraphQLResponse({
        issues: {
          nodes: [
            {
              id: 'issue-1',
              title: 'Old task',
              priority: 2,
              state: { name: 'In Progress', type: 'started' },
              updatedAt: '2026-02-01T00:00:00Z',
              assignee: { id: 'user-1', name: 'Alice' },
              labels: { nodes: [{ name: 'backend' }] },
            },
            {
              id: 'issue-2',
              title: 'Forgotten task',
              priority: 0,
              state: { name: 'Backlog', type: 'backlog' },
              updatedAt: '2026-01-15T00:00:00Z',
              assignee: null,
              labels: { nodes: [] },
            },
          ],
        },
      });

      const result = await fetchStaleTasks('lin_api_xxx', 'team-1', 7);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'issue-1',
        title: 'Old task',
        priority: 2,
        state: { name: 'In Progress', type: 'started' },
        updatedAt: '2026-02-01T00:00:00Z',
        assignee: { id: 'user-1', name: 'Alice' },
        labels: ['backend'],
      });
      expect(result[1].assignee).toBeNull();
      expect(result[1].labels).toEqual([]);

      // Verify the filter includes updatedAt and state type exclusion
      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.variables.filter.updatedAt.lt).toBeDefined();
      expect(body.variables.filter.state.type.nin).toEqual(['completed', 'canceled']);
    });

    it('includes project filter when projectId is provided', async () => {
      mockGraphQLResponse({ issues: { nodes: [] } });

      await fetchStaleTasks('lin_api_xxx', 'team-1', 7, 'proj-1');

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.variables.filter.project.id.eq).toBe('proj-1');
    });
  });

  describe('fetchOverdueTasks', () => {
    it('returns empty array when apiKey is missing', async () => {
      const result = await fetchOverdueTasks('', 'team-1');
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches overdue tasks with dueDate filter', async () => {
      mockGraphQLResponse({
        issues: {
          nodes: [
            {
              id: 'issue-1',
              title: 'Overdue feature',
              dueDate: '2026-02-01',
              priority: 1,
              state: { name: 'In Progress' },
              assignee: { id: 'user-1', name: 'Alice' },
              labels: { nodes: [{ name: 'urgent' }] },
            },
          ],
        },
      });

      const result = await fetchOverdueTasks('lin_api_xxx', 'team-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'issue-1',
        title: 'Overdue feature',
        dueDate: '2026-02-01',
        priority: 1,
        state: { name: 'In Progress' },
        assignee: { id: 'user-1', name: 'Alice' },
        labels: ['urgent'],
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.variables.filter.dueDate.lt).toBeDefined();
      expect(body.variables.filter.state.type.nin).toEqual(['completed', 'canceled']);
    });

    it('includes priority filter when provided', async () => {
      mockGraphQLResponse({ issues: { nodes: [] } });

      await fetchOverdueTasks('lin_api_xxx', 'team-1', undefined, 2);

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.variables.filter.priority.lte).toBe(2);
    });

    it('omits priority filter when 0', async () => {
      mockGraphQLResponse({ issues: { nodes: [] } });

      await fetchOverdueTasks('lin_api_xxx', 'team-1', undefined, 0);

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.variables.filter.priority).toBeUndefined();
    });
  });

  describe('assignIssue', () => {
    it('returns success false when params are missing', async () => {
      expect(await assignIssue('', 'issue-1', 'user-1')).toEqual({ success: false });
      expect(await assignIssue('key', '', 'user-1')).toEqual({ success: false });
      expect(await assignIssue('key', 'issue-1', '')).toEqual({ success: false });
    });

    it('sends mutation and returns result', async () => {
      mockGraphQLResponse({
        issueUpdate: {
          success: true,
          issue: { id: 'issue-1', title: 'Fix bug', assignee: { name: 'Alice' } },
        },
      });

      const result = await assignIssue('lin_api_xxx', 'issue-1', 'user-1');

      expect(result.success).toBe(true);
      expect(result.issue).toEqual({
        id: 'issue-1',
        title: 'Fix bug',
        assignee: 'Alice',
      });
    });
  });
});
