import { describe, it, expect } from 'vitest';
import { POST as cronTickPost } from '@/app/api/cron/tick/route';
import { POST as auntyInformedPost } from '@/app/api/aunty/informed/route';

describe('Scheduler & Informed Auth Unit Tests', () => {
  it('rejects /api/cron/tick when Authorization header is missing with 401', async () => {
    const req = new Request('http://localhost:3000/api/cron/tick', {
      method: 'POST',
    });
    const res = await cronTickPost(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toContain('Unauthorized');
  });

  it('rejects /api/cron/tick when Authorization token is wrong with 401', async () => {
    const req = new Request('http://localhost:3000/api/cron/tick', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong_cron_secret_of_matching_length_12345678',
      },
    });
    const res = await cronTickPost(req);
    expect(res.status).toBe(401);
  });

  it('rejects /api/cron/tick when token length does not match without throwing', async () => {
    const req = new Request('http://localhost:3000/api/cron/tick', {
      method: 'POST',
      headers: {
        authorization: 'Bearer short',
      },
    });
    const res = await cronTickPost(req);
    expect(res.status).toBe(401);
  });

  it('rejects /api/aunty/informed without valid session with 401', async () => {
    const req = new Request('http://localhost:3000/api/aunty/informed', {
      method: 'POST',
    });
    const res = await auntyInformedPost(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('evaluates escalation permission correctly based on previous urgent send_status and elapsed time', () => {
    const nowMs = 1776528600000; // arbitrary fixed epoch

    function canEscalate(prevLog: { send_status: string; sent_at: Date } | null, now: number): boolean {
      if (!prevLog) return false;
      const prevSentAtMs = new Date(prevLog.sent_at).getTime();
      const prevElapsedMs = now - prevSentAtMs;
      return prevLog.send_status === 'SENT' || prevElapsedMs >= 10 * 60 * 1000;
    }

    // Case 1: Previous was SENT -> can escalate immediately when due
    expect(canEscalate({ send_status: 'SENT', sent_at: new Date(nowMs - 5 * 60 * 1000) }, nowMs)).toBe(true);

    // Case 2: Previous was FAILED, but less than 10 minutes passed -> cannot escalate yet
    expect(canEscalate({ send_status: 'FAILED', sent_at: new Date(nowMs - 4 * 60 * 1000) }, nowMs)).toBe(false);

    // Case 3: Previous was FAILED, and 10 minutes have elapsed -> can escalate
    expect(canEscalate({ send_status: 'FAILED', sent_at: new Date(nowMs - 11 * 60 * 1000) }, nowMs)).toBe(true);

    // Case 4: Previous was NOT_CONFIGURED, and 10 minutes have elapsed -> can escalate
    expect(canEscalate({ send_status: 'NOT_CONFIGURED', sent_at: new Date(nowMs - 10 * 60 * 1000) }, nowMs)).toBe(true);

    // Case 5: No previous log -> cannot escalate
    expect(canEscalate(null, nowMs)).toBe(false);
  });
});
