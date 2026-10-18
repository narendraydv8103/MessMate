import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as decisionsHistoryGet } from '@/app/api/decisions/history/route';
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import * as dbModule from '@/lib/db';

describe('GET /api/decisions/history Endpoint Tests', () => {
  const memberId = 'm1';
  const groupId = 'group-100';

  const validToken = signSession({
    memberId,
    groupId,
    memberName: 'Sujeet Yadav',
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Auth: rejects unauthenticated requests with 401', async () => {
    const req = new Request('http://localhost:3000/api/decisions/history', {
      method: 'GET',
    });
    const res = await decisionsHistoryGet(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('2. Ordering by seq & Final Marker & Member Metadata', async () => {
    const querySpy = vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
      rows: [
        {
          seq: 1,
          id: 'dec-1',
          meal_date: '2026-10-18',
          meal_period: 'DINNER',
          decision: 'JAAYENGE',
          submitted_by_member_id: 'm1',
          submitted_by_name: 'Sujeet Yadav',
          created_at: new Date('2026-10-18T15:40:00.000Z'), // 9:10 PM IST
          current_member_name: 'Sujeet',
          avatar_color: '#3b82f6',
          photo_mime: 'image/jpeg',
          photo_updated_at: new Date('2026-10-18T10:00:00.000Z'),
          is_final: false,
        },
        {
          seq: 2,
          id: 'dec-2',
          meal_date: '2026-10-18',
          meal_period: 'DINNER',
          decision: 'NAHI_JAAYENGE',
          submitted_by_member_id: 'm2',
          submitted_by_name: 'Devansh Tiwari',
          created_at: new Date('2026-10-18T15:42:00.000Z'), // 9:12 PM IST
          current_member_name: 'Devansh',
          avatar_color: '#ec4899',
          photo_mime: null,
          photo_updated_at: null,
          is_final: true,
        },
      ],
      command: 'SELECT',
      rowCount: 2,
      oid: 0,
      fields: [],
    });

    const req = new Request('http://localhost:3000/api/decisions/history', {
      method: 'GET',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
      },
    });

    const res = await decisionsHistoryGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    const rows = body.history || body.decisions;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(2);

    // Verify ordering by seq ASC
    expect(rows[0].seq).toBe(1);
    expect(rows[1].seq).toBe(2);
    expect(rows[0].seq).toBeLessThan(rows[1].seq);

    // Verify first decision is NOT final
    expect(rows[0].isFinal).toBe(false);
    expect(rows[0].decision).toBe('JAAYENGE');
    expect(rows[0].memberId).toBe('m1');
    expect(rows[0].memberName).toBe('Sujeet');
    expect(rows[0].hasPhoto).toBe(true);
    expect(rows[0].photoVersion).toBeDefined();

    // Verify second decision IS final
    expect(rows[1].isFinal).toBe(true);
    expect(rows[1].decision).toBe('NAHI_JAAYENGE');
    expect(rows[1].memberId).toBe('m2');
    expect(rows[1].memberName).toBe('Devansh');
    expect(rows[1].hasPhoto).toBe(false);

    // Verify query was scoped to session.groupId
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('WHERE d.group_id = $1'),
      expect.arrayContaining([groupId])
    );
  });

  it('3. Security: No secrets leaked in response', async () => {
    vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
      rows: [
        {
          seq: 10,
          id: 'dec-10',
          meal_date: '2026-10-18',
          meal_period: 'DINNER',
          decision: 'JAAYENGE',
          submitted_by_member_id: 'm1',
          submitted_by_name: 'Sujeet',
          created_at: new Date(),
          current_member_name: 'Sujeet',
          avatar_color: '#3b82f6',
          photo_mime: null,
          photo_updated_at: null,
          is_final: true,
        },
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const req = new Request('http://localhost:3000/api/decisions/history', {
      method: 'GET',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
      },
    });

    const res = await decisionsHistoryGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    const rows = body.history || body.decisions;
    const row = rows[0];

    // Verify no secret fields exist
    expect(row).not.toHaveProperty('passcode');
    expect(row).not.toHaveProperty('passcode_hash');
    expect(row).not.toHaveProperty('password');
    expect(row).not.toHaveProperty('photo_data'); // Never expose binary photo data in json
  });
});
