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
    const { subscription, userAgent } = body;

    if (!subscription || typeof subscription !== 'object') {
      return NextResponse.json(
        { error: 'Invalid payload: subscription object is required.' },
        { status: 400 }
      );
    }

    const { endpoint, keys } = subscription;
    if (!endpoint || typeof endpoint !== 'string' || !endpoint.startsWith('http')) {
      return NextResponse.json(
        { error: 'Invalid subscription endpoint: must be a valid HTTP/HTTPS URL.' },
        { status: 400 }
      );
    }

    if (!keys || typeof keys !== 'object' || !keys.p256dh || !keys.auth) {
      return NextResponse.json(
        { error: 'Invalid subscription keys: p256dh and auth are required.' },
        { status: 400 }
      );
    }

    // Upsert subscription by endpoint
    await query(
      `INSERT INTO push_subscriptions (member_id, group_id, endpoint, p256dh, auth, user_agent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (endpoint)
       DO UPDATE SET
         member_id = EXCLUDED.member_id,
         group_id = EXCLUDED.group_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         updated_at = NOW()`,
      [
        session.memberId,
        session.groupId,
        endpoint.trim(),
        String(keys.p256dh).trim(),
        String(keys.auth).trim(),
        userAgent ? String(userAgent).substring(0, 255) : null,
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Push subscription registered successfully.',
    });
  } catch (error) {
    console.error('Error registering push subscription:', error);
    return NextResponse.json(
      { error: 'Failed to register push subscription.' },
      { status: 500 }
    );
  }
}
