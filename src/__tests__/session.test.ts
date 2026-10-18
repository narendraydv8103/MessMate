import { describe, it, expect } from 'vitest';
import {
  signSession,
  verifySession,
  createSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';

describe('Auth Session Layer', () => {
  const sampleMember = {
    memberId: '11111111-1111-1111-1111-111111111111',
    memberName: 'Aarav',
    groupId: '22222222-2222-2222-2222-222222222222',
  };

  it('should sign and successfully verify a valid session token', () => {
    const token = signSession(sampleMember);
    expect(typeof token).toBe('string');
    expect(token).toContain('.');

    const verified = verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified?.memberId).toBe(sampleMember.memberId);
    expect(verified?.memberName).toBe(sampleMember.memberName);
    expect(verified?.groupId).toBe(sampleMember.groupId);
    expect(verified?.issuedAt).toBeDefined();
  });

  it('should reject tampered session tokens', () => {
    const token = signSession(sampleMember);
    const [payload, sig] = token.split('.');

    // Tamper with payload (change name)
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    decoded.memberName = 'Hacker';
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${sig}`;

    const verified = verifySession(tamperedToken);
    expect(verified).toBeNull();
  });

  it('should reject invalid or malformed tokens', () => {
    expect(verifySession('')).toBeNull();
    expect(verifySession('invalid-token')).toBeNull();
    expect(verifySession('a.b.c')).toBeNull();
  });

  it('should extract session from Request cookie header', () => {
    const token = signSession(sampleMember);
    const request = new Request('http://localhost:3000/api/auth/me', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}; other_cookie=123`,
      },
    });

    const session = getSessionFromRequest(request);
    expect(session).not.toBeNull();
    expect(session?.memberId).toBe(sampleMember.memberId);
  });

  it('should return null if session cookie is missing', () => {
    const request = new Request('http://localhost:3000/api/auth/me', {
      headers: {
        cookie: 'other_cookie=123',
      },
    });

    const session = getSessionFromRequest(request);
    expect(session).toBeNull();
  });

  it('should create proper Set-Cookie and Clear-Cookie headers', () => {
    const cookieHeader = createSessionCookie('test_token');
    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=test_token`);
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Path=/');
    expect(cookieHeader).toContain('SameSite=Lax');

    const clearHeader = clearSessionCookie();
    expect(clearHeader).toContain('Max-Age=0');
    expect(clearHeader).toContain('HttpOnly');
  });
});
