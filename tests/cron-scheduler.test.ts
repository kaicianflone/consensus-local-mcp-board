import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the exported _shouldRunNow and the register/unregister/list API
// by importing the module fresh each time (to reset module-level state).

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: () => 'test-id-' + Math.random().toString(36).slice(2, 8),
}));

const { _shouldRunNow } = await import('../server/src/engine/cron-scheduler.js');

describe('Cron Scheduler', () => {
  describe('_shouldRunNow (cron expression matching)', () => {
    it('matches wildcard-only expression at any time', () => {
      expect(_shouldRunNow('* * * * *')).toBe(true);
    });

    it('matches */N minute expressions', () => {
      const now = new Date();
      const minute = now.getMinutes();

      // */1 should always match
      expect(_shouldRunNow('*/1 * * * *')).toBe(true);

      // If current minute is divisible by 5, */5 matches
      if (minute % 5 === 0) {
        expect(_shouldRunNow('*/5 * * * *')).toBe(true);
      } else {
        expect(_shouldRunNow('*/5 * * * *')).toBe(false);
      }
    });

    it('matches fixed minute values', () => {
      const now = new Date();
      const minute = now.getMinutes();

      expect(_shouldRunNow(`${minute} * * * *`)).toBe(true);
      expect(_shouldRunNow(`${(minute + 1) % 60} * * * *`)).toBe(false);
    });

    it('matches fixed hour values', () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();

      expect(_shouldRunNow(`${minute} ${hour} * * *`)).toBe(true);
      expect(_shouldRunNow(`${minute} ${(hour + 1) % 24} * * *`)).toBe(false);
    });

    it('rejects malformed expressions', () => {
      expect(_shouldRunNow('')).toBe(false);
      expect(_shouldRunNow('* *')).toBe(false);
      expect(_shouldRunNow('invalid')).toBe(false);
    });

    it('matches day of week', () => {
      const now = new Date();
      const minute = now.getMinutes();
      const hour = now.getHours();
      const dow = now.getDay();

      expect(_shouldRunNow(`${minute} ${hour} * * ${dow}`)).toBe(true);
      expect(_shouldRunNow(`${minute} ${hour} * * ${(dow + 1) % 7}`)).toBe(false);
    });
  });

  describe('register/unregister/list (without DB)', () => {
    // Import fresh module for state tests
    let mod: typeof import('../server/src/engine/cron-scheduler.js');

    beforeEach(async () => {
      // Dynamic import to get fresh module state
      vi.resetModules();
      mod = await import('../server/src/engine/cron-scheduler.js');
    });

    afterEach(() => {
      mod.stopScheduler();
    });

    it('registers and lists a cron schedule', () => {
      const entry = mod.registerCron('wf-1', '*/15 * * * *');
      expect(entry.workflowId).toBe('wf-1');
      expect(entry.cronExpression).toBe('*/15 * * * *');
      expect(entry.enabled).toBe(true);
      expect(entry.lastRunAt).toBeNull();

      const all = mod.listCronSchedules();
      expect(all).toHaveLength(1);
      expect(all[0].workflowId).toBe('wf-1');
    });

    it('unregisters a cron schedule', () => {
      mod.registerCron('wf-1', '*/15 * * * *');
      expect(mod.listCronSchedules()).toHaveLength(1);

      const removed = mod.unregisterCron('wf-1');
      expect(removed).toBe(true);
      expect(mod.listCronSchedules()).toHaveLength(0);
    });

    it('returns false when unregistering unknown workflow', () => {
      expect(mod.unregisterCron('nonexistent')).toBe(false);
    });

    it('replaces existing schedule for same workflow', () => {
      mod.registerCron('wf-1', '*/15 * * * *');
      mod.registerCron('wf-1', '*/30 * * * *');

      const all = mod.listCronSchedules();
      expect(all).toHaveLength(1);
      expect(all[0].cronExpression).toBe('*/30 * * * *');
    });

    it('supports multiple workflows', () => {
      mod.registerCron('wf-1', '*/5 * * * *');
      mod.registerCron('wf-2', '*/10 * * * *');
      mod.registerCron('wf-3', '0 * * * *');

      expect(mod.listCronSchedules()).toHaveLength(3);

      mod.unregisterCron('wf-2');
      expect(mod.listCronSchedules()).toHaveLength(2);
      expect(mod.listCronSchedules().map(s => s.workflowId)).toEqual(
        expect.arrayContaining(['wf-1', 'wf-3'])
      );
    });

    it('stopScheduler clears all schedules', () => {
      mod.registerCron('wf-1', '*/5 * * * *');
      mod.registerCron('wf-2', '*/10 * * * *');

      mod.stopScheduler();
      expect(mod.listCronSchedules()).toHaveLength(0);
    });
  });
});
