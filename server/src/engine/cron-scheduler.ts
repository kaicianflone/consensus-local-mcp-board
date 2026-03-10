// ── Cron Scheduler ──
// In-process cron scheduler following the hitl-tracker.ts pattern.
// Supports minute-level cron expressions (subset: */N and fixed values).

import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export type CronEntry = {
  id: string;
  workflowId: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string | null;
};

type CronCallback = (workflowId: string) => void | Promise<void>;

const schedules = new Map<string, CronEntry>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let dbRef: Database.Database | null = null;
let onTrigger: CronCallback | null = null;

const CHECK_INTERVAL_MS = 60_000; // check every 60s (minute-level granularity)

// ── Cron expression parsing (minimal subset) ──
// Supports: *, */N, and fixed numbers for each of the 5 fields (min hour dom mon dow)

function parseCronField(field: string, current: number, max: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && current % step === 0;
  }
  const fixed = parseInt(field, 10);
  return !isNaN(fixed) && current === fixed;
}

function shouldRunNow(cronExpression: string): boolean {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const now = new Date();
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    parseCronField(minute, now.getMinutes(), 59) &&
    parseCronField(hour, now.getHours(), 23) &&
    parseCronField(dayOfMonth, now.getDate(), 31) &&
    parseCronField(month, now.getMonth() + 1, 12) &&
    parseCronField(dayOfWeek, now.getDay(), 6)
  );
}

// ── Public API ──

export function initCronScheduler(db: Database.Database, callback: CronCallback) {
  dbRef = db;
  onTrigger = callback;
}

export function registerCron(workflowId: string, cronExpression: string): CronEntry {
  // Upsert: remove existing schedule for this workflow
  for (const [id, entry] of schedules) {
    if (entry.workflowId === workflowId) {
      schedules.delete(id);
      break;
    }
  }

  const id = nanoid();
  const entry: CronEntry = { id, workflowId, cronExpression, enabled: true, lastRunAt: null };
  schedules.set(id, entry);

  // Persist to DB
  if (dbRef) {
    dbRef.prepare(`
      INSERT OR REPLACE INTO cron_schedules (id, workflow_id, cron_expression, enabled, last_run_at)
      VALUES (?, ?, ?, 1, NULL)
    `).run(id, workflowId, cronExpression);
  }

  ensureTimerRunning();
  return entry;
}

export function unregisterCron(workflowId: string): boolean {
  let removed = false;
  for (const [id, entry] of schedules) {
    if (entry.workflowId === workflowId) {
      schedules.delete(id);
      removed = true;
      break;
    }
  }

  if (dbRef) {
    const result = dbRef.prepare('DELETE FROM cron_schedules WHERE workflow_id = ?').run(workflowId);
    removed = removed || (result.changes > 0);
  }

  if (schedules.size === 0 && intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  return removed;
}

export function listCronSchedules(): CronEntry[] {
  return Array.from(schedules.values());
}

export function loadPersistedSchedules(db: Database.Database) {
  dbRef = db;
  try {
    const rows = db.prepare('SELECT * FROM cron_schedules WHERE enabled = 1').all() as any[];
    for (const row of rows) {
      schedules.set(row.id, {
        id: row.id,
        workflowId: row.workflow_id,
        cronExpression: row.cron_expression,
        enabled: true,
        lastRunAt: row.last_run_at || null,
      });
    }
    if (schedules.size > 0) {
      ensureTimerRunning();
      console.log(`[cron] Loaded ${schedules.size} persisted schedule(s)`);
    }
  } catch (e: any) {
    // Table may not exist yet if migration hasn't run
    console.warn(`[cron] Failed to load persisted schedules: ${e?.message}`);
  }
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  schedules.clear();
}

// ── Internal ──

function ensureTimerRunning() {
  if (intervalId) return;
  intervalId = setInterval(checkSchedules, CHECK_INTERVAL_MS);
}

async function checkSchedules() {
  const now = new Date().toISOString();

  for (const [_id, entry] of schedules) {
    if (!entry.enabled) continue;
    if (!shouldRunNow(entry.cronExpression)) continue;

    // Prevent double-fire within the same minute
    if (entry.lastRunAt) {
      const lastMinute = entry.lastRunAt.slice(0, 16); // YYYY-MM-DDTHH:MM
      const currentMinute = now.slice(0, 16);
      if (lastMinute === currentMinute) continue;
    }

    entry.lastRunAt = now;

    // Persist last_run_at
    if (dbRef) {
      try {
        dbRef.prepare('UPDATE cron_schedules SET last_run_at = ? WHERE id = ?').run(now, entry.id);
      } catch { /* non-fatal */ }
    }

    // Fire the callback
    if (onTrigger) {
      try {
        await onTrigger(entry.workflowId);
      } catch (e: any) {
        console.error(`[cron] Failed to trigger workflow ${entry.workflowId}:`, e?.message);
      }
    }
  }

  // Auto-stop when no schedules remain
  if (schedules.size === 0 && intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// Exported for testing
export { shouldRunNow as _shouldRunNow };
