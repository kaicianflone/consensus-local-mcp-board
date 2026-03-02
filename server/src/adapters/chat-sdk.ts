type ChatPrompt = {
  boardId: string;
  runId: string;
  approverHint?: string;
  quorum: number;
  risk: number;
  threshold: number;
};

const chatProvider = process.env.CHAT_PROVIDER ?? 'webhook';

async function sendViaWebhook(message: string, meta: Record<string, unknown>) {
  const url = process.env.CHAT_WEBHOOK_URL;
  if (!url) {
    return { delivered: false, provider: 'webhook', reason: 'CHAT_WEBHOOK_URL not configured' };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.CHAT_WEBHOOK_BEARER) headers.Authorization = `Bearer ${process.env.CHAT_WEBHOOK_BEARER}`;

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

  if (chatProvider === 'stdout') {
    console.log('[chat-sdk]', message);
    return { delivered: true, provider: 'stdout', message };
  }

  return sendViaWebhook(message, {
    boardId: prompt.boardId,
    runId: prompt.runId,
    approverHint: prompt.approverHint ?? 'human',
    type: 'hitl_request'
  });
}
