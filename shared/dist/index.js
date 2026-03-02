import { z } from 'zod';
export const DecisionSchema = z.enum(['ALLOW', 'BLOCK', 'REWRITE', 'REQUIRE_HUMAN']);
export const GuardResultSchema = z.object({
    decision: DecisionSchema,
    reason: z.string(),
    risk_score: z.number().min(0).max(1),
    suggested_rewrite: z.any().optional(),
    audit_id: z.string(),
    next_step: z.object({ tool: z.string(), input: z.any() }).optional()
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
