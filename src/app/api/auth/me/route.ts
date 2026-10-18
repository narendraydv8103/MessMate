import { NextResponse } from 'next/server';
import { requireAuth, clearSessionCookie } from '@/lib/auth/session';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Verify member still exists in the database
    const result = await query<{
      id: string;
      name: string;
      avatar_color: string;
      group_id: string;
      group_name: string;
      mess_name: string;
      mess_phone: string;
    }>(
      `SELECT m.id, m.name, m.avatar_color, g.id as group_id, g.name as group_name, g.mess_name, g.mess_phone
       FROM members m
       JOIN groups g ON m.group_id = g.id
       WHERE m.id = $1`,
      [session.memberId]
    );

    if (result.rows.length === 0) {
      // Member was removed or no longer exists: invalidate session immediately
      const response = NextResponse.json(
        { error: 'Member account no longer exists.' },
        { status: 401 }
      );
      response.headers.set('Set-Cookie', clearSessionCookie());
      return response;
    }

    const row = result.rows[0];

    return NextResponse.json({
      member: {
        id: row.id,
        name: row.name,
        avatarColor: row.avatar_color,
        groupId: row.group_id,
      },
      group: {
        id: row.group_id,
        name: row.group_name,
        messName: row.mess_name || 'Mishra Tiffin Centre',
        messPhone: row.mess_phone,
      },
    });
  } catch (error) {
    console.error('Error in /api/auth/me:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active session details.' },
      { status: 500 }
    );
  }
}
