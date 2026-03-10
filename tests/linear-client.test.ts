import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking fetch
const { fetchUnassignedSubtasks, fetchTeamMembers, assignIssue } = await import('../server/src/adapters/linear-client.js');

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
