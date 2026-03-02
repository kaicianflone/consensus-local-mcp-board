import { z } from 'zod';
export declare const DecisionSchema: z.ZodEnum<["ALLOW", "BLOCK", "REWRITE", "REQUIRE_HUMAN"]>;
export declare const GuardResultSchema: z.ZodObject<{
    decision: z.ZodEnum<["ALLOW", "BLOCK", "REWRITE", "REQUIRE_HUMAN"]>;
    reason: z.ZodString;
    risk_score: z.ZodNumber;
    suggested_rewrite: z.ZodOptional<z.ZodAny>;
    audit_id: z.ZodString;
    next_step: z.ZodOptional<z.ZodObject<{
        tool: z.ZodString;
        input: z.ZodAny;
    }, "strip", z.ZodTypeAny, {
        tool: string;
        input?: any;
    }, {
        tool: string;
        input?: any;
    }>>;
}, "strip", z.ZodTypeAny, {
    reason: string;
    decision: "ALLOW" | "BLOCK" | "REWRITE" | "REQUIRE_HUMAN";
    risk_score: number;
    audit_id: string;
    suggested_rewrite?: any;
    next_step?: {
        tool: string;
        input?: any;
    } | undefined;
}, {
    reason: string;
    decision: "ALLOW" | "BLOCK" | "REWRITE" | "REQUIRE_HUMAN";
    risk_score: number;
    audit_id: string;
    suggested_rewrite?: any;
    next_step?: {
        tool: string;
        input?: any;
    } | undefined;
}>;
export declare const EvaluateInputSchema: z.ZodObject<{
    boardId: z.ZodString;
    runId: z.ZodOptional<z.ZodString>;
    action: z.ZodObject<{
        type: z.ZodString;
        payload: z.ZodRecord<z.ZodString, z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        payload: Record<string, any>;
    }, {
        type: string;
        payload: Record<string, any>;
    }>;
    policyPack: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: {
        type: string;
        payload: Record<string, any>;
    };
    boardId: string;
    runId?: string | undefined;
    policyPack?: string | undefined;
}, {
    action: {
        type: string;
        payload: Record<string, any>;
    };
    boardId: string;
    runId?: string | undefined;
    policyPack?: string | undefined;
}>;
export type GuardResult = z.infer<typeof GuardResultSchema>;
export type EvaluateInput = z.infer<typeof EvaluateInputSchema>;
