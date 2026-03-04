import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Github, MessageSquare, Brain, Sparkles, Eye, EyeOff, Save, Trash2, CheckCircle2, XCircle, Copy, Check, Webhook, Download, Package, Loader2, Hash, Radio, Send, AtSign, Shield, Droplets, Sword, Users, ToggleLeft, ToggleRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Select } from '../components/ui/select';
import { getCredentialsList, upsertCredential, deleteCredential, getAdapters, installAdapter, uninstallAdapter, getReputationConfig, updateReputationConfig } from '../lib/api';

type CredentialEntry = { provider: string; keyName: string; createdAt: number; updatedAt: number };

type ProviderConfig = {
  id: string;
  name: string;
  icon: React.ElementType;
  iconColor: string;
  description: string;
  fields: Array<{ key: string; label: string; placeholder: string; helpText?: string }>;
  requiresAdapter?: boolean;
};

type AdapterConfig = {
  id: string;
  name: string;
  icon: React.ElementType;
  iconColor: string;
  description: string;
  packageName: string;
};

const CHAT_ADAPTERS: AdapterConfig[] = [
  { id: 'slack', name: 'Slack', icon: Hash, iconColor: 'text-purple-400', description: 'Slack workspace integration', packageName: '@chat-adapter/slack' },
  { id: 'teams', name: 'Microsoft Teams', icon: AtSign, iconColor: 'text-blue-400', description: 'Teams channels and chats', packageName: '@chat-adapter/teams' },
  { id: 'gchat', name: 'Google Chat', icon: MessageSquare, iconColor: 'text-green-400', description: 'Google Workspace chat', packageName: '@chat-adapter/gchat' },
  { id: 'discord', name: 'Discord', icon: Radio, iconColor: 'text-indigo-400', description: 'Discord server bots', packageName: '@chat-adapter/discord' },
  { id: 'telegram', name: 'Telegram', icon: Send, iconColor: 'text-sky-400', description: 'Telegram bot API', packageName: '@chat-adapter/telegram' },
];

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    icon: Github,
    iconColor: 'text-white',
    description: 'Connect GitHub to trigger workflows from PRs, commits, and issues.',
    fields: [
      { key: 'personal_access_token', label: 'Personal Access Token', placeholder: 'ghp_xxxxxxxxxxxx', helpText: 'Required for API actions like merging PRs.' },
      { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'your-webhook-secret', helpText: 'Used to verify incoming GitHub webhook payloads.' },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: Hash,
    iconColor: 'text-purple-400',
    description: 'Send HITL prompts and notifications to Slack channels.',
    requiresAdapter: true,
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-xxxxxxxxxxxx' },
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
    ],
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    icon: AtSign,
    iconColor: 'text-blue-400',
    description: 'Send notifications and HITL prompts to Teams channels.',
    requiresAdapter: true,
    fields: [
      { key: 'webhook_url', label: 'Incoming Webhook URL', placeholder: 'https://outlook.office.com/webhook/...' },
    ],
  },
  {
    id: 'gchat',
    name: 'Google Chat',
    icon: MessageSquare,
    iconColor: 'text-green-400',
    description: 'Send notifications to Google Chat spaces.',
    requiresAdapter: true,
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://chat.googleapis.com/v1/spaces/...' },
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: Radio,
    iconColor: 'text-indigo-400',
    description: 'Send notifications to Discord channels via bot.',
    requiresAdapter: true,
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'MTxxxxxxxx...' },
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' },
    ],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: Send,
    iconColor: 'text-sky-400',
    description: 'Send notifications via Telegram bot.',
    requiresAdapter: true,
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF...' },
      { key: 'api_key', label: 'Chat ID', placeholder: '-1001234567890' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: Brain,
    iconColor: 'text-emerald-400',
    description: 'Powers AI guard evaluations and agent reasoning.',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'sk-xxxxxxxxxxxx' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: Sparkles,
    iconColor: 'text-amber-400',
    description: 'Alternative AI provider for guard evaluations.',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'sk-ant-xxxxxxxxxxxx' },
    ],
  },
];

function ChatAdaptersSection({ adapters, onInstall, onUninstall }: {
  adapters: Record<string, boolean>;
  onInstall: (id: string) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
}) {
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [uninstalling, setUninstalling] = useState<Record<string, boolean>>({});

  const handleInstall = async (id: string) => {
    setInstalling(s => ({ ...s, [id]: true }));
    try { await onInstall(id); } finally { setInstalling(s => ({ ...s, [id]: false })); }
  };

  const handleUninstall = async (id: string) => {
    setUninstalling(s => ({ ...s, [id]: true }));
    try { await onUninstall(id); } finally { setUninstalling(s => ({ ...s, [id]: false })); }
  };

  const installedCount = Object.values(adapters).filter(Boolean).length;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Chat Adapters</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Install chat platform adapters to enable HITL notifications and webhook integrations.
              </p>
            </div>
          </div>
          <Badge variant={installedCount > 0 ? 'default' : 'outline'}>
            {installedCount} installed
          </Badge>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CHAT_ADAPTERS.map((adapter) => {
            const isInstalled = adapters[adapter.id] || false;
            const isInstalling = installing[adapter.id] || false;
            const isUninstalling = uninstalling[adapter.id] || false;
            const busy = isInstalling || isUninstalling;

            return (
              <div
                key={adapter.id}
                className={`flex items-center justify-between rounded-lg border p-3 transition-all ${
                  isInstalled ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-muted/20'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <adapter.icon className={`h-5 w-5 shrink-0 ${adapter.iconColor}`} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{adapter.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{adapter.packageName}</div>
                  </div>
                </div>
                {isInstalled ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUninstall(adapter.id)}
                    disabled={busy}
                    className="shrink-0 h-8 px-2.5 text-xs text-destructive hover:text-destructive"
                  >
                    {isUninstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleInstall(adapter.id)}
                    disabled={busy}
                    className="shrink-0 h-8 gap-1.5 text-xs"
                  >
                    {isInstalling ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing...</>
                    ) : (
                      <><Download className="h-3.5 w-3.5" /> Install</>
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderCard({ provider, credentials, onSave, onDelete }: {
  provider: ProviderConfig;
  credentials: CredentialEntry[];
  onSave: (provider: string, keyName: string, value: string) => Promise<void>;
  onDelete: (provider: string, keyName: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const configuredKeys = new Set(credentials.filter(c => c.provider === provider.id).map(c => c.keyName));
  const configuredCount = provider.fields.filter(f => configuredKeys.has(f.key)).length;

  const handleSave = async (key: string) => {
    const val = values[key]?.trim();
    if (!val) return;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      await onSave(provider.id, key, val);
      setValues(v => ({ ...v, [key]: '' }));
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const handleDelete = async (key: string) => {
    setDeleting(s => ({ ...s, [key]: true }));
    try {
      await onDelete(provider.id, key);
    } finally {
      setDeleting(s => ({ ...s, [key]: false }));
    }
  };

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/github`
    : '/api/webhooks/github';

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <provider.icon className={`h-5 w-5 ${provider.iconColor}`} />
            </div>
            <div>
              <CardTitle className="text-base">{provider.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{provider.description}</p>
            </div>
          </div>
          <Badge variant={configuredCount === provider.fields.length ? 'default' : configuredCount > 0 ? 'secondary' : 'outline'}>
            {configuredCount}/{provider.fields.length} configured
          </Badge>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4 space-y-4">
        {provider.id === 'github' && (
          <div className="rounded-md border border-border/50 bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium mb-1.5">
              <Webhook className="h-4 w-4 text-muted-foreground" />
              Webhook URL
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background px-3 py-1.5 text-xs font-mono text-muted-foreground truncate border border-border/50">
                {webhookUrl}
              </code>
              <Button variant="outline" size="sm" onClick={copyWebhookUrl} className="shrink-0 gap-1.5">
                {copiedWebhook ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedWebhook ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Add this URL in your GitHub repo settings under Webhooks. Set content type to application/json.
            </p>
          </div>
        )}

        {provider.fields.map((field) => {
          const isConfigured = configuredKeys.has(field.key);
          const isVisible = visible[field.key] || false;
          const isSaving = saving[field.key] || false;
          const isDeleting = deleting[field.key] || false;
          const currentValue = values[field.key] || '';

          return (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-2">
                  {field.label}
                  {isConfigured ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
                  )}
                </label>
                {isConfigured && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(field.key)}
                    disabled={isDeleting}
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    {isDeleting ? 'Removing...' : 'Remove'}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={isVisible ? 'text' : 'password'}
                    placeholder={isConfigured ? '••••••••••••' : field.placeholder}
                    value={currentValue}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible(v => ({ ...v, [field.key]: !isVisible }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  onClick={() => handleSave(field.key)}
                  disabled={!currentValue.trim() || isSaving}
                  size="sm"
                  className="shrink-0 gap-1.5"
                >
                  <Save className="h-3.5 w-3.5" />
                  {isSaving ? 'Saving...' : isConfigured ? 'Update' : 'Save'}
                </Button>
              </div>
              {field.helpText && (
                <p className="text-xs text-muted-foreground">{field.helpText}</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

type SlashRule = {
  id: string;
  label: string;
  description: string;
  penalty: number;
  enabled: boolean;
};

type ReputationConfigData = {
  faucet: {
    initialReputation: number;
    minReputation: number;
    maxReputation: number;
    dripAmount: number;
    dripTrigger: string;
    decayRate: number;
    decayInterval: string;
  };
  slashing: {
    enabled: boolean;
    rules: SlashRule[];
  };
  persona: {
    archetypeBonus: number;
    diversityWeight: number;
    minPersonasForBonus: number;
  };
};

const DRIP_TRIGGERS = [
  { value: 'consensus_match', label: 'Consensus Match' },
  { value: 'correct_vote', label: 'Correct Vote' },
  { value: 'participation', label: 'Participation' },
  { value: 'per_round', label: 'Per Round' },
];

const DECAY_INTERVALS = [
  { value: 'per_round', label: 'Per Round' },
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_workflow', label: 'Per Workflow Run' },
  { value: 'none', label: 'No Decay' },
];

function ReputationSettingsSection({ config, onSave }: { config: ReputationConfigData; onSave: (config: ReputationConfigData) => Promise<void> }) {
  const [draft, setDraft] = useState<ReputationConfigData>(config);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(config);
    setDirty(false);
  }, [config]);

  function updateFaucet(key: string, value: any) {
    setDraft(d => ({ ...d, faucet: { ...d.faucet, [key]: value } }));
    setDirty(true);
  }

  function updateSlashing(key: string, value: any) {
    setDraft(d => ({ ...d, slashing: { ...d.slashing, [key]: value } }));
    setDirty(true);
  }

  function updateRule(ruleId: string, key: string, value: any) {
    setDraft(d => ({
      ...d,
      slashing: {
        ...d.slashing,
        rules: d.slashing.rules.map(r => r.id === ruleId ? { ...r, [key]: value } : r),
      },
    }));
    setDirty(true);
  }

  function updatePersona(key: string, value: any) {
    setDraft(d => ({ ...d, persona: { ...d.persona, [key]: value } }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Shield className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Reputation & Slashing</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure reputation faucet, slash rules, and persona engine settings.
              </p>
            </div>
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4 space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Droplets className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-medium">Reputation Faucet</h3>
            <Badge variant="outline" className="text-[10px]">consensus-tools</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Controls how reputation flows to agents. Agents earn reputation when they align with consensus outcomes.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Initial Rep</label>
              <Input className="h-8 text-xs" type="number" min="0" max="1" step="0.05" value={draft.faucet.initialReputation} onChange={(e) => updateFaucet('initialReputation', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Min Rep</label>
              <Input className="h-8 text-xs" type="number" min="0" max="1" step="0.05" value={draft.faucet.minReputation} onChange={(e) => updateFaucet('minReputation', parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Max Rep</label>
              <Input className="h-8 text-xs" type="number" min="0" max="1" step="0.05" value={draft.faucet.maxReputation} onChange={(e) => updateFaucet('maxReputation', parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Drip Amount</label>
              <Input className="h-8 text-xs" type="number" min="0" max="0.5" step="0.005" value={draft.faucet.dripAmount} onChange={(e) => updateFaucet('dripAmount', parseFloat(e.target.value) || 0)} />
              <p className="text-[10px] text-muted-foreground">Rep gained per trigger event</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Drip Trigger</label>
              <Select className="h-8 text-xs" value={draft.faucet.dripTrigger} onChange={(e) => updateFaucet('dripTrigger', e.target.value)}>
                {DRIP_TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <p className="text-[10px] text-muted-foreground">When reputation is awarded</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Decay Rate</label>
              <Input className="h-8 text-xs" type="number" min="0" max="0.5" step="0.005" value={draft.faucet.decayRate} onChange={(e) => updateFaucet('decayRate', parseFloat(e.target.value) || 0)} />
              <p className="text-[10px] text-muted-foreground">Passive rep loss over time</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Decay Interval</label>
              <Select className="h-8 text-xs" value={draft.faucet.decayInterval} onChange={(e) => updateFaucet('decayInterval', e.target.value)}>
                {DECAY_INTERVALS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <p className="text-[10px] text-muted-foreground">How often decay applies</p>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sword className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-medium">Slash Rules</h3>
              <Badge variant="outline" className="text-[10px]">consensus-tools</Badge>
            </div>
            <button
              onClick={() => updateSlashing('enabled', !draft.slashing.enabled)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {draft.slashing.enabled ? (
                <><ToggleRight className="h-4 w-4 text-emerald-400" /> Enabled</>
              ) : (
                <><ToggleLeft className="h-4 w-4 text-muted-foreground" /> Disabled</>
              )}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Penalties applied to agent reputation when they violate consensus expectations.
          </p>
          <div className="space-y-2">
            {draft.slashing.rules.map((rule) => (
              <div
                key={rule.id}
                className={`rounded-lg border p-3 transition-all ${
                  rule.enabled && draft.slashing.enabled
                    ? 'border-red-500/20 bg-red-500/5'
                    : 'border-border/50 bg-muted/20 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateRule(rule.id, 'enabled', !rule.enabled)}
                      disabled={!draft.slashing.enabled}
                      className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {rule.enabled ? (
                        <ToggleRight className="h-4 w-4 text-red-400" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>
                    <span className="text-sm font-medium">{rule.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-muted-foreground">Penalty:</label>
                    <Input
                      className="h-6 w-16 text-xs text-center"
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={rule.penalty}
                      onChange={(e) => updateRule(rule.id, 'penalty', parseFloat(e.target.value) || 0)}
                      disabled={!draft.slashing.enabled || !rule.enabled}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground pl-6">{rule.description}</p>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-medium">Persona Engine</h3>
            <Badge variant="outline" className="text-[10px]">consensus-persona-engine</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Bonuses for diverse persona usage and archetype specialization.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Archetype Bonus</label>
              <Input className="h-8 text-xs" type="number" min="0" max="0.5" step="0.01" value={draft.persona.archetypeBonus} onChange={(e) => updatePersona('archetypeBonus', parseFloat(e.target.value) || 0)} />
              <p className="text-[10px] text-muted-foreground">Extra rep for archetype agents</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Diversity Weight</label>
              <Input className="h-8 text-xs" type="number" min="0" max="1" step="0.05" value={draft.persona.diversityWeight} onChange={(e) => updatePersona('diversityWeight', parseFloat(e.target.value) || 0)} />
              <p className="text-[10px] text-muted-foreground">Bonus for varied persona mix</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Min Personas</label>
              <Input className="h-8 text-xs" type="number" min="1" max="10" step="1" value={draft.persona.minPersonasForBonus} onChange={(e) => updatePersona('minPersonasForBonus', parseInt(e.target.value) || 1)} />
              <p className="text-[10px] text-muted-foreground">Min agents for diversity bonus</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [adapters, setAdapters] = useState<Record<string, boolean>>({});
  const [reputationConfig, setReputationConfig] = useState<ReputationConfigData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [credData, adapterData, repData] = await Promise.all([
        getCredentialsList(),
        getAdapters(),
        getReputationConfig(),
      ]);
      setCredentials(credData.credentials || []);
      setAdapters(adapterData.adapters || {});
      setReputationConfig(repData.config || null);
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSave = async (provider: string, keyName: string, value: string) => {
    await upsertCredential(provider, keyName, value);
    await loadAll();
  };

  const handleDelete = async (provider: string, keyName: string) => {
    await deleteCredential(provider, keyName);
    await loadAll();
  };

  const handleInstall = async (id: string) => {
    await installAdapter(id);
    await loadAll();
  };

  const handleUninstall = async (id: string) => {
    await uninstallAdapter(id);
    await loadAll();
  };

  const handleSaveReputation = async (config: ReputationConfigData) => {
    const result = await updateReputationConfig(config);
    setReputationConfig(result.config);
  };

  const visibleProviders = PROVIDERS.filter(p =>
    !p.requiresAdapter || adapters[p.id]
  );

  const [activeSection, setActiveSection] = useState('reputation');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 }
    );
    const sections = document.querySelectorAll('[data-settings-section]');
    sections.forEach(s => observer.observe(s));
    return () => observer.disconnect();
  }, [loading, visibleProviders.length]);

  const sidebarItems = [
    { id: 'reputation', label: 'Reputation & Slashing', icon: Shield, color: 'text-amber-400' },
    { id: 'adapters', label: 'Chat Adapters', icon: Package, color: 'text-primary' },
    ...visibleProviders.map(p => ({ id: `provider-${p.id}`, label: p.name, icon: p.icon, color: p.iconColor })),
  ];

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
          <ArrowLeft className="h-4 w-4" />
          Back to Workflows
        </Link>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage reputation rules, chat adapters, and credentials for external integrations.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : (
        <div className="flex gap-6">
          <nav className="w-48 shrink-0 hidden lg:block">
            <div className="sticky top-6 space-y-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2">Sections</div>
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => scrollTo(item.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-all ${
                      isActive
                        ? 'bg-accent text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? item.color : ''}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="flex-1 min-w-0 space-y-4">
            <div id="reputation" data-settings-section>
              {reputationConfig && (
                <ReputationSettingsSection config={reputationConfig} onSave={handleSaveReputation} />
              )}
            </div>

            <div id="adapters" data-settings-section>
              <ChatAdaptersSection
                adapters={adapters}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
              />
            </div>

            {visibleProviders.map((provider) => (
              <div key={provider.id} id={`provider-${provider.id}`} data-settings-section>
                <ProviderCard
                  provider={provider}
                  credentials={credentials}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
