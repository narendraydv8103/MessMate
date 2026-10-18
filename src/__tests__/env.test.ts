import { describe, it, expect } from 'vitest';
import { validateStartupEnv } from '@/lib/env';

describe('Startup Environment Validation', () => {
  it('detects missing or short SESSION_SECRET and CRON_SECRET (< 32 chars)', () => {
    const originalSession = process.env.SESSION_SECRET;
    const originalCron = process.env.CRON_SECRET;

    try {
      process.env.SESSION_SECRET = 'short';
      process.env.CRON_SECRET = 'short';

      const validation = validateStartupEnv();
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBe(2);
      expect(validation.errors[0]).toContain('SESSION_SECRET must be at least 32 characters long');
      expect(validation.errors[1]).toContain('CRON_SECRET must be at least 32 characters long');
    } finally {
      process.env.SESSION_SECRET = originalSession;
      process.env.CRON_SECRET = originalCron;
    }
  });

  it('passes validation when both secrets are >= 32 characters', () => {
    const originalSession = process.env.SESSION_SECRET;
    const originalCron = process.env.CRON_SECRET;

    try {
      process.env.SESSION_SECRET = '12345678901234567890123456789012';
      process.env.CRON_SECRET = '12345678901234567890123456789012';

      const validation = validateStartupEnv();
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    } finally {
      process.env.SESSION_SECRET = originalSession;
      process.env.CRON_SECRET = originalCron;
    }
  });
});
