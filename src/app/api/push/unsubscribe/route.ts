import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db';

export async function POST(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { endpoint } = body;

    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json(
        { error: 'Endpoint is required for unsubscription.' },
        { status: 400 }
      );
    }

    const deleteResult = await query(
      `DELETE FROM push_subscriptions 
       WHERE endpoint = $1 AND (member_id = $2 OR group_id = $3)`,
      [endpoint.trim(), session.memberId, session.groupId]
    );

    return NextResponse.json({
      success: true,
      message: 'Push subscription removed successfully.',
      deleted: deleteResult.rowCount || 0,
    });
  } catch (error) {
    console.error('Error removing push subscription:', error);
    return NextResponse.json(
      { error: 'Failed to remove push subscription.' },
      { status: 500 }
    );
  }
}
