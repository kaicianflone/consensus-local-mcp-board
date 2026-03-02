import { z } from 'zod';

export const DecisionSchema = z.enum(['ALLOW', 'BLOCK', 'REWRITE', 'REQUIRE_HUMAN']);
export const GuardTypeSchema = z.enum([
  'send_email',
  'code_merge',
  'publish',
  'support_reply',
  'agent_action',
  'deployment',
  'permission_escalation'
]);

export const PolicyMetadataSchema = z.object({
  policyId: z.string().default('default'),
  version: z.string().default('v1'),
  quorum: z.number().min(0).max(1).default(0.7),
  riskThreshold: z.number().min(0).max(1).default(0.7),
  hitlRequiredAboveRisk: z.number().min(0).max(1).default(0.7),
  options: z.record(z.any()).default({})
});

export const GuardVoteSchema = z.object({
  evaluator: z.string(),
  vote: z.enum(['YES', 'NO', 'REWRITE']),
  reason: z.string(),
  risk: z.number().min(0).max(1)
});

export const GuardResultSchema = z.object({
  decision: DecisionSchema,
  reason: z.string(),
  risk_score: z.number().min(0).max(1),
  suggested_rewrite: z.any().optional(),
  audit_id: z.string(),
  next_step: z.object({ tool: z.string(), input: z.any() }).optional(),
  weighted_yes: z.number().min(0).max(1).optional(),
  votes: z.array(GuardVoteSchema).optional(),
  guard_type: GuardTypeSchema.optional()
});

export const EvaluateInputSchema = z.object({
  boardId: z.string().min(1),
  runId: z.string().optional(),
  action: z.object({
    type: z.string().min(1),
    payload: z.record(z.any())
  }),
  policyPack: z.string().optional()
});

export const GuardEvaluateRequestSchema = z.object({
  runId: z.string(),
  boardId: z.string(),
  guardType: GuardTypeSchema,
  payload: z.record(z.any()),
  policy: PolicyMetadataSchema.default({}),
  idempotencyKey: z.string()
});

export const HumanDecisionSchema = z.object({
  decision: z.enum(['YES', 'NO']),
  approver: z.string(),
  reason: z.string().optional(),
  idempotencyKey: z.string(),
  createdAt: z.string()
});

export const HumanApprovalRequestSchema = z.object({
  runId: z.string(),
  approver: z.string().default('human'),
  replyText: z.string(),
  idempotencyKey: z.string(),
  boardId: z.string().optional()
});

export type GuardResult = z.infer<typeof GuardResultSchema>;
export type EvaluateInput = z.infer<typeof EvaluateInputSchema>;
export type GuardEvaluateRequest = z.infer<typeof GuardEvaluateRequestSchema>;
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;

export function parseHitlYesNo(text: string): 'YES' | 'NO' {
  const t = text.trim().toLowerCase();
  if (['yes', 'y', 'approve'].includes(t)) return 'YES';
  if (['no', 'n', 'block', 'deny'].includes(t)) return 'NO';
  throw new Error('Unrecognized HITL reply; expected YES or NO');
}
