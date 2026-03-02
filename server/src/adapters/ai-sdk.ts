import { z } from 'zod';
import type { GuardEvaluateRequest } from '@local-mcp-board/shared';

export type AiVote = {
  evaluator: string;
  vote: 'YES' | 'NO' | 'REWRITE';
  reason: string;
  risk: number;
};

const VoteSchema = z.object({
  evaluator: z.string().default('ai-risk'),
  vote: z.enum(['YES', 'NO', 'REWRITE']),
  reason: z.string().min(1),
  risk: z.number().min(0).max(1)
});

function deterministicFallback(input: GuardEvaluateRequest): AiVote[] {
  const text = JSON.stringify(input.payload ?? {}).toLowerCase();
  if (/(secret|api[_-]?key|token|password|ssn)/i.test(text)) {
    return [{ evaluator: 'fallback-risk', vote: 'NO', reason: 'Sensitive data markers found', risk: 0.92 }];
  }
  if (/(prod|permission|security|auth|crypto|rollback)/i.test(text)) {
    return [{ evaluator: 'fallback-risk', vote: 'REWRITE', reason: 'High-impact domain requires tighter safeguards', risk: 0.78 }];
  }
  return [{ evaluator: 'fallback-risk', vote: 'YES', reason: 'No high-risk signals detected', risk: 0.21 }];
}

export async function evaluateWithAiSdk(input: GuardEvaluateRequest): Promise<AiVote[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.AI_MODEL ?? 'gpt-4o-mini';
  if (!apiKey) return deterministicFallback(input);

  try {
    const prompt = [
      'You are a strict consensus guard evaluator.',
      `Guard type: ${input.guardType}`,
      `Policy: ${JSON.stringify(input.policy)}`,
      `Payload: ${JSON.stringify(input.payload)}`,
      'Return ONLY JSON with fields: evaluator, vote(YES|NO|REWRITE), reason, risk(0..1).'
    ].join('\n');

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Output strict JSON only.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!r.ok) return deterministicFallback(input);
    const data = await r.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') return deterministicFallback(input);

    const parsed = VoteSchema.parse(JSON.parse(content));
    return [parsed];
  } catch {
    return deterministicFallback(input);
  }
}
