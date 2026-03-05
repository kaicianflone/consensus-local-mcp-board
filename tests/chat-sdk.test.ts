import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  process.env.CHAT_PROVIDER = 'stdout';
});

vi.mock('../server/src/db/store.js', () => ({
  db: {},
  appendEvent: vi.fn(),
  getRun: vi.fn(),
  updateRunStatus: vi.fn(),
  listEvents: vi.fn(() => []),
}));

vi.mock('../server/src/db/credentials.js', () => ({
  getCredential: vi.fn(() => null),
}));

import {
  formatMention,
  sendHumanApprovalPrompt,
  sendTimeoutWarning,
  sendDeadlineExpired,
} from '../server/src/adapters/chat-sdk.js';
import type { ChatPrompt, ChatTarget } from '../server/src/adapters/chat-sdk.js';

describe('Chat SDK', () => {
  // ── formatMention ──

  describe('formatMention', () => {
    it('should format Slack user ID mention', () => {
      expect(formatMention('slack', 'U12345')).toBe('<@U12345>');
    });

    it('should format Slack username mention', () => {
      expect(formatMention('slack', 'johndoe')).toBe('@johndoe');
    });

    it('should format Teams mention', () => {
      expect(formatMention('teams', 'john.doe')).toBe('<at>john.doe</at>');
    });

    it('should format Discord numeric ID mention', () => {
      expect(formatMention('discord', '123456789')).toBe('<@123456789>');
    });

    it('should format Discord username mention', () => {
      expect(formatMention('discord', 'johndoe')).toBe('@johndoe');
    });

    it('should keep Telegram handle that already has @', () => {
      expect(formatMention('telegram', '@johndoe')).toBe('@johndoe');
    });

    it('should add @ for Telegram handle without it', () => {
      expect(formatMention('telegram', 'johndoe')).toBe('@johndoe');
    });

    it('should format Google Chat mention', () => {
      expect(formatMention('gchat', '12345')).toBe('<users/12345>');
    });

    it('should default to @handle for unknown adapter', () => {
      expect(formatMention('unknown', 'johndoe')).toBe('@johndoe');
    });
  });

  // ── sendHumanApprovalPrompt (stdout mode) ──

  describe('sendHumanApprovalPrompt', () => {
    const basePrompt: ChatPrompt = {
      boardId: 'board-1',
      runId: 'run-1',
      quorum: 0.7,
      risk: 0.85,
      threshold: 0.7,
    };

    it('should deliver via stdout provider', async () => {
      const result = await sendHumanApprovalPrompt(basePrompt);
      expect(result.delivered).toBe(true);
      expect(result.provider).toBe('stdout');
      expect(result.message).toContain('run-1');
      expect(result.message).toContain('85%');
      expect(result.promptMode).toBe('yes-no');
    });

    it('should include @mentions for chat targets', async () => {
      const targets: ChatTarget[] = [
        { subjectId: 'alice', adapter: 'slack', handle: 'U123' },
        { subjectId: 'bob', adapter: 'teams', handle: 'bob.smith' },
      ];
      const result = await sendHumanApprovalPrompt({ ...basePrompt, chatTargets: targets });
      expect(result.delivered).toBe(true);
      expect(result.message).toContain('<@U123>');
      expect(result.message).toContain('<at>bob.smith</at>');
      expect(result.results).toHaveLength(2);
    });

    it('should show deadline when timeoutSec is set', async () => {
      const result = await sendHumanApprovalPrompt({ ...basePrompt, timeoutSec: 600 });
      expect(result.message).toContain('10 minutes');
    });

    it('should show vote instructions for vote mode', async () => {
      const result = await sendHumanApprovalPrompt({
        ...basePrompt,
        promptMode: 'vote',
        requiredVotes: 3,
      });
      expect(result.message).toContain('YES, NO, or REWRITE');
      expect(result.message).toContain('3 vote(s) required');
      expect(result.promptMode).toBe('vote');
    });

    it('should show approve-reject-revise instructions', async () => {
      const result = await sendHumanApprovalPrompt({
        ...basePrompt,
        promptMode: 'approve-reject-revise',
      });
      expect(result.message).toContain('APPROVE, REJECT, or REVISE');
    });

    it('should show acknowledge instructions', async () => {
      const result = await sendHumanApprovalPrompt({
        ...basePrompt,
        promptMode: 'acknowledge',
      });
      expect(result.message).toContain('ACK');
    });

    it('should default to yes-no mode', async () => {
      const result = await sendHumanApprovalPrompt(basePrompt);
      expect(result.message).toContain('YES or NO');
    });

    it('should include risk and quorum percentages', async () => {
      const result = await sendHumanApprovalPrompt(basePrompt);
      expect(result.message).toContain('85%');
      expect(result.message).toContain('70%');
    });
  });

  // ── sendTimeoutWarning ──

  describe('sendTimeoutWarning', () => {
    it('should deliver warning via stdout', async () => {
      const prompt: ChatPrompt = {
        boardId: 'board-1',
        runId: 'run-warn',
        quorum: 0.7,
        risk: 0.5,
        threshold: 0.7,
        chatTargets: [{ subjectId: 'alice', adapter: 'slack', handle: 'U123' }],
      };
      const result = await sendTimeoutWarning(prompt, 120);
      expect(result.delivered).toBe(true);
      expect(result.provider).toBe('stdout');
      expect(result.message).toContain('run-warn');
      expect(result.message).toContain('still pending');
      expect(result.message).toContain('2 minute');
    });

    it('should include target mentions in warning', async () => {
      const prompt: ChatPrompt = {
        boardId: 'board-1',
        runId: 'run-warn-2',
        quorum: 0.7,
        risk: 0.5,
        threshold: 0.7,
        chatTargets: [
          { subjectId: 'alice', adapter: 'discord', handle: '99999' },
        ],
      };
      const result = await sendTimeoutWarning(prompt, 60);
      expect(result.message).toContain('<@99999>');
    });
  });

  // ── sendDeadlineExpired ──

  describe('sendDeadlineExpired', () => {
    it('should deliver deadline expired message via stdout', async () => {
      const prompt: ChatPrompt = {
        boardId: 'board-1',
        runId: 'run-exp',
        quorum: 0.7,
        risk: 0.5,
        threshold: 0.7,
      };
      const result = await sendDeadlineExpired(prompt, 'BLOCK');
      expect(result.delivered).toBe(true);
      expect(result.provider).toBe('stdout');
      expect(result.message).toContain('run-exp');
      expect(result.message).toContain('BLOCK');
      expect(result.message).toContain('Deadline expired');
    });

    it('should reflect the auto-decision in message', async () => {
      const prompt: ChatPrompt = {
        boardId: 'board-1',
        runId: 'run-exp-2',
        quorum: 0.7,
        risk: 0.5,
        threshold: 0.7,
      };
      const result = await sendDeadlineExpired(prompt, 'ALLOW');
      expect(result.message).toContain('ALLOW');
    });
  });
});
