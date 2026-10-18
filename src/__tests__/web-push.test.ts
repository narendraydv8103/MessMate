/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import webpush from 'web-push';
import { WebPushNotifier } from '@/lib/notify';
import * as db from '@/lib/db';
import * as env from '@/lib/env';
import { POST as subscribePost } from '@/app/api/push/subscribe/route';
import { POST as unsubscribePost } from '@/app/api/push/unsubscribe/route';
import { POST as testPushPost } from '@/app/api/push/test/route';
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
    generateVAPIDKeys: vi.fn(() => ({
      publicKey: 'mock_public_key',
      privateKey: 'mock_private_key',
    })),
  },
}));

describe('WebPushNotifier & Push API Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WebPushNotifier Unit Tests', () => {
    it('returns NOT_CONFIGURED when VAPID keys are missing', async () => {
      vi.spyOn(env, 'isVapidConfigured').mockReturnValue(false);

      const notifier = new WebPushNotifier();
      const result = await notifier.notify(
        { id: 'group-1', name: 'Test Group' },
        'DAILY_REMINDER'
      );

      expect(result.status).toBe('NOT_CONFIGURED');
      expect(result.detail).toContain('VAPID keys not configured');
    });

    it('skips members who disabled notifications for DAILY_REMINDER', async () => {
      vi.spyOn(env, 'isVapidConfigured').mockReturnValue(true);
      vi.spyOn(env, 'getVapidPublicKey').mockReturnValue('mock_pub');
      vi.spyOn(env, 'getVapidPrivateKey').mockReturnValue('mock_priv');
      vi.spyOn(env, 'getVapidSubject').mockReturnValue('mailto:test@example.com');

      // Mock DB: 2 members, member-2 disabled push
      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('FROM call_jobs')) {
          return { rows: [{ status: 'PENDING' }], rowCount: 1 } as unknown as any;
        }
        if (sql.includes('FROM members')) {
          return {
            rows: [
              { id: 'm1', name: 'Aarav', notification_preferences: { push_enabled: true } },
              { id: 'm2', name: 'Kabir', notification_preferences: { push_enabled: false } },
            ],
            rowCount: 2,
          } as unknown as any;
        }
        if (sql.includes('FROM push_subscriptions')) {
          // Only m1 subscription returned because m2 was filtered out
          return {
            rows: [
              { id: 'sub-1', member_id: 'm1', endpoint: 'https://fcm.googleapis.com/1', p256dh: 'k1', auth: 'a1' },
            ],
            rowCount: 1,
          } as unknown as any;
        }
        return { rows: [], rowCount: 0 } as unknown as any;
      });

      vi.mocked(webpush.sendNotification).mockResolvedValueOnce({} as any);

      const notifier = new WebPushNotifier();
      const result = await notifier.notify({ id: 'group-1', name: 'Test Group' }, 'DAILY_REMINDER');

      expect(result.status).toBe('SENT');
      expect(result.counts?.accepted).toBe(1);
      expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('does NOT skip members for URGENT_* when call_job is ACTION_REQUIRED', async () => {
      vi.spyOn(env, 'isVapidConfigured').mockReturnValue(true);
      vi.spyOn(env, 'getVapidPublicKey').mockReturnValue('mock_pub');
      vi.spyOn(env, 'getVapidPrivateKey').mockReturnValue('mock_priv');
      vi.spyOn(env, 'getVapidSubject').mockReturnValue('mailto:test@example.com');

      let queriedMemberIds: string[] = [];

      vi.spyOn(db, 'query').mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes('FROM call_jobs')) {
          return { rows: [{ status: 'ACTION_REQUIRED' }], rowCount: 1 } as unknown as any;
        }
        if (sql.includes('FROM members')) {
          return {
            rows: [
              { id: 'm1', name: 'Aarav', notification_preferences: { push_enabled: true } },
              { id: 'm2', name: 'Kabir', notification_preferences: { push_enabled: false } }, // push_enabled is false!
            ],
            rowCount: 2,
          } as unknown as any;
        }
        if (sql.includes('FROM push_subscriptions')) {
          queriedMemberIds = params?.[1] || [];
          return {
            rows: [
              { id: 'sub-1', member_id: 'm1', endpoint: 'https://fcm.googleapis.com/1', p256dh: 'k1', auth: 'a1' },
              { id: 'sub-2', member_id: 'm2', endpoint: 'https://fcm.googleapis.com/2', p256dh: 'k2', auth: 'a2' },
            ],
            rowCount: 2,
          } as unknown as any;
        }
        return { rows: [], rowCount: 0 } as unknown as any;
      });

      vi.mocked(webpush.sendNotification).mockResolvedValue({} as any);

      const notifier = new WebPushNotifier();
      const result = await notifier.notify({ id: 'group-1', name: 'Test Group' }, 'URGENT_INITIAL');

      expect(result.status).toBe('SENT');
      // Both m1 and m2 were included despite m2 disabling notifications!
      expect(queriedMemberIds).toContain('m1');
      expect(queriedMemberIds).toContain('m2');
      expect(result.counts?.accepted).toBe(2);
    });

    it('handles partial failure and aggregate SENT only if at least one succeeds', async () => {
      vi.spyOn(env, 'isVapidConfigured').mockReturnValue(true);
      vi.spyOn(env, 'getVapidPublicKey').mockReturnValue('mock_pub');
      vi.spyOn(env, 'getVapidPrivateKey').mockReturnValue('mock_priv');
      vi.spyOn(env, 'getVapidSubject').mockReturnValue('mailto:test@example.com');

      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('FROM call_jobs')) {
          return { rows: [{ status: 'PENDING' }], rowCount: 1 } as unknown as any;
        }
        if (sql.includes('FROM members')) {
          return {
            rows: [{ id: 'm1', name: 'Aarav', notification_preferences: {} }],
            rowCount: 1,
          } as unknown as any;
        }
        if (sql.includes('FROM push_subscriptions')) {
          return {
            rows: [
              { id: 'sub-1', member_id: 'm1', endpoint: 'https://push1', p256dh: 'k1', auth: 'a1' },
              { id: 'sub-2', member_id: 'm1', endpoint: 'https://push2', p256dh: 'k2', auth: 'a2' },
            ],
            rowCount: 2,
          } as unknown as any;
        }
        return { rows: [], rowCount: 0 } as unknown as any;
      });

      // push1 succeeds, push2 fails with 500
      vi.mocked(webpush.sendNotification)
        .mockResolvedValueOnce({} as any)
        .mockRejectedValueOnce({ statusCode: 500, message: 'Internal Server Error' });

      const notifier = new WebPushNotifier();
      const result = await notifier.notify({ id: 'group-1', name: 'Test Group' }, 'DAILY_REMINDER');

      expect(result.status).toBe('SENT');
      expect(result.counts?.accepted).toBe(1);
      expect(result.counts?.failed).toBe(1);
    });

    it('deletes dead subscription on HTTP 410 Gone / 404 Not Found', async () => {
      vi.spyOn(env, 'isVapidConfigured').mockReturnValue(true);
      vi.spyOn(env, 'getVapidPublicKey').mockReturnValue('mock_pub');
      vi.spyOn(env, 'getVapidPrivateKey').mockReturnValue('mock_priv');
      vi.spyOn(env, 'getVapidSubject').mockReturnValue('mailto:test@example.com');

      let deletedEndpoint = '';

      vi.spyOn(db, 'query').mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes('FROM call_jobs')) {
          return { rows: [{ status: 'PENDING' }], rowCount: 1 } as unknown as any;
        }
        if (sql.includes('FROM members')) {
          return {
            rows: [{ id: 'm1', name: 'Aarav', notification_preferences: {} }],
            rowCount: 1,
          } as unknown as any;
        }
        if (sql.includes('DELETE FROM push_subscriptions')) {
          deletedEndpoint = params?.[0];
          return { rows: [], rowCount: 1 } as unknown as any;
        }
        if (sql.includes('FROM push_subscriptions')) {
          return {
            rows: [{ id: 'sub-1', member_id: 'm1', endpoint: 'https://expired-push', p256dh: 'k1', auth: 'a1' }],
            rowCount: 1,
          } as unknown as any;
        }
        return { rows: [], rowCount: 0 } as unknown as any;
      });

      // 410 Gone error
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410, message: 'Gone' });

      const notifier = new WebPushNotifier();
      const result = await notifier.notify({ id: 'group-1', name: 'Test Group' }, 'DAILY_REMINDER');

      expect(result.status).toBe('FAILED');
      expect(result.counts?.removed).toBe(1);
      expect(deletedEndpoint).toBe('https://expired-push');
    });
  });

  describe('Push API Endpoints', () => {
    const validToken = signSession({
      memberId: 'm1',
      groupId: 'g1',
      memberName: 'Aarav',
    });

    it('/api/push/subscribe requires auth with 401', async () => {
      const req = new Request('http://localhost:3000/api/push/subscribe', { method: 'POST' });
      const res = await subscribePost(req);
      expect(res.status).toBe(401);
    });

    it('/api/push/subscribe validates subscription payload with 400', async () => {
      const req = new Request('http://localhost:3000/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: JSON.stringify({ subscription: { endpoint: 'not-http' } }),
      });
      const res = await subscribePost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('endpoint');
    });

    it('/api/push/subscribe upserts valid subscription', async () => {
      let inserted = false;
      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO push_subscriptions')) {
          inserted = true;
          return { rows: [{ id: 'sub-new' }], rowCount: 1 } as unknown as any;
        }
        return { rows: [], rowCount: 0 } as unknown as any;
      });

      const req = new Request('http://localhost:3000/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: JSON.stringify({
          subscription: {
            endpoint: 'https://fcm.googleapis.com/valid',
            keys: { p256dh: 'sample_p256dh', auth: 'sample_auth' },
          },
        }),
      });

      const res = await subscribePost(req);
      expect(res.status).toBe(200);
      expect(inserted).toBe(true);
    });

    it('/api/push/unsubscribe deletes subscription by endpoint', async () => {
      let deleted = false;
      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('DELETE FROM push_subscriptions')) {
          deleted = true;
          return { rows: [], rowCount: 1 } as unknown as any;
        }
        return { rows: [], rowCount: 0 } as unknown as any;
      });

      const req = new Request('http://localhost:3000/api/push/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/remove' }),
      });

      const res = await unsubscribePost(req);
      expect(res.status).toBe(200);
      expect(deleted).toBe(true);
    });

    it('/api/push/test enforces 1 per minute rate limit via database', async () => {
      vi.spyOn(env, 'isVapidConfigured').mockReturnValue(true);
      vi.spyOn(env, 'getVapidPublicKey').mockReturnValue('mock_pub');
      vi.spyOn(env, 'getVapidPrivateKey').mockReturnValue('mock_priv');

      let lastTestPushAt: Date | null = null;

      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT last_test_push_at FROM members')) {
          return {
            rows: [{ last_test_push_at: lastTestPushAt }],
            rowCount: 1,
          } as unknown as any;
        }
        if (sql.includes('UPDATE members SET last_test_push_at = NOW()')) {
          lastTestPushAt = new Date();
          return { rows: [], rowCount: 1 } as unknown as any;
        }
        if (sql.includes('FROM push_subscriptions')) {
          return {
            rows: [{ id: 'sub-1', endpoint: 'https://push1', p256dh: 'k1', auth: 'a1' }],
            rowCount: 1,
          } as unknown as any;
        }
        return { rows: [], rowCount: 0 } as unknown as any;
      });

      vi.mocked(webpush.sendNotification).mockResolvedValue({} as any);

      // Unique member session to avoid interference with other tests
      const testMemberToken = signSession({
        memberId: 'm-ratelimit-test',
        groupId: 'g1',
        memberName: 'Aarav',
      });

      // First call succeeds
      const req1 = new Request('http://localhost:3000/api/push/test', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${testMemberToken}` },
      });
      const res1 = await testPushPost(req1);
      expect(res1.status).toBe(200);
      expect(lastTestPushAt).not.toBeNull();

      // Verify payload contains strictly title, body, tag
      const testPayload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0][1] as string);
      expect(testPayload).toEqual({
        title: 'MessMate Test Alert',
        body: 'Badiya! Web push is working correctly on this device.',
        tag: 'messmate-test',
      });
      expect(testPayload.url).toBeUndefined();
      expect(testPayload.urgent).toBeUndefined();

      // Second immediate call must be rate limited with 429
      const req2 = new Request('http://localhost:3000/api/push/test', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE_NAME}=${testMemberToken}` },
      });
      const res2 = await testPushPost(req2);
      expect(res2.status).toBe(429);
      const data2 = await res2.json();
      expect(data2.error).toContain('wait');
      expect(data2.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('/api/health returns { ok: true } without authentication', async () => {
      const { GET: healthGet } = await import('@/app/api/health/route');
      const res = await healthGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });
});
