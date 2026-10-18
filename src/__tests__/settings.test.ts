import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as settingsGet, POST as settingsPost } from '@/app/api/settings/route';
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import * as dbModule from '@/lib/db';

describe('/api/settings Unit & Validation Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
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
      body: JSON.stringify({ messPhone: '+919876543210' }),
    });
    const res = await settingsPost(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('POST /api/settings rejects invalid mess phone formats with 400', async () => {
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
        body: JSON.stringify({ messPhone: invalidPhone }),
      });
      const res = await settingsPost(req);
      expect(res.status, `Expected 400 for ${invalidPhone}`).toBe(400);

      const body = await res.json();
      expect(body.error).toContain('Invalid mess phone number');
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

  it('POST /api/settings rejects mess name longer than 40 chars or empty with 400', async () => {
    const token = signSession({
      memberId: 'm1',
      groupId: 'g1',
      memberName: 'Sujeet Yadav',
    });

    // Too long (41 chars)
    const longMessName = 'M'.repeat(41);
    const reqLong = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({ messName: longMessName }),
    });
    const resLong = await settingsPost(reqLong);
    expect(resLong.status).toBe(400);
    const bodyLong = await resLong.json();
    expect(bodyLong.error).toContain('Mess name must be between 1 and 40 characters');

    // Empty
    const reqEmpty = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({ messName: '   ' }),
    });
    const resEmpty = await settingsPost(reqEmpty);
    expect(resEmpty.status).toBe(400);
  });

  it('POST /api/settings accepts nickname of exactly 20 characters (Mahendra Singh Yadav)', async () => {
    const name20Chars = 'Mahendra Singh Yadav';
    expect(name20Chars.length).toBe(20);

    const token = signSession({
      memberId: 'm1',
      groupId: 'g1',
      memberName: 'Sujeet Yadav',
    });

    const req = new Request('http://localhost:3000/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        members: [{ id: 'm1', name: name20Chars }],
      }),
    });
    const res = await settingsPost(req);
    // Since mock db is not connected, it will either throw 500 or proceed past validation; but it MUST NOT return 400 validation error
    expect(res.status).not.toBe(400);
  });

  describe('Self-Only Nickname Editing & Integrity (403)', () => {
    it('returns 403 when member A tries to change member B nickname and changes nothing', async () => {
      const tokenA = signSession({
        memberId: 'm1',
        groupId: 'g1',
        memberName: 'Sujeet Yadav',
      });

      // Mock database returning current group members
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          { id: 'm1', name: 'Sujeet Yadav', notification_preferences: {} },
          { id: 'm2', name: 'Mahendra Singh Yadav', notification_preferences: {} },
        ],
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      const withTransactionSpy = vi.spyOn(dbModule, 'withTransaction');

      const req = new Request('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
        },
        body: JSON.stringify({
          messName: 'New Mess Name',
          members: [
            { id: 'm1', name: 'Sujeet' },
            { id: 'm2', name: 'HackedNickname' }, // Attempting to change m2!
          ],
        }),
      });

      const res = await settingsPost(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Forbidden: you can only change your own nickname.');

      // Verify transaction was never invoked -> nothing changed in database!
      expect(withTransactionSpy).not.toHaveBeenCalled();
    });

    it('succeeds when member A changes only their own nickname', async () => {
      const tokenA = signSession({
        memberId: 'm1',
        groupId: 'g1',
        memberName: 'Sujeet Yadav',
      });

      // Mock database returning current group members
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          { id: 'm1', name: 'Sujeet Yadav', notification_preferences: {} },
          { id: 'm2', name: 'Mahendra Singh Yadav', notification_preferences: {} },
        ],
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      const mockClient = {
        query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
      };

      vi.spyOn(dbModule, 'withTransaction').mockImplementation(async (callback) => {
        return callback(mockClient as unknown as Parameters<typeof callback>[0]);
      });

      const req = new Request('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
        },
        body: JSON.stringify({
          members: [
            { id: 'm1', name: 'Sujeet Boss' },
            { id: 'm2', name: 'Mahendra Singh Yadav' }, // Unchanged for m2
          ],
        }),
      });

      const res = await settingsPost(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify only m1 was updated
      expect(mockClient.query).toHaveBeenCalledWith(
        'UPDATE members SET name = $1 WHERE id = $2 AND group_id = $3',
        ['Sujeet Boss', 'm1', 'g1']
      );
    });

    it('rejects duplicate nickname matching another roommate in group with 400', async () => {
      const tokenA = signSession({
        memberId: 'm1',
        groupId: 'g1',
        memberName: 'Sujeet Yadav',
      });

      // Mock database returning current group members
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          { id: 'm1', name: 'Sujeet Yadav', notification_preferences: {} },
          { id: 'm2', name: 'Mahendra Singh Yadav', notification_preferences: {} },
        ],
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      const withTransactionSpy = vi.spyOn(dbModule, 'withTransaction');

      const req = new Request('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
        },
        body: JSON.stringify({
          members: [
            { id: 'm1', name: 'mahendra singh yadav' }, // Matches m2 case-insensitively!
          ],
        }),
      });

      const res = await settingsPost(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('unique');
      expect(withTransactionSpy).not.toHaveBeenCalled();
    });
  });
});
