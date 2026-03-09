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
    description: 'Evaluate any action against guard policies. Use this when the action type is dynamic or unknown at call time.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('evaluate', input)
  },
  'guard.send_email': {
    description: 'Evaluate an outbound email before sending. Blocks emails containing secrets, credentials, or external attachments that match risk patterns.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('send_email', input)
  },
  'guard.code_merge': {
    description: 'Evaluate a code merge or PR before it lands. Flags changes to auth, security, crypto, or permission files and routes them to human review.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('code_merge', input)
  },
  'guard.publish': {
    description: 'Evaluate content before publishing to a public channel. Detects profanity, PII patterns (SSN), and custom blocked words.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('publish', input)
  },
  'guard.support_reply': {
    description: 'Evaluate a customer support reply before sending. Escalates messages containing refund commitments, legal threats, or configurable escalation keywords.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('support_reply', input)
  },
  'guard.agent_action': {
    description: 'Evaluate a generic agent action. Blocks irreversible actions that have not been explicitly approved by a human.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('agent_action', input)
  },
  'guard.deployment': {
    description: 'Evaluate a deployment before it runs. Production deployments are flagged for human review; non-production environments are allowed through.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('deployment', input)
  },
  'guard.permission_escalation': {
    description: 'Evaluate a permission escalation request. Break-glass escalations are always flagged; standard permission changes are assessed against scope.',
    input: EvaluateInputSchema,
    run: (input: unknown) => runGuard('permission_escalation', input)
  },
  'guard.policy.describe': {
    description: 'Describe the active guard policy for one or all guard types. Returns quorum thresholds, risk settings, and configurable guard options.',
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
    description: 'Generate a new consensus board with a set of evaluator personas. Returns the board record and persona stubs.',
    input: z.object({ boardName: z.string().default('default'), personaCount: z.number().int().min(1).max(25).default(5) }),
    run: (input: unknown) => {
      const parsed = z.object({ boardName: z.string().default('default'), personaCount: z.number().int().min(1).max(25).default(5) }).parse(input);
      const board = createBoard(parsed.boardName, { personaCount: parsed.personaCount, generatedBy: 'local-deterministic-scaffold' });
      return { board, personas: Array.from({ length: parsed.personaCount }).map((_, i) => ({ id: `p-${i + 1}`, weight: 1 })) };
    }
  },
  'persona.respawn': {
    description: 'Replace a drifted or failed persona on an existing board. Optionally target a specific persona ID; omitting it replaces the lowest-performing one.',
    input: z.object({ boardId: z.string(), personaId: z.string().optional() }),
    run: (input: unknown) => {
      const parsed = z.object({ boardId: z.string(), personaId: z.string().optional() }).parse(input);
      return { status: 'RESPAWN_SCAFFOLD', board: getBoard(parsed.boardId), replaced: parsed.personaId ?? null };
    }
  },

  'board.list': {
    description: 'List all consensus boards in the local database.',
    input: z.object({}),
    run: () => ({ boards: listBoards() })
  },
  'board.get': {
    description: 'Get the full record for a single consensus board by ID.',
    input: BoardGetSchema,
    run: (input: unknown) => ({ board: getBoard(BoardGetSchema.parse(input).id) })
  },
  'run.get': {
    description: 'Get the full record and event history for a guard run by ID.',
    input: RunGetSchema,
    run: (input: unknown) => ({ run: getRun(RunGetSchema.parse(input).id) })
  },
  'audit.search': {
    description: 'Full-text search across all guard run audit events. Returns up to 500 matching events.',
    input: EventSearchSchema,
    run: (input: unknown) => ({ events: searchEvents(EventSearchSchema.parse(input).query, EventSearchSchema.parse(input).limit) })
  },

  'human.approve': {
    description: 'Submit a human approval decision (YES / NO / REWRITE) for a guard run that is waiting on HITL review.',
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
