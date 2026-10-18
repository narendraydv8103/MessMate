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

const BOT_USER_AGENTS = [
  'bot',
  'spider',
  'crawler',
  'whatsapp',
  'facebookexternalhit',
  'twitterbot',
  'telegrambot',
  'slackbot',
  'linkedinbot',
  'discordbot',
  'googlebot',
  'bingbot',
  'applebot',
];

function isLinkPreviewBot(request: Request): boolean {
  // Check standard preview headers
  const purpose = request.headers.get('purpose') || request.headers.get('x-purpose');
  if (purpose && purpose.toLowerCase().includes('preview')) {
    return true;
  }

  // Check user-agent
  const userAgent = (request.headers.get('user-agent') || '').toLowerCase();
  return BOT_USER_AGENTS.some((bot) => userAgent.includes(bot));
}

function createSecureRedirect(url: string, status = 303): NextResponse {
  const response = NextResponse.redirect(url, status);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

/**
 * Handles invite-link login with:
 * - Link-preview bot blocking (prevents bots from consuming passcodes/sessions)
 * - Cache-Control: no-store and Referrer-Policy: no-referrer
 * - DB-backed rate limiting
 * - Immediate redirect to '/' stripping the passcode from the URL
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  // 1. Block link-preview bots without consuming credentials or setting cookies
  if (isLinkPreviewBot(request)) {
    return new NextResponse(
      '<!DOCTYPE html><html><head><title>MessMate Invite</title><meta name="robots" content="noindex, nofollow"></head><body>MessMate Invite Link</body></html>',
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Referrer-Policy': 'no-referrer',
        },
      }
    );
  }

  const ip = getClientIp(request);
  const code = url.searchParams.get('code') || url.searchParams.get('invite');
  const memberId = url.searchParams.get('memberId');

  if (!code || !memberId) {
    return createSecureRedirect(`${origin}/login?error=missing_credentials`);
  }

  // 2. DB-backed rate limit check
  const rateLimitStatus = await checkRateLimit(ip);
  if (!rateLimitStatus.allowed) {
    return createSecureRedirect(`${origin}/login?error=rate_limited`);
  }

  try {
    const memberResult = await query<{
      id: string;
      name: string;
      group_id: string;
      passcode_hash: string;
    }>(
      `SELECT m.id, m.name, m.group_id, g.passcode_hash 
       FROM members m
       JOIN groups g ON m.group_id = g.id
       WHERE m.id = $1`,
      [memberId]
    );

    if (memberResult.rows.length === 0) {
      await recordFailedAttempt(ip);
      return createSecureRedirect(`${origin}/login?error=member_not_found`);
    }

    const member = memberResult.rows[0];
    const isPasscodeValid = await bcrypt.compare(code, member.passcode_hash);

    if (!isPasscodeValid) {
      await recordFailedAttempt(ip);
      return createSecureRedirect(`${origin}/login?error=invalid_passcode`);
    }

    // 3. Reset rate limit on success
    await resetRateLimit(ip);

    // 4. Issue session cookie
    const token = signSession({
      memberId: member.id,
      memberName: member.name,
      groupId: member.group_id,
    });

    const cookieHeader = createSessionCookie(token);

    // 5. Secure redirect: strips passcode from URL, prevents referrer leakage and caching
    const response = createSecureRedirect(`${origin}/`);
    response.headers.set('Set-Cookie', cookieHeader);
    return response;
  } catch (error) {
    console.error('Error during invite link login:', error);
    return createSecureRedirect(`${origin}/login?error=server_error`);
  }
}
