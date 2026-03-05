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
  const runId = parsed.runId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const guardType = normalizeGuardType(type === 'evaluate' ? parsed.action.type : type);

  return executeGuardEvaluate({
    runId,
    boardId: parsed.boardId,
    guardType,
    payload: (parsed.action.payload || {}) as Record<string, unknown>,
    policy: {
      policyId: parsed.policyPack ?? guardType,
      version: 'v1',
      quorum: 0.7,
      riskThreshold: 0.7,
      hitlRequiredAboveRisk: 0.7,
      options: {}
    },
    idempotencyKey: `${parsed.boardId}:${guardType}:${JSON.stringify(parsed.action.payload || {})}`
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
        send_email: {
          quorum: 0.7, hitlRequiredAboveRisk: 0.75,
          options: { tone: ['neutral', 'formal'], externalRecipients: ['allow', 'require_hitl'] },
          guardSettings: {
            recipientAllowlist: { type: 'string', description: 'Comma-separated allowed email domains', default: '' },
            recipientBlocklist: { type: 'string', description: 'Comma-separated blocked email domains', default: '' },
            attachmentPolicy: { type: 'enum', values: ['allow', 'warn', 'block'], default: 'warn', description: 'How to handle email attachments' },
            secretsScanning: { type: 'boolean', default: true, description: 'Scan body for API keys, tokens, secrets' },
          }
        },
        code_merge: {
          quorum: 0.7, hitlRequiredAboveRisk: 0.7,
          options: { strictness: ['balanced', 'strict'], requireCi: [true, false] },
          guardSettings: {
            sensitiveFilePatterns: { type: 'string', description: 'Comma-separated file path patterns triggering elevated risk', default: 'auth,security,permission,crypto' },
            requiredReviewers: { type: 'number', min: 0, max: 10, default: 1, description: 'Minimum human code reviewers' },
            protectedBranches: { type: 'string', description: 'Comma-separated branch patterns requiring stricter review', default: 'main' },
            ciRequired: { type: 'boolean', default: true, description: 'Require CI checks to pass' },
          }
        },
        publish: {
          quorum: 0.7, hitlRequiredAboveRisk: 0.7,
          options: { channel: ['blog', 'social'], legalReview: [true, false] },
          guardSettings: {
            profanityFilter: { type: 'boolean', default: true, description: 'Scan for profanity' },
            piiDetection: { type: 'boolean', default: true, description: 'Detect PII patterns (SSN, etc.)' },
            blockedWords: { type: 'string', description: 'Comma-separated custom blocked words', default: '' },
          }
        },
        support_reply: {
          quorum: 0.7, hitlRequiredAboveRisk: 0.7,
          options: { customerTier: ['free', 'pro', 'enterprise'] },
          guardSettings: {
            escalationKeywords: { type: 'string', description: 'Comma-separated keywords triggering escalation', default: 'refund,lawsuit,legal action' },
            autoEscalate: { type: 'boolean', default: true, description: 'Auto-escalate to human on keyword match' },
            customerTier: { type: 'enum', values: ['all', 'free', 'pro', 'enterprise'], default: 'all', description: 'Customer tier for risk weighting' },
          }
        },
        agent_action: {
          quorum: 0.7, hitlRequiredAboveRisk: 0.7,
          options: { irreversible: [true, false] },
          guardSettings: {
            irreversibleDefault: { type: 'boolean', default: false, description: 'Treat actions as irreversible by default' },
            toolAllowlist: { type: 'string', description: 'Comma-separated MCP tool names allowed without review', default: '' },
            toolBlocklist: { type: 'string', description: 'Comma-separated MCP tool names always requiring review', default: '' },
          }
        },
        deployment: {
          quorum: 0.7, hitlRequiredAboveRisk: 0.8,
          options: { env: ['dev', 'staging', 'prod'], rollout: ['canary', 'all-at-once'] },
          guardSettings: {
            deployEnv: { type: 'enum', values: ['dev', 'staging', 'prod'], default: 'prod', description: 'Target deployment environment' },
            rolloutStrategy: { type: 'enum', values: ['canary', 'blue-green', 'rolling', 'all-at-once'], default: 'all-at-once', description: 'Rollout strategy' },
            requireProdApproval: { type: 'boolean', default: true, description: 'Require human approval for prod deploys' },
            rollbackEnabled: { type: 'boolean', default: true, description: 'Enable automatic rollback on failure' },
          }
        },
        permission_escalation: {
          quorum: 0.75, hitlRequiredAboveRisk: 0.75,
          options: { environment: ['dev', 'staging', 'prod'], breakGlass: [true, false] },
          guardSettings: {
            breakGlassDefault: { type: 'boolean', default: false, description: 'Treat escalations as break-glass by default' },
            maxEscalationLevel: { type: 'number', min: 1, max: 5, default: 3, description: 'Maximum escalation levels' },
            requireMfa: { type: 'boolean', default: false, description: 'Require MFA for approval' },
            permEnv: { type: 'enum', values: ['dev', 'staging', 'prod'], default: 'prod', description: 'Target environment' },
          }
        }
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
