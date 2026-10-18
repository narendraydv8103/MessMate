import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { signSession, createSessionCookie } from '@/lib/auth/session';
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  getClientIp,
} from '@/lib/auth/rate-limiter';

export async function POST(request: Request) {
  const ip = getClientIp(request);

  // 1. Enforce rate limiting
  const rateLimitStatus = await checkRateLimit(ip);
  if (!rateLimitStatus.allowed) {
    return NextResponse.json(
      {
        error: `Too many failed login attempts. Please try again in ${rateLimitStatus.retryAfterSeconds} seconds.`,
        retryAfterSeconds: rateLimitStatus.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitStatus.retryAfterSeconds || 60),
        },
      }
    );
  }

  try {
    const body = await request.json();
    const { memberId, memberName, passcode } = body;

    const identifier = memberId || memberName;
    if (!identifier || typeof identifier !== 'string' || !passcode || typeof passcode !== 'string') {
      return NextResponse.json(
        { error: 'Both roommate selection and passcode are required.' },
        { status: 400 }
      );
    }

    // 2. Fetch member and associated group by ID or Name
    const memberResult = await query<{
      id: string;
      name: string;
      group_id: string;
      passcode_hash: string;
    }>(
      `SELECT m.id, m.name, m.group_id, g.passcode_hash 
       FROM members m
       JOIN groups g ON m.group_id = g.id
       WHERE m.id::text = $1 OR m.name = $1
       LIMIT 1`,
      [identifier]
    );

    if (memberResult.rows.length === 0) {
      const rate = await recordFailedAttempt(ip);
      return NextResponse.json(
        {
          error: 'Roommate record not found.',
          remainingAttempts: rate.remainingAttempts,
        },
        { status: 404 }
      );
    }

    const member = memberResult.rows[0];

    // 3. Verify hashed passcode
    const isPasscodeValid = await bcrypt.compare(passcode, member.passcode_hash);
    if (!isPasscodeValid) {
      const rate = await recordFailedAttempt(ip);
      return NextResponse.json(
        {
          error: 'Incorrect passcode.',
          remainingAttempts: rate.remainingAttempts,
          retryAfterSeconds: rate.retryAfterSeconds,
        },
        { status: 401 }
      );
    }

    // 4. Successful login: Reset rate limit & create signed session
    await resetRateLimit(ip);

    const token = signSession({
      memberId: member.id,
      memberName: member.name,
      groupId: member.group_id,
    });

    const cookieHeader = createSessionCookie(token);

    const response = NextResponse.json({
      success: true,
      member: {
        id: member.id,
        name: member.name,
        groupId: member.group_id,
      },
    });

    response.headers.set('Set-Cookie', cookieHeader);
    return response;
  } catch (error) {
    console.error('Error during login:', error);
    if (error instanceof Error && error.message.includes('SESSION_SECRET')) {
      return NextResponse.json(
        { error: 'Server configuration error: SESSION_SECRET is missing or under 32 characters in Vercel Environment Variables.' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: 'An unexpected error occurred during login.' },
      { status: 500 }
    );
  }
}
