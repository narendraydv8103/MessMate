import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { getDecisionHistory } from '@/lib/decisions';

export async function GET(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

  try {
    const history = await getDecisionHistory(session.groupId, limit);
    return NextResponse.json({ history });
  } catch (error) {
    console.error('Error fetching decision history:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve decision history.' },
      { status: 500 }
    );
  }
}
