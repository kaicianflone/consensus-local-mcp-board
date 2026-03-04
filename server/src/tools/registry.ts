import { z } from 'zod';
import { EvaluateInputSchema } from '@local-mcp-board/shared';
import { createBoard, getBoard, getRun, listBoards, searchEvents } from '../db/store.js';
import { executeGuardEvaluate, normalizeGuardType } from '../workflows/guard-evaluate.js';
import { humanApprovePost } from '../api/human.approve.post.js';

const BoardGetSchema = z.object({ id: z.string() });
const RunGetSchema = z.object({ id: z.string() });
const EventSearchSchema = z.object({ query: z.string().default(''), limit: z.number().int().min(1).max(500).default(100) });

async function runGuard(type: string, input: unknown) {
  const parsed = EvaluateInputSchema.parse(input);
  return executeGuardEvaluate({
    runId: parsed.runId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    boardId: parsed.boardId,
    guardType: normalizeGuardType(type === 'evaluate' ? parsed.action.type : type),
    payload: parsed.action.payload,
    policy: {
      policyId: parsed.policyPack ?? 'default',
      version: 'v1',
      quorum: 0.7,
      riskThreshold: 0.7,
      hitlRequiredAboveRisk: 0.7,
      options: {}
    },
    idempotencyKey: `${parsed.boardId}:${type}:${JSON.stringify(parsed.action.payload)}`
  });
}

export const toolRegistry = {
  'guard.evaluate': {
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('evaluate', input)
  },
  'guard.send_email': { input: EvaluateInputSchema, run: (input: unknown) => runGuard('send_email', input) },
  'guard.code_merge': { input: EvaluateInputSchema, run: (input: unknown) => runGuard('code_merge', input) },
  'guard.publish': { input: EvaluateInputSchema, run: (input: unknown) => runGuard('publish', input) },
  'guard.support_reply': { input: EvaluateInputSchema, run: (input: unknown) => runGuard('support_reply', input) },
  'guard.agent_action': { input: EvaluateInputSchema, run: (input: unknown) => runGuard('agent_action', input) },
  'guard.deployment': { input: EvaluateInputSchema, run: (input: unknown) => runGuard('deployment', input) },
  'guard.permission_escalation': { input: EvaluateInputSchema, run: (input: unknown) => runGuard('permission_escalation', input) },
  'guard.policy.describe': {
    input: z.object({ guardType: z.string().optional() }),
    run: (input: unknown) => {
      const guardType = z.object({ guardType: z.string().optional() }).parse(input).guardType;
      const matrix: Record<string, any> = {
        send_email: { quorum: 0.7, hitlRequiredAboveRisk: 0.75, options: { tone: ['neutral', 'formal'], externalRecipients: ['allow', 'require_hitl'] } },
        code_merge: { quorum: 0.7, hitlRequiredAboveRisk: 0.7, options: { strictness: ['balanced', 'strict'], requireCi: [true, false] } },
        publish: { quorum: 0.7, hitlRequiredAboveRisk: 0.7, options: { channel: ['blog', 'social'], legalReview: [true, false] } },
        support_reply: { quorum: 0.7, hitlRequiredAboveRisk: 0.7, options: { customerTier: ['free', 'pro', 'enterprise'] } },
        agent_action: { quorum: 0.7, hitlRequiredAboveRisk: 0.7, options: { irreversible: [true, false] } },
        deployment: { quorum: 0.7, hitlRequiredAboveRisk: 0.8, options: { env: ['dev', 'staging', 'prod'], rollout: ['canary', 'all-at-once'] } },
        permission_escalation: { quorum: 0.75, hitlRequiredAboveRisk: 0.75, options: { environment: ['dev', 'staging', 'prod'], breakGlass: [true, false] } }
      };
      return guardType ? { guardType, policy: matrix[guardType] ?? null } : { guards: matrix };
    }
  },

  'persona.generate': {
    input: z.object({ boardName: z.string().default('default'), personaCount: z.number().int().min(1).max(25).default(5) }),
    run: (input: unknown) => {
      const parsed = z.object({ boardName: z.string().default('default'), personaCount: z.number().int().min(1).max(25).default(5) }).parse(input);
      const board = createBoard(parsed.boardName, { personaCount: parsed.personaCount, generatedBy: 'local-deterministic-scaffold' });
      return { board, personas: Array.from({ length: parsed.personaCount }).map((_, i) => ({ id: `p-${i + 1}`, weight: 1 })) };
    }
  },
  'persona.respawn': {
    input: z.object({ boardId: z.string(), personaId: z.string().optional() }),
    run: (input: unknown) => {
      const parsed = z.object({ boardId: z.string(), personaId: z.string().optional() }).parse(input);
      return { status: 'RESPAWN_SCAFFOLD', board: getBoard(parsed.boardId), replaced: parsed.personaId ?? null };
    }
  },

  'board.list': { input: z.object({}), run: () => ({ boards: listBoards() }) },
  'board.get': { input: BoardGetSchema, run: (input: unknown) => ({ board: getBoard(BoardGetSchema.parse(input).id) }) },
  'run.get': { input: RunGetSchema, run: (input: unknown) => ({ run: getRun(RunGetSchema.parse(input).id) }) },
  'audit.search': { input: EventSearchSchema, run: (input: unknown) => ({ events: searchEvents(EventSearchSchema.parse(input).query, EventSearchSchema.parse(input).limit) }) },

  'human.approve': {
    input: z.object({ runId: z.string(), approver: z.string().default('human'), replyText: z.string(), idempotencyKey: z.string(), boardId: z.string().optional() }),
    run: (input: unknown) => humanApprovePost(input)
  }
} as const;

export type ToolName = keyof typeof toolRegistry;

export async function invokeTool(name: ToolName, input: unknown) {
  const tool = toolRegistry[name];
  const parsed = tool.input.parse(input);
  return await tool.run(parsed);
}

export function listToolNames(): ToolName[] {
  return Object.keys(toolRegistry) as ToolName[];
}
