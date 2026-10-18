import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { runSchedulerTick } from '@/lib/scheduler';
import { getCronSecret } from '@/lib/env';

function isAuthorizedCronRequest(request: Request): boolean {
  try {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return false;
    }

    const providedToken = authHeader.slice(7);
    const expectedSecret = getCronSecret();

    const providedBuf = Buffer.from(providedToken);
    const expectedBuf = Buffer.from(expectedSecret);

    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing CRON_SECRET.' },
      { status: 401 }
    );
  }

  try {
    const summary = await runSchedulerTick();
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error executing scheduler tick:', error);
    return NextResponse.json(
      { error: 'Scheduler tick failed.' },
      { status: 500 }
    );
  }
}
