import { describe, it, expect } from 'vitest';
import { GET as settingsGet, POST as settingsPost } from '@/app/api/settings/route';
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

describe('/api/settings Unit & Validation Tests', () => {
  it('GET /api/settings rejects without session cookie with 401', async () => {
    const req = new Request('http://localhost:3000/api/settings', {
      method: 'GET',
    });
    const res = await settingsGet(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('POST /api/settings rejects without session cookie with 401', async () => {
    const req = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auntyPhone: '+919876543210' }),
    });
    const res = await settingsPost(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('POST /api/settings rejects invalid Aunty phone formats with 400', async () => {
    const token = signSession({
      memberId: 'm1',
      groupId: 'g1',
      memberName: 'Aarav',
    });

    const invalidNumbers = [
      '9876543210', // Missing +91
      '+910123456789', // Starts with 0 (not 6-9)
      '+915123456789', // Starts with 5 (not 6-9)
      '+91987654321', // 9 digits only
      '+9198765432100', // 11 digits
      '+14155552671', // US number
      'invalid-string',
      '',
    ];

    for (const invalidPhone of invalidNumbers) {
      const req = new Request('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
        body: JSON.stringify({ auntyPhone: invalidPhone }),
      });
      const res = await settingsPost(req);
      expect(res.status, `Expected 400 for ${invalidPhone}`).toBe(400);

      const body = await res.json();
      expect(body.error).toContain('Invalid Aunty phone number');
    }
  });

  it('POST /api/settings rejects invalid members payload with 400', async () => {
    const token = signSession({
      memberId: 'm1',
      groupId: 'g1',
      memberName: 'Aarav',
    });

    const req = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({ members: 'not-an-array' }),
    });
    const res = await settingsPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('members must be an array');
  });

  it('POST /api/settings rejects nicknames shorter than 1 or longer than 20 chars with 400', async () => {
    const token = signSession({
      memberId: 'm1',
      groupId: 'g1',
      memberName: 'Aarav',
    });

    // Too long (21 characters)
    const longName = 'A'.repeat(21);
    const reqLong = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        members: [{ id: 'm1', name: longName }],
      }),
    });
    const resLong = await settingsPost(reqLong);
    expect(resLong.status).toBe(400);
    const bodyLong = await resLong.json();
    expect(bodyLong.error).toContain('between 1 and 20 characters');

    // Empty / whitespace
    const reqEmpty = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        members: [{ id: 'm1', name: '   ' }],
      }),
    });
    const resEmpty = await settingsPost(reqEmpty);
    expect(resEmpty.status).toBe(400);
    const bodyEmpty = await resEmpty.json();
    expect(bodyEmpty.error).toContain('between 1 and 20 characters');
  });

  it('POST /api/settings rejects duplicate nicknames within the group with 400', async () => {
    const token = signSession({
      memberId: 'm1',
      groupId: 'g1',
      memberName: 'Aarav',
    });

    const req = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        members: [
          { id: 'm1', name: 'Kabir' },
          { id: 'm2', name: 'kabir' }, // duplicate case-insensitive
        ],
      }),
    });
    const res = await settingsPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('unique');
  });
});
