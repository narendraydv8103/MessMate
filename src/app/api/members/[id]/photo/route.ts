import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db';

const MAX_IMAGE_BYTES = 300 * 1024; // 300 KB

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Validates image type using magic bytes inspection (not just Content-Type header).
 */
function detectMagicMime(buffer: Buffer): AllowedMime | null {
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF [4 bytes size] WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

type RouteParams = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: RouteParams) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await Promise.resolve(context.params);
  if (!id) {
    return NextResponse.json({ error: 'Member ID is required' }, { status: 400 });
  }

  try {
    const result = await query<{
      group_id: string;
      photo_data: Buffer | null;
      photo_mime: string | null;
    }>(
      'SELECT group_id, photo_data, photo_mime FROM members WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    const member = result.rows[0];

    // Enforce same-group restriction (cross-group access forbidden)
    if (member.group_id !== session.groupId) {
      return NextResponse.json(
        { error: 'Forbidden: cross-group access denied.' },
        { status: 403 }
      );
    }

    if (!member.photo_data || !member.photo_mime) {
      return NextResponse.json({ error: 'No photo found for this member.' }, { status: 404 });
    }

    return new Response(new Uint8Array(member.photo_data), {
      status: 200,
      headers: {
        'Content-Type': member.photo_mime,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error fetching member photo:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve member photo.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, context: RouteParams) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await Promise.resolve(context.params);
  if (!id) {
    return NextResponse.json({ error: 'Member ID is required' }, { status: 400 });
  }

  try {
    // 1. Enforce self-only editing: members can only update their own profile photo
    if (id !== session.memberId) {
      return NextResponse.json(
        { error: 'Forbidden: you can only update your own profile photo.' },
        { status: 403 }
      );
    }

    // 2. Verify target member exists in same group
    const memberResult = await query<{ id: string; group_id: string }>(
      'SELECT id, group_id FROM members WHERE id = $1',
      [id]
    );

    if (memberResult.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    if (memberResult.rows[0].group_id !== session.groupId) {
      return NextResponse.json(
        { error: 'Forbidden: cross-group access denied.' },
        { status: 403 }
      );
    }

    // 2. Parse body (accepts multipart/form-data or raw image body)
    const contentType = request.headers.get('content-type') || '';
    let buffer: Buffer;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('photo') || formData.get('file') || formData.get('image');
      if (!file || typeof file === 'string') {
        return NextResponse.json(
          { error: 'No photo file provided in form data.' },
          { status: 400 }
        );
      }
      const arrayBuffer = await (file as Blob).arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      const arrayBuffer = await request.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    // 3. Validate image size (max 300 KB)
    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Image body cannot be empty.' }, { status: 400 });
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: 'Image exceeds maximum allowed size of 300 KB.' },
        { status: 413 }
      );
    }

    // 4. Validate magic bytes (never trust header alone)
    const detectedMime = detectMagicMime(buffer);
    if (!detectedMime) {
      return NextResponse.json(
        { error: 'Invalid or unsupported image format. Allowed formats are JPEG, PNG, and WebP.' },
        { status: 400 }
      );
    }

    // 5. Update photo in database (never log raw image bytes)
    const updateResult = await query<{ photo_updated_at: Date }>(
      `UPDATE members 
       SET photo_data = $1, photo_mime = $2, photo_updated_at = NOW() 
       WHERE id = $3 AND group_id = $4 
       RETURNING photo_updated_at`,
      [buffer, detectedMime, id, session.groupId]
    );

    const updatedAt = updateResult.rows[0]?.photo_updated_at;
    const photoVersion = updatedAt ? new Date(updatedAt).getTime() : Date.now();

    return NextResponse.json({
      success: true,
      hasPhoto: true,
      photoVersion,
    });
  } catch (error) {
    console.error('Error updating member photo:', error);
    return NextResponse.json(
      { error: 'Failed to update member photo.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteParams) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await Promise.resolve(context.params);
  if (!id) {
    return NextResponse.json({ error: 'Member ID is required' }, { status: 400 });
  }

  try {
    // 1. Enforce self-only editing: members can only remove their own profile photo
    if (id !== session.memberId) {
      return NextResponse.json(
        { error: 'Forbidden: you can only remove your own profile photo.' },
        { status: 403 }
      );
    }

    // 2. Verify target member exists in same group
    const memberResult = await query<{ id: string; group_id: string }>(
      'SELECT id, group_id FROM members WHERE id = $1',
      [id]
    );

    if (memberResult.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    if (memberResult.rows[0].group_id !== session.groupId) {
      return NextResponse.json(
        { error: 'Forbidden: cross-group access denied.' },
        { status: 403 }
      );
    }

    // 2. Remove photo data
    await query(
      `UPDATE members 
       SET photo_data = NULL, photo_mime = NULL, photo_updated_at = NOW() 
       WHERE id = $1 AND group_id = $2`,
      [id, session.groupId]
    );

    return NextResponse.json({ success: true, message: 'Photo removed successfully.' });
  } catch (error) {
    console.error('Error removing member photo:', error);
    return NextResponse.json(
      { error: 'Failed to remove member photo.' },
      { status: 500 }
    );
  }
}
