/**
 * Application build version utilities
 */

export function getAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
}

export function getShortAppVersion(version?: string): string {
  const v = version || getAppVersion();
  if (!v || v === 'dev') return 'dev';

  // If it is a git commit SHA (hex string of 7 or more chars), take the first 7 chars
  if (/^[0-9a-f]{7,}$/i.test(v)) {
    return v.slice(0, 7);
  }

  // If it's a long timestamp or custom string, show first 7 chars
  return v.length > 7 ? v.slice(0, 7) : v;
}
