import crypto from 'crypto';
import { AuthSession } from '@/types';

import { getSessionSecret } from '@/lib/env';

export const SESSION_COOKIE_NAME = 'messmate_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  return getSessionSecret();
}

interface StoredSessionPayload extends AuthSession {
  exp: number; // Expiration epoch in ms
}

/**
 * Creates a tamper-proof signed session token using HMAC-SHA256.
 */
export function signSession(session: Omit<AuthSession, 'issuedAt'>): string {
  const secret = getSecret();
  const now = Date.now();
  const payload: StoredSessionPayload = {
    ...session,
    issuedAt: now,
    exp: now + SESSION_MAX_AGE_SECONDS * 1000,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * Verifies a session token signature and expiration.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifySession(token: string): AuthSession | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, providedSig] = parts;
  const secret = getSecret();

  // Compute expected signature
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);

  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString('utf8')
    ) as StoredSessionPayload;

    // Check expiration
    if (Date.now() > payload.exp) {
      return null;
    }

    return {
      memberId: payload.memberId,
      memberName: payload.memberName,
      groupId: payload.groupId,
      issuedAt: payload.issuedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts and verifies the session from incoming Request headers (Cookie).
 */
export function getSessionFromRequest(request: Request): AuthSession | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  return verifySession(token);
}

/**
 * Convenience helper to enforce authentication in Next.js API route handlers.
 * Returns the valid AuthSession or null if unauthenticated.
 */
export function requireAuth(request: Request): AuthSession | null {
  return getSessionFromRequest(request);
}

/**
 * Helper to build Set-Cookie header for signing in.
 */
export function createSessionCookie(token: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (isProd) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Helper to build Set-Cookie header for signing out.
 */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function parseCookies(header: string): Record<string, string> {
  const list: Record<string, string> = {};
  header.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      list[name] = decodeURIComponent(value);
    }
  });
  return list;
}
