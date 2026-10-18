import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dbModule from '@/lib/db';
import {
  getClientIp,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
} from '@/lib/auth/rate-limiter';

describe('Login Rate Limiter & Safe IP Extraction', () => {
  describe('getClientIp', () => {
    it('prefers x-vercel-forwarded-for over other headers', () => {
      const req = new Request('http://localhost:3000/api/auth/login', {
        headers: {
          'x-vercel-forwarded-for': '203.0.113.195',
          'x-real-ip': '70.41.3.18',
          'x-forwarded-for': '150.172.238.178',
        },
      });
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('prefers x-real-ip if x-vercel-forwarded-for is missing', () => {
      const req = new Request('http://localhost:3000/api/auth/login', {
        headers: {
          'x-real-ip': '70.41.3.18',
          'x-forwarded-for': '150.172.238.178',
        },
      });
      expect(getClientIp(req)).toBe('70.41.3.18');
    });

    it('does NOT trust leftmost x-forwarded-for; takes rightmost valid IP', () => {
      const req = new Request('http://localhost:3000/api/auth/login', {
        headers: {
          'x-forwarded-for': 'untrusted-spoofed-ip, 198.51.100.4, 203.0.113.50',
        },
      });
      expect(getClientIp(req)).toBe('203.0.113.50');
    });

    it('strips invalid/malicious characters from IP header candidate', () => {
      const req = new Request('http://localhost:3000/api/auth/login', {
        headers: {
          'x-real-ip': '192.168.1.1; DROP TABLE users;--',
        },
      });
      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('falls back to "unknown" bucket when no valid IP header is provided', () => {
      const req = new Request('http://localhost:3000/api/auth/login');
      expect(getClientIp(req)).toBe('unknown');
    });
  });

  describe('DB-backed Rate Limiter Operations', () => {
    const testIp = '192.0.2.1';

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should return allowed with 5 attempts when no record exists in DB', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      const status = await checkRateLimit(testIp);
      expect(status.allowed).toBe(true);
      expect(status.remainingAttempts).toBe(5);
    });

    it('should decrement remaining attempts on failed login', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [{ failed_attempts: 1, locked_until: null }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const attempt = await recordFailedAttempt(testIp);
      expect(attempt.allowed).toBe(true);
      expect(attempt.remainingAttempts).toBe(4);
    });

    it('should trigger lockout after 5 failed attempts', async () => {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [{ failed_attempts: 5, locked_until: lockUntil }],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      });

      const attempt = await recordFailedAttempt(testIp);
      expect(attempt.allowed).toBe(false);
      expect(attempt.remainingAttempts).toBe(0);
      expect(attempt.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('should reset rate limits on resetRateLimit', async () => {
      const querySpy = vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: 'DELETE',
        oid: 0,
        fields: [],
      });

      await resetRateLimit(testIp);
      expect(querySpy).toHaveBeenCalledWith(
        'DELETE FROM login_rate_limits WHERE ip_address = $1',
        [testIp]
      );
    });
  });
});
