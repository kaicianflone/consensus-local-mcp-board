import { z } from 'zod';
import type { GuardEvaluateRequest } from '@local-mcp-board/shared';
import { db } from '../db/store.js';
import { getCredential } from '../db/credentials.js';

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

export type AgentPersona = {
  name: string;
  reputation: number;
  systemPrompt?: string;
};

export async function evaluateWithAiSdk(
  input: GuardEvaluateRequest,
  options?: { agentCount?: number; personas?: AgentPersona[]; model?: string; temperature?: number; systemPrompt?: string }
): Promise<AiVote[]> {
  const apiKey = getCredential(db, 'openai', 'api_key') || process.env.OPENAI_API_KEY;
  const modelId = options?.model || process.env.AI_MODEL || 'gpt-4o-mini';
  const agentCount = options?.agentCount || 1;
  const temperature = options?.temperature ?? 0;

  if (!apiKey) {
    const fallback = deterministicFallback(input);
    const results: AiVote[] = [];
    const personas = options?.personas || [];
    for (let i = 0; i < agentCount; i++) {
      const persona = personas[i];
      results.push({
        ...fallback[0],
        evaluator: persona?.name || `fallback-agent-${i + 1}`,
      });
    }
    return results;
  }

  let generateText: any;
  let createOpenAI: any;
  try {
    const aiModule = await import('ai');
    generateText = aiModule.generateText;
    const openaiModule = await import('@ai-sdk/openai');
    createOpenAI = openaiModule.createOpenAI;
  } catch (e) {
    console.error('[ai-sdk] Failed to import AI SDK modules, using fallback:', e);
    const fb = deterministicFallback(input)[0];
    const personas = options?.personas || [];
    const results: AiVote[] = [];
    for (let i = 0; i < agentCount; i++) {
      results.push({ ...fb, evaluator: personas[i]?.name || `fallback-agent-${i + 1}` });
    }
    return results;
  }

  const openai = createOpenAI({ apiKey });
  const model = openai(modelId);

  const personas = options?.personas || [];
  const tasks: Promise<AiVote>[] = [];

  for (let i = 0; i < agentCount; i++) {
    const persona = personas[i] || { name: `agent-${i + 1}`, reputation: 0.5 };

    const personaContext = persona.systemPrompt
      ? `You are "${persona.name}" (reputation: ${persona.reputation.toFixed(2)}). ${persona.systemPrompt}`
      : `You are "${persona.name}", a consensus guard evaluator with reputation score ${persona.reputation.toFixed(2)}.`;

    const baseSystemPrompt = options?.systemPrompt || 'You are a strict consensus guard evaluator.';

    const prompt = [
      personaContext,
      baseSystemPrompt,
      `Guard type: ${input.guardType}`,
      `Policy: ${JSON.stringify(input.policy)}`,
      `Payload: ${JSON.stringify(input.payload)}`,
      'Return ONLY JSON with fields: evaluator (your name), vote (YES|NO|REWRITE), reason (string), risk (0..1).'
    ].join('\n');

    const task = (async (): Promise<AiVote> => {
      try {
        const result = await generateText({
          model,
          temperature,
          messages: [
            { role: 'system', content: 'Output strict JSON only.' },
            { role: 'user', content: prompt }
          ],
        });

        const content = result.text;
        if (!content || typeof content !== 'string') {
          return { ...deterministicFallback(input)[0], evaluator: persona.name };
        }

        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = VoteSchema.parse(JSON.parse(jsonStr));
        return { ...parsed, evaluator: persona.name };
      } catch (e) {
        console.error(`[ai-sdk] Agent "${persona.name}" evaluation failed:`, e);
        return { ...deterministicFallback(input)[0], evaluator: persona.name };
      }
    })();

    tasks.push(task);
  }

  return Promise.all(tasks);
}
