import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { submitDecision, DecisionError } from '@/lib/decisions';

export async function POST(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { decision, idempotencyKey, notes } = body;

    if (!decision || (decision !== 'JAAYENGE' && decision !== 'NAHI_JAAYENGE')) {
      return NextResponse.json(
        { error: 'decision is required and must be JAAYENGE or NAHI_JAAYENGE.' },
        { status: 400 }
      );
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return NextResponse.json(
        { error: 'idempotencyKey is required.' },
        { status: 400 }
      );
    }

    const result = await submitDecision({
      groupId: session.groupId,
      memberId: session.memberId,
      memberName: session.memberName,
      decision,
      idempotencyKey,
      notes,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DecisionError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error submitting decision:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred while saving the decision.' },
      { status: 500 }
    );
  }
}
