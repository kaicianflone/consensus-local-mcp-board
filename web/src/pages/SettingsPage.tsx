import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Github, MessageSquare, Brain, Sparkles, Eye, EyeOff, Save, Trash2, CheckCircle2, XCircle, Copy, Check, Webhook, Download, Package, Loader2, Hash, Radio, Send, AtSign } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { getCredentialsList, upsertCredential, deleteCredential, getAdapters, installAdapter, uninstallAdapter } from '../lib/api';

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

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [adapters, setAdapters] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [credData, adapterData] = await Promise.all([
        getCredentialsList(),
        getAdapters(),
      ]);
      setCredentials(credData.credentials || []);
      setAdapters(adapterData.adapters || {});
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

  const visibleProviders = PROVIDERS.filter(p =>
    !p.requiresAdapter || adapters[p.id]
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
          <ArrowLeft className="h-4 w-4" />
          Back to Workflows
        </Link>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage chat adapters and credentials for external integrations. Values are encrypted and stored server-side.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-4">
          <ChatAdaptersSection
            adapters={adapters}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
          />

          {visibleProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              credentials={credentials}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
