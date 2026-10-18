import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { getCurrentMealStatus } from '@/lib/decisions';

export async function GET(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getCurrentMealStatus(session.groupId);
    return NextResponse.json(status);
  } catch (error) {
    console.error('Error in /api/status:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve meal status.' },
      { status: 500 }
    );
  }
}
