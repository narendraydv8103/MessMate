import { query } from '@/lib/db';

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

/**
 * Extracts a valid IPv4 or IPv6 string from a candidate header value.
 */
function extractValidIp(candidate: string): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();

  // Match standard IPv4 (e.g. 192.168.1.1)
  const ipv4Match = trimmed.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (ipv4Match) {
    return ipv4Match[0];
  }

  // Match IPv6 (e.g. 2001:db8::1 or ::1)
  const ipv6Match = trimmed.match(/\b(?:[0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}\b|\b::1\b/);
  if (ipv6Match) {
    return ipv6Match[0];
  }

  return null;
}

/**
 * Safely extracts client IP address.
 *
 * Security rules:
 * - Prefers `x-vercel-forwarded-for` (trusted Vercel edge IP).
 * - Next prefers `x-real-ip` (trusted reverse proxy IP).
 * - Does NOT trust the leftmost `x-forwarded-for` (which clients can prepend).
 *   Instead scans right-to-left for the closest proxy entry.
 * - If no valid IP is found, falls back to a shared "unknown" bucket.
 */
export function getClientIp(request: Request): string {
  // 1. Prefer x-vercel-forwarded-for
  const vercelIp = request.headers.get('x-vercel-forwarded-for');
  if (vercelIp) {
    const match = extractValidIp(vercelIp);
    if (match) return match;
  }

  // 2. Next prefer x-real-ip
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    const match = extractValidIp(realIp);
    if (match) return match;
  }

  // 3. Fallback to x-forwarded-for: inspect right-to-left (do not trust leftmost)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const match = extractValidIp(parts[i]);
      if (match) return match;
    }
  }

  // 4. Default shared "unknown" bucket
  return 'unknown';
}

/**
 * Checks whether an IP is currently rate-limited using PostgreSQL login_rate_limits.
 */
export async function checkRateLimit(ip: string): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}> {
  try {
    const result = await query<{
      failed_attempts: number;
      first_failed_at: Date;
      locked_until: Date | null;
    }>(
      `SELECT failed_attempts, first_failed_at, locked_until 
       FROM login_rate_limits 
       WHERE ip_address = $1`,
      [ip]
    );

    if (result.rows.length === 0) {
      return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
    }

    const record = result.rows[0];
    const now = Date.now();

    // Check if currently locked
    if (record.locked_until) {
      const lockTime = new Date(record.locked_until).getTime();
      if (now < lockTime) {
        const retryAfterSeconds = Math.max(1, Math.ceil((lockTime - now) / 1000));
        return { allowed: false, remainingAttempts: 0, retryAfterSeconds };
      }
      // Lock has expired; clean up
      await resetRateLimit(ip);
      return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
    }

    // Check if 15-minute sliding window has expired
    const firstFailedTime = new Date(record.first_failed_at).getTime();
    if (now - firstFailedTime > WINDOW_MINUTES * 60 * 1000) {
      await resetRateLimit(ip);
      return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
    }

    const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.failed_attempts);
    return { allowed: remaining > 0, remainingAttempts: remaining };
  } catch (err) {
    console.error('Rate limit check DB error:', err);
    // Allow request if DB is temporarily unreachable to avoid total lockout
    return { allowed: true, remainingAttempts: 1 };
  }
}

/**
 * Records a failed login attempt for an IP in PostgreSQL.
 */
export async function recordFailedAttempt(ip: string): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}> {
  try {
    const result = await query<{
      failed_attempts: number;
      locked_until: Date | null;
    }>(
      `INSERT INTO login_rate_limits (ip_address, failed_attempts, first_failed_at, locked_until)
       VALUES ($1, 1, NOW(), NULL)
       ON CONFLICT (ip_address) DO UPDATE
       SET failed_attempts = CASE 
             WHEN login_rate_limits.first_failed_at < NOW() - INTERVAL '15 minutes' THEN 1
             ELSE login_rate_limits.failed_attempts + 1
           END,
           first_failed_at = CASE
             WHEN login_rate_limits.first_failed_at < NOW() - INTERVAL '15 minutes' THEN NOW()
             ELSE login_rate_limits.first_failed_at
           END,
           locked_until = CASE
             WHEN (login_rate_limits.first_failed_at >= NOW() - INTERVAL '15 minutes' AND login_rate_limits.failed_attempts + 1 >= $2)
             THEN NOW() + INTERVAL '15 minutes'
             ELSE NULL
           END
       RETURNING failed_attempts, locked_until`,
      [ip, MAX_FAILED_ATTEMPTS]
    );

    const row = result.rows[0];
    if (row.locked_until) {
      const lockTime = new Date(row.locked_until).getTime();
      const retryAfterSeconds = Math.max(1, Math.ceil((lockTime - Date.now()) / 1000));
      return { allowed: false, remainingAttempts: 0, retryAfterSeconds };
    }

    const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - row.failed_attempts);
    return { allowed: remaining > 0, remainingAttempts: remaining };
  } catch (err) {
    console.error('Rate limit record DB error:', err);
    return { allowed: true, remainingAttempts: 0 };
  }
}

/**
 * Clears failed attempts for an IP upon successful login.
 */
export async function resetRateLimit(ip: string): Promise<void> {
  try {
    await query('DELETE FROM login_rate_limits WHERE ip_address = $1', [ip]);
  } catch (err) {
    console.error('Rate limit reset DB error:', err);
  }
}
