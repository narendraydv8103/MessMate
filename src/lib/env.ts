/**
 * Environment variable validation and startup checks.
 */

export function validateStartupEnv(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    errors.push('SESSION_SECRET is required.');
  } else if (sessionSecret.length < 32) {
    errors.push(`SESSION_SECRET must be at least 32 characters long (currently ${sessionSecret.length}).`);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    errors.push('CRON_SECRET is required.');
  } else if (cronSecret.length < 32) {
    errors.push(`CRON_SECRET must be at least 32 characters long (currently ${cronSecret.length}).`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'test') {
      return 'test_session_secret_at_least_32_characters_long_for_vitest';
    }
    throw new Error('SESSION_SECRET must be set and at least 32 characters long.');
  }
  return secret;
}

export function getCronSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'test') {
      return 'test_cron_secret_at_least_32_characters_long_for_vitest';
    }
    throw new Error('CRON_SECRET must be set and at least 32 characters long.');
  }
  return secret;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export function getVapidPrivateKey(): string | null {
  return process.env.VAPID_PRIVATE_KEY || null;
}

export function getVapidSubject(): string {
  return process.env.VAPID_SUBJECT || 'mailto:messmate@localhost';
}

export function isVapidConfigured(): boolean {
  const pub = getVapidPublicKey();
  const priv = getVapidPrivateKey();
  return Boolean(pub && priv && pub.trim().length > 0 && priv.trim().length > 0);
}

