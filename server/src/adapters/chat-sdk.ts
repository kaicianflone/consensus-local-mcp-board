import { db } from '../db/store.js';
import { getCredential } from '../db/credentials.js';

// ── Types ──

export type ChatTarget = {
  subjectId: string;
  adapter: string;
  handle: string;
};

export type ChatPrompt = {
  boardId: string;
  runId: string;
  approverHint?: string;
  quorum: number;
  risk: number;
  threshold: number;
  promptMode?: string;
  chatTargets?: ChatTarget[];
  timeoutSec?: number;
  requiredVotes?: number;
};

export type DeliveryResult = {
  target: ChatTarget;
  delivered: boolean;
  provider: string;
  reason?: string;
  messageId?: string;
};

export type PromptResult = {
  delivered: boolean;
  provider: string;
  message: string;
  promptMode: string;
  results: DeliveryResult[];
  broadcastFallback?: boolean;
};

const chatProvider = process.env.CHAT_PROVIDER ?? 'webhook';

// ── Adapter-specific @mention formatting ──

export function formatMention(adapter: string, handle: string): string {
  switch (adapter) {
    case 'slack':
      return handle.startsWith('U') ? `<@${handle}>` : `@${handle}`;
    case 'teams':
      return `<at>${handle}</at>`;
    case 'discord':
      return /^\d+$/.test(handle) ? `<@${handle}>` : `@${handle}`;
    case 'telegram':
      return handle.startsWith('@') ? handle : `@${handle}`;
    case 'gchat':
      return `<users/${handle}>`;
    default:
      return `@${handle}`;
  }
}

// ── Per-adapter DM dispatch ──

async function sendSlackDM(target: ChatTarget, message: string, meta: Record<string, unknown>): Promise<DeliveryResult> {
  const token = getCredential(db, 'slack', 'bot_token') || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { target, delivered: false, provider: 'slack', reason: 'No Slack bot_token configured' };
  }
  try {
    const openRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ users: target.handle })
    });
    const openData = await openRes.json() as any;
    const channelId = openData?.channel?.id || target.handle;

    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        channel: channelId,
        text: message,
        metadata: { event_type: 'consensus_approval', event_payload: { runId: meta.runId, boardId: meta.boardId } }
      })
    });
    const data = await r.json() as any;
    return { target, delivered: data.ok === true, provider: 'slack', messageId: data.ts, reason: data.ok ? undefined : (data.error || 'Slack API error') };
  } catch (e: any) {
    return { target, delivered: false, provider: 'slack', reason: e?.message || 'Slack DM failed' };
  }
}

async function sendTeamsDM(target: ChatTarget, message: string, meta: Record<string, unknown>): Promise<DeliveryResult> {
  const webhookUrl = getCredential(db, 'teams', 'webhook_url') || process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    return { target, delivered: false, provider: 'teams', reason: 'No Teams webhook_url configured' };
  }
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        text: message,
        mentions: [{ text: `<at>${target.handle}</at>`, mentioned: { id: target.handle, name: target.subjectId } }],
        consensus: meta
      })
    });
    return { target, delivered: r.ok, provider: 'teams', reason: r.ok ? undefined : `Teams API ${r.status}` };
  } catch (e: any) {
    return { target, delivered: false, provider: 'teams', reason: e?.message || 'Teams DM failed' };
  }
}

async function sendDiscordDM(target: ChatTarget, message: string, _meta: Record<string, unknown>): Promise<DeliveryResult> {
  const token = getCredential(db, 'discord', 'bot_token') || process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return { target, delivered: false, provider: 'discord', reason: 'No Discord bot_token configured' };
  }
  try {
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify({ recipient_id: target.handle })
    });
    const dmData = await dmRes.json() as any;
    if (!dmData?.id) {
      return { target, delivered: false, provider: 'discord', reason: 'Failed to open DM channel' };
    }
    const r = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(dmData.id)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify({ content: message })
    });
    const data = await r.json() as any;
    return { target, delivered: r.ok, provider: 'discord', messageId: data?.id, reason: r.ok ? undefined : (data?.message || 'Discord API error') };
  } catch (e: any) {
    return { target, delivered: false, provider: 'discord', reason: e?.message || 'Discord DM failed' };
  }
}

async function sendTelegramDM(target: ChatTarget, message: string, _meta: Record<string, unknown>): Promise<DeliveryResult> {
  const token = getCredential(db, 'telegram', 'bot_token') || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { target, delivered: false, provider: 'telegram', reason: 'No Telegram bot_token configured' };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target.handle, text: message, parse_mode: 'Markdown' })
    });
    const data = await r.json() as any;
    return { target, delivered: data.ok === true, provider: 'telegram', messageId: String(data.result?.message_id || ''), reason: data.ok ? undefined : (data.description || 'Telegram API error') };
  } catch (e: any) {
    return { target, delivered: false, provider: 'telegram', reason: e?.message || 'Telegram DM failed' };
  }
}

async function sendGChatDM(target: ChatTarget, message: string, meta: Record<string, unknown>): Promise<DeliveryResult> {
  const webhookUrl = getCredential(db, 'gchat', 'webhook_url') || process.env.GCHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    return { target, delivered: false, provider: 'gchat', reason: 'No Google Chat webhook_url configured' };
  }
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message, consensus: meta })
    });
    return { target, delivered: r.ok, provider: 'gchat', reason: r.ok ? undefined : `Google Chat API ${r.status}` };
  } catch (e: any) {
    return { target, delivered: false, provider: 'gchat', reason: e?.message || 'Google Chat DM failed' };
  }
}

async function sendViaAdapter(target: ChatTarget, message: string, meta: Record<string, unknown>): Promise<DeliveryResult> {
  switch (target.adapter) {
    case 'slack': return sendSlackDM(target, message, meta);
    case 'teams': return sendTeamsDM(target, message, meta);
    case 'discord': return sendDiscordDM(target, message, meta);
    case 'telegram': return sendTelegramDM(target, message, meta);
    case 'gchat': return sendGChatDM(target, message, meta);
    default:
      return { target, delivered: false, provider: target.adapter, reason: `Unknown adapter: ${target.adapter}` };
  }
}

// ── Generic webhook fallback ──

async function sendViaWebhook(message: string, meta: Record<string, unknown>): Promise<DeliveryResult> {
  const url = getCredential(db, 'slack', 'webhook_url') || process.env.CHAT_WEBHOOK_URL;
  if (!url) {
    return { target: { subjectId: 'broadcast', adapter: 'webhook', handle: '' }, delivered: false, provider: 'webhook', reason: 'No webhook URL configured (check Settings or CHAT_WEBHOOK_URL env var)' };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = getCredential(db, 'slack', 'bot_token') || process.env.CHAT_WEBHOOK_BEARER;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ message, ...meta }) });
    return { target: { subjectId: 'broadcast', adapter: 'webhook', handle: '' }, delivered: r.ok, provider: 'webhook', reason: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e: any) {
    return { target: { subjectId: 'broadcast', adapter: 'webhook', handle: '' }, delivered: false, provider: 'webhook', reason: e?.message };
  }
}

// ── Build approval prompt message with @mentions ──

function buildApprovalMessage(prompt: ChatPrompt, targets: ChatTarget[]): string {
  const mode = prompt.promptMode || 'yes-no';
  const riskPct = (prompt.risk * 100).toFixed(0);
  const threshPct = (prompt.threshold * 100).toFixed(0);

  const mentions = targets.map(t => formatMention(t.adapter, t.handle)).join(', ');
  const mentionLine = mentions ? `${mentions} — ` : '';

  let actionHint: string;
  if (mode === 'approve-reject-revise') {
    actionHint = 'Reply APPROVE, REJECT, or REVISE.';
  } else if (mode === 'acknowledge') {
    actionHint = 'Reply ACK to acknowledge.';
  } else if (mode === 'vote') {
    actionHint = `Reply YES, NO, or REWRITE with your rationale. (${prompt.requiredVotes ?? 1} vote(s) required)`;
  } else {
    actionHint = 'Reply YES or NO.';
  }

  const timeoutLine = prompt.timeoutSec
    ? `\nDeadline: ${Math.ceil(prompt.timeoutSec / 60)} minutes`
    : '';

  return `${mentionLine}Guard approval required for run ${prompt.runId}\n` +
    `Risk: ${riskPct}% (threshold: ${threshPct}%) | Quorum: ${(prompt.quorum * 100).toFixed(0)}%\n` +
    `${actionHint}${timeoutLine}`;
}

// ── Main dispatch: sends DMs per adapter per target, falls back to webhook ──

export async function sendHumanApprovalPrompt(prompt: ChatPrompt): Promise<PromptResult> {
  const mode = prompt.promptMode || 'yes-no';
  const targets = prompt.chatTargets || [];
  const message = buildApprovalMessage(prompt, targets);

  const meta: Record<string, unknown> = {
    boardId: prompt.boardId,
    runId: prompt.runId,
    approverHint: prompt.approverHint ?? 'human',
    type: 'human_approval_request',
    promptMode: mode,
    timeoutSec: prompt.timeoutSec,
    requiredVotes: prompt.requiredVotes
  };

  if (chatProvider === 'stdout') {
    const targetInfo = targets.length > 0
      ? targets.map(t => `${t.subjectId} via ${t.adapter}:${t.handle}`).join(', ')
      : 'broadcast';
    console.log('[chat-sdk]', message, `[targets: ${targetInfo}]`);
    return { delivered: true, provider: 'stdout', message, promptMode: mode, results: targets.map(t => ({ target: t, delivered: true, provider: 'stdout' })) };
  }

  // Per-adapter DM dispatch to each assigned participant
  if (targets.length > 0) {
    const results = await Promise.all(
      targets.map(target => sendViaAdapter(target, message, { ...meta, targetSubjectId: target.subjectId }))
    );
    const anyDelivered = results.some(r => r.delivered);

    // Fall back to broadcast webhook if all adapter DMs failed
    if (!anyDelivered) {
      console.warn('[chat-sdk] All adapter DMs failed, falling back to broadcast webhook');
      const fallback = await sendViaWebhook(message, meta);
      return { delivered: fallback.delivered, provider: 'webhook-fallback', message, promptMode: mode, results: [...results, fallback], broadcastFallback: true };
    }
    return { delivered: anyDelivered, provider: 'multi-adapter', message, promptMode: mode, results };
  }

  // No specific targets — broadcast via webhook
  const fallback = await sendViaWebhook(message, meta);
  return { delivered: fallback.delivered, provider: 'webhook', message, promptMode: mode, results: [fallback], broadcastFallback: true };
}

// ── Timeout warning message ──

export async function sendTimeoutWarning(prompt: ChatPrompt, remainingSec: number): Promise<PromptResult> {
  const targets = prompt.chatTargets || [];
  const mentions = targets.map(t => formatMention(t.adapter, t.handle)).join(', ');
  const mentionLine = mentions ? `${mentions} ` : '';
  const message = `${mentionLine}Reminder: approval for run ${prompt.runId} is still pending. ${Math.ceil(remainingSec / 60)} minute(s) remaining before auto-escalation.`;

  const meta: Record<string, unknown> = { boardId: prompt.boardId, runId: prompt.runId, type: 'approval_timeout_warning', remainingSec };

  if (chatProvider === 'stdout') {
    console.log('[chat-sdk] TIMEOUT WARNING:', message);
    return { delivered: true, provider: 'stdout', message, promptMode: 'warning', results: [] };
  }
  if (targets.length > 0) {
    const results = await Promise.all(targets.map(t => sendViaAdapter(t, message, meta)));
    return { delivered: results.some(r => r.delivered), provider: 'multi-adapter', message, promptMode: 'warning', results };
  }
  const fallback = await sendViaWebhook(message, meta);
  return { delivered: fallback.delivered, provider: 'webhook', message, promptMode: 'warning', results: [fallback] };
}

// ── Deadline expired notification ──

export async function sendDeadlineExpired(prompt: ChatPrompt, autoDecision: string): Promise<PromptResult> {
  const targets = prompt.chatTargets || [];
  const mentions = targets.map(t => formatMention(t.adapter, t.handle)).join(', ');
  const mentionLine = mentions ? `${mentions} ` : '';
  const message = `${mentionLine}Deadline expired for run ${prompt.runId}. Auto-resolved as: ${autoDecision}.`;

  const meta: Record<string, unknown> = { boardId: prompt.boardId, runId: prompt.runId, type: 'approval_deadline_expired', autoDecision };

  if (chatProvider === 'stdout') {
    console.log('[chat-sdk] DEADLINE EXPIRED:', message);
    return { delivered: true, provider: 'stdout', message, promptMode: 'expired', results: [] };
  }
  if (targets.length > 0) {
    const results = await Promise.all(targets.map(t => sendViaAdapter(t, message, meta)));
    return { delivered: results.some(r => r.delivered), provider: 'multi-adapter', message, promptMode: 'expired', results };
  }
  const fallback = await sendViaWebhook(message, meta);
  return { delivered: fallback.delivered, provider: 'webhook', message, promptMode: 'expired', results: [fallback] };
}
