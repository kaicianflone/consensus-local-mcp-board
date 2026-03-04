import { db } from '../db/store.js';
import { getCredential } from '../db/credentials.js';

type ChatTarget = {
  subjectId: string;
  adapter: string;
  handle: string;
};

type ChatPrompt = {
  boardId: string;
  runId: string;
  approverHint?: string;
  quorum: number;
  risk: number;
  threshold: number;
  chatTargets?: ChatTarget[];
};

const chatProvider = process.env.CHAT_PROVIDER ?? 'webhook';

async function sendViaWebhook(message: string, meta: Record<string, unknown>) {
  const url = getCredential(db, 'slack', 'webhook_url') || process.env.CHAT_WEBHOOK_URL;
  if (!url) {
    return { delivered: false, provider: 'webhook', reason: 'No webhook URL configured (check Settings or CHAT_WEBHOOK_URL env var)' };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = getCredential(db, 'slack', 'bot_token') || process.env.CHAT_WEBHOOK_BEARER;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, ...meta })
  });

  if (!r.ok) {
    return { delivered: false, provider: 'webhook', status: r.status, reason: await r.text() };
  }

  return { delivered: true, provider: 'webhook', status: r.status };
}

export async function sendHitlPrompt(prompt: ChatPrompt) {
  const message = `Guard tool alert: run ${prompt.runId} reached quorum ${(prompt.quorum * 100).toFixed(0)}% but risk ${prompt.risk.toFixed(2)} >= ${prompt.threshold.toFixed(2)}, so HITL is required. Reply YES or NO.`;

  const targetInfo = prompt.chatTargets && prompt.chatTargets.length > 0
    ? prompt.chatTargets.map((t) => `${t.subjectId} via ${t.adapter}:${t.handle}`).join(', ')
    : 'broadcast';

  if (chatProvider === 'stdout') {
    console.log('[chat-sdk]', message, `[targets: ${targetInfo}]`);
    return { delivered: true, provider: 'stdout', message, targets: targetInfo };
  }

  const meta: Record<string, unknown> = {
    boardId: prompt.boardId,
    runId: prompt.runId,
    approverHint: prompt.approverHint ?? 'human',
    type: 'hitl_request'
  };

  if (prompt.chatTargets && prompt.chatTargets.length > 0) {
    meta.chatTargets = prompt.chatTargets;
  }

  return sendViaWebhook(message, meta);
}
