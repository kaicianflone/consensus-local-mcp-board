import { z } from 'zod';
export declare const DecisionSchema: z.ZodEnum<["ALLOW", "BLOCK", "REWRITE", "REQUIRE_HUMAN"]>;
export declare const GuardTypeSchema: z.ZodEnum<["send_email", "code_merge", "publish", "support_reply", "agent_action", "deployment", "permission_escalation"]>;
export declare const PolicyMetadataSchema: z.ZodObject<{
    policyId: z.ZodDefault<z.ZodString>;
    version: z.ZodDefault<z.ZodString>;
    quorum: z.ZodDefault<z.ZodNumber>;
    riskThreshold: z.ZodDefault<z.ZodNumber>;
    hitlRequiredAboveRisk: z.ZodDefault<z.ZodNumber>;
    options: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    policyId: string;
    version: string;
    quorum: number;
    riskThreshold: number;
    hitlRequiredAboveRisk: number;
    options: Record<string, any>;
}, {
    policyId?: string | undefined;
    version?: string | undefined;
    quorum?: number | undefined;
    riskThreshold?: number | undefined;
    hitlRequiredAboveRisk?: number | undefined;
    options?: Record<string, any> | undefined;
}>;
export declare const GuardVoteSchema: z.ZodObject<{
    evaluator: z.ZodString;
    vote: z.ZodEnum<["YES", "NO", "REWRITE"]>;
    reason: z.ZodString;
    risk: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    evaluator: string;
    vote: "REWRITE" | "YES" | "NO";
    reason: string;
    risk: number;
}, {
    evaluator: string;
    vote: "REWRITE" | "YES" | "NO";
    reason: string;
    risk: number;
}>;
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
    weighted_yes: z.ZodOptional<z.ZodNumber>;
    votes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        evaluator: z.ZodString;
        vote: z.ZodEnum<["YES", "NO", "REWRITE"]>;
        reason: z.ZodString;
        risk: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        evaluator: string;
        vote: "REWRITE" | "YES" | "NO";
        reason: string;
        risk: number;
    }, {
        evaluator: string;
        vote: "REWRITE" | "YES" | "NO";
        reason: string;
        risk: number;
    }>, "many">>;
    guard_type: z.ZodOptional<z.ZodEnum<["send_email", "code_merge", "publish", "support_reply", "agent_action", "deployment", "permission_escalation"]>>;
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
    weighted_yes?: number | undefined;
    votes?: {
        evaluator: string;
        vote: "REWRITE" | "YES" | "NO";
        reason: string;
        risk: number;
    }[] | undefined;
    guard_type?: "send_email" | "code_merge" | "publish" | "support_reply" | "agent_action" | "deployment" | "permission_escalation" | undefined;
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
    weighted_yes?: number | undefined;
    votes?: {
        evaluator: string;
        vote: "REWRITE" | "YES" | "NO";
        reason: string;
        risk: number;
    }[] | undefined;
    guard_type?: "send_email" | "code_merge" | "publish" | "support_reply" | "agent_action" | "deployment" | "permission_escalation" | undefined;
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
    boardId: string;
    action: {
        type: string;
        payload: Record<string, any>;
    };
    runId?: string | undefined;
    policyPack?: string | undefined;
}, {
    boardId: string;
    action: {
        type: string;
        payload: Record<string, any>;
    };
    runId?: string | undefined;
    policyPack?: string | undefined;
}>;
export declare const GuardEvaluateRequestSchema: z.ZodObject<{
    runId: z.ZodString;
    boardId: z.ZodString;
    guardType: z.ZodEnum<["send_email", "code_merge", "publish", "support_reply", "agent_action", "deployment", "permission_escalation"]>;
    payload: z.ZodRecord<z.ZodString, z.ZodAny>;
    policy: z.ZodDefault<z.ZodObject<{
        policyId: z.ZodDefault<z.ZodString>;
        version: z.ZodDefault<z.ZodString>;
        quorum: z.ZodDefault<z.ZodNumber>;
        riskThreshold: z.ZodDefault<z.ZodNumber>;
        hitlRequiredAboveRisk: z.ZodDefault<z.ZodNumber>;
        options: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "strip", z.ZodTypeAny, {
        policyId: string;
        version: string;
        quorum: number;
        riskThreshold: number;
        hitlRequiredAboveRisk: number;
        options: Record<string, any>;
    }, {
        policyId?: string | undefined;
        version?: string | undefined;
        quorum?: number | undefined;
        riskThreshold?: number | undefined;
        hitlRequiredAboveRisk?: number | undefined;
        options?: Record<string, any> | undefined;
    }>>;
    idempotencyKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    boardId: string;
    runId: string;
    payload: Record<string, any>;
    guardType: "send_email" | "code_merge" | "publish" | "support_reply" | "agent_action" | "deployment" | "permission_escalation";
    policy: {
        policyId: string;
        version: string;
        quorum: number;
        riskThreshold: number;
        hitlRequiredAboveRisk: number;
        options: Record<string, any>;
    };
    idempotencyKey: string;
}, {
    boardId: string;
    runId: string;
    payload: Record<string, any>;
    guardType: "send_email" | "code_merge" | "publish" | "support_reply" | "agent_action" | "deployment" | "permission_escalation";
    idempotencyKey: string;
    policy?: {
        policyId?: string | undefined;
        version?: string | undefined;
        quorum?: number | undefined;
        riskThreshold?: number | undefined;
        hitlRequiredAboveRisk?: number | undefined;
        options?: Record<string, any> | undefined;
    } | undefined;
}>;
export declare const HumanDecisionSchema: z.ZodObject<{
    decision: z.ZodEnum<["YES", "NO"]>;
    approver: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
    idempotencyKey: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    decision: "YES" | "NO";
    idempotencyKey: string;
    approver: string;
    createdAt: string;
    reason?: string | undefined;
}, {
    decision: "YES" | "NO";
    idempotencyKey: string;
    approver: string;
    createdAt: string;
    reason?: string | undefined;
}>;
export declare const HumanApprovalRequestSchema: z.ZodObject<{
    runId: z.ZodString;
    approver: z.ZodDefault<z.ZodString>;
    replyText: z.ZodString;
    idempotencyKey: z.ZodString;
    boardId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    runId: string;
    idempotencyKey: string;
    approver: string;
    replyText: string;
    boardId?: string | undefined;
}, {
    runId: string;
    idempotencyKey: string;
    replyText: string;
    boardId?: string | undefined;
    approver?: string | undefined;
}>;
export type GuardResult = z.infer<typeof GuardResultSchema>;
export type EvaluateInput = z.infer<typeof EvaluateInputSchema>;
export type GuardEvaluateRequest = z.infer<typeof GuardEvaluateRequestSchema>;
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;
export declare function parseHumanApprovalYesNo(text: string): 'YES' | 'NO' | 'REWRITE';
