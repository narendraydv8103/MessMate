import { describe, it, expect } from 'vitest';
import { POST as decisionsPost } from '@/app/api/decisions/route';
import { GET as statusGet } from '@/app/api/status/route';
import { GET as historyGet } from '@/app/api/decisions/history/route';
import { GET as meGet } from '@/app/api/auth/me/route';

describe('Route Authentication Enforcement', () => {
  it('should reject unauthenticated POST /api/decisions with 401', async () => {
    const req = new Request('http://localhost:3000/api/decisions', {
      method: 'POST',
      body: JSON.stringify({ decision: 'JAAYENGE', idempotencyKey: 'key-1' }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await decisionsPost(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('should reject unauthenticated GET /api/status with 401', async () => {
    const req = new Request('http://localhost:3000/api/status');
    const res = await statusGet(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('should reject unauthenticated GET /api/decisions/history with 401', async () => {
    const req = new Request('http://localhost:3000/api/decisions/history');
    const res = await historyGet(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('should reject unauthenticated GET /api/auth/me with 401', async () => {
    const req = new Request('http://localhost:3000/api/auth/me');
    const res = await meGet(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });
});
