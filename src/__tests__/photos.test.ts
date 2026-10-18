import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as photoGet, PUT as photoPut, DELETE as photoDelete } from '@/app/api/members/[id]/photo/route';
import { GET as membersGet } from '@/app/api/auth/members/route';
import { signSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import * as dbModule from '@/lib/db';

describe('Member Profile Photos API Tests', () => {
  const memberId = 'm-sujeet-1';
  const groupId = 'group-100';
  const otherGroupId = 'group-999';

  const validToken = signSession({
    memberId,
    groupId,
    memberName: 'Sujeet Yadav',
  });

  // Valid JPEG header: FF D8 FF E0
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  // Valid PNG header: 89 50 4E 47 0D 0A 1A 0A
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
  // Valid WebP header: RIFF .... WEBP
  const validWebpBuffer = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // file size
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
  ]);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Authentication Enforcement (401)', () => {
    it('GET /api/members/[id]/photo requires authentication (401)', async () => {
      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'GET',
      });
      const res = await photoGet(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('PUT /api/members/[id]/photo requires authentication (401)', async () => {
      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        body: validJpegBuffer,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      const res = await photoPut(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('DELETE /api/members/[id]/photo requires authentication (401)', async () => {
      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'DELETE',
      });
      const res = await photoDelete(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('2. Cross-Group Access Control (403)', () => {
    it('GET rejects cross-group member access with 403', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          {
            group_id: otherGroupId, // Different group!
            photo_data: validJpegBuffer,
            photo_mime: 'image/jpeg',
          },
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
      });

      const res = await photoGet(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('cross-group access denied');
    });

    it('PUT rejects cross-group member photo update with 403', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          {
            id: memberId,
            group_id: otherGroupId, // Different group!
          },
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: validJpegBuffer,
      });

      const res = await photoPut(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('cross-group access denied');
    });

    it('DELETE rejects cross-group member photo removal with 403', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          {
            id: memberId,
            group_id: otherGroupId, // Different group!
          },
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'DELETE',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
      });

      const res = await photoDelete(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('cross-group access denied');
    });
  });

  describe('2b. Self-Only Editing Enforcement (403)', () => {
    const roommateBId = 'm-roommate-b';

    it('PUT rejects when member A tries to update member B photo with 403', async () => {
      const req = new Request(`http://localhost:3000/api/members/${roommateBId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`, // session belongs to memberId (Aarav/Sujeet), not roommateBId
        },
        body: validJpegBuffer,
      });

      const res = await photoPut(req, { params: Promise.resolve({ id: roommateBId }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden: you can only update your own profile photo.');
    });

    it('DELETE rejects when member A tries to remove member B photo with 403', async () => {
      const req = new Request(`http://localhost:3000/api/members/${roommateBId}/photo`, {
        method: 'DELETE',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`, // session belongs to memberId, not roommateBId
        },
      });

      const res = await photoDelete(req, { params: Promise.resolve({ id: roommateBId }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden: you can only remove your own profile photo.');
    });

    it('GET stays same-group (member A can view member B photo)', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          {
            group_id: groupId, // Same group as member A!
            photo_data: validJpegBuffer,
            photo_mime: 'image/jpeg',
          },
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const req = new Request(`http://localhost:3000/api/members/${roommateBId}/photo`, {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
      });

      const res = await photoGet(req, { params: Promise.resolve({ id: roommateBId }) });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    });
  });

  describe('3. Validation: Format & Magic Bytes Checking (400)', () => {
    it('rejects text content pretending to be JPEG with 400', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [{ id: memberId, group_id: groupId }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const textFakeImage = Buffer.from('this is just a text file not an image');

      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: textFakeImage,
      });

      const res = await photoPut(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid or unsupported image format');
    });

    it('rejects unsupported image types (e.g. GIF / BMP) with 400', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [{ id: memberId, group_id: groupId }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // GIF89a header: 47 49 46 38 39 61
      const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);

      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/gif',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: gifBuffer,
      });

      const res = await photoPut(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid or unsupported image format');
    });

    it('rejects empty image body with 400', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [{ id: memberId, group_id: groupId }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: Buffer.from([]),
      });

      const res = await photoPut(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('empty');
    });
  });

  describe('4. Validation: File Size Limit (413)', () => {
    it('rejects oversize photos (>300 KB) with 413', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [{ id: memberId, group_id: groupId }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      // Create buffer of 301 KB
      const oversizeBuffer = Buffer.alloc(301 * 1024);
      // Valid JPEG header at start
      oversizeBuffer[0] = 0xff;
      oversizeBuffer[1] = 0xd8;
      oversizeBuffer[2] = 0xff;

      const req = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: oversizeBuffer,
      });

      const res = await photoPut(req, { params: Promise.resolve({ id: memberId }) });
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toContain('300 KB');
    });
  });

  describe('5. Upload, Fetch & Integrity Check', () => {
    it('PUT uploads JPEG photo and GET returns identical bytes with correct headers', async () => {
      const fixedDate = new Date('2026-10-18T20:00:00.000Z');

      // 1. PUT upload
      vi.spyOn(dbModule, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: memberId, group_id: groupId }],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ photo_updated_at: fixedDate }],
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

      const putReq = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: validJpegBuffer,
      });

      const putRes = await photoPut(putReq, { params: Promise.resolve({ id: memberId }) });
      expect(putRes.status).toBe(200);
      const putJson = await putRes.json();
      expect(putJson.success).toBe(true);
      expect(putJson.hasPhoto).toBe(true);
      expect(putJson.photoVersion).toBe(fixedDate.getTime());

      // 2. GET fetch
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          {
            group_id: groupId,
            photo_data: validJpegBuffer,
            photo_mime: 'image/jpeg',
          },
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const getReq = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
      });

      const getRes = await photoGet(getReq, { params: Promise.resolve({ id: memberId }) });
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');
      expect(getRes.headers.get('Cache-Control')).toBe('private, max-age=86400');
      expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');

      const returnedBuffer = Buffer.from(await getRes.arrayBuffer());
      expect(returnedBuffer.equals(validJpegBuffer)).toBe(true);
    });

    it('supports PNG and WebP formats verified by magic bytes', async () => {
      // Test PNG
      vi.spyOn(dbModule, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: memberId, group_id: groupId }],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ photo_updated_at: new Date() }],
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

      const pngReq = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/png',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: validPngBuffer,
      });

      const pngRes = await photoPut(pngReq, { params: Promise.resolve({ id: memberId }) });
      expect(pngRes.status).toBe(200);

      // Test WebP
      vi.spyOn(dbModule, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: memberId, group_id: groupId }],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ photo_updated_at: new Date() }],
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

      const webpReq = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/webp',
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
        body: validWebpBuffer,
      });

      const webpRes = await photoPut(webpReq, { params: Promise.resolve({ id: memberId }) });
      expect(webpRes.status).toBe(200);
    });
  });

  describe('6. Delete Photo Operation', () => {
    it('DELETE /api/members/[id]/photo removes photo and GET subsequently returns 404', async () => {
      // 1. DELETE
      vi.spyOn(dbModule, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: memberId, group_id: groupId }],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
        });

      const deleteReq = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'DELETE',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
      });

      const deleteRes = await photoDelete(deleteReq, { params: Promise.resolve({ id: memberId }) });
      expect(deleteRes.status).toBe(200);
      const deleteJson = await deleteRes.json();
      expect(deleteJson.success).toBe(true);

      // 2. Subsequent GET returns 404
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          {
            group_id: groupId,
            photo_data: null,
            photo_mime: null,
          },
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const getReq = new Request(`http://localhost:3000/api/members/${memberId}/photo`, {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
        },
      });

      const getRes = await photoGet(getReq, { params: Promise.resolve({ id: memberId }) });
      expect(getRes.status).toBe(404);
      const getJson = await getRes.json();
      expect(getJson.error).toContain('No photo found');
    });
  });

  describe('7. Public /api/auth/members Privacy', () => {
    it('/api/auth/members does NOT expose photo data or hasPhoto flags', async () => {
      vi.spyOn(dbModule, 'query').mockResolvedValueOnce({
        rows: [
          { id: '1', name: 'Sujeet Yadav', avatar_color: '#3b82f6' },
          { id: '2', name: 'Mahendra Singh Yadav', avatar_color: '#10b981' },
        ],
        command: 'SELECT',
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      const res = await membersGet();
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(Array.isArray(json.members)).toBe(true);
      expect(json.members.length).toBe(2);

      for (const m of json.members) {
        expect(m).toHaveProperty('id');
        expect(m).toHaveProperty('name');
        expect(m).toHaveProperty('avatarColor');

        // MUST NOT expose photo details
        expect(m).not.toHaveProperty('photo');
        expect(m).not.toHaveProperty('photo_data');
        expect(m).not.toHaveProperty('photo_mime');
        expect(m).not.toHaveProperty('hasPhoto');
        expect(m).not.toHaveProperty('photoVersion');
      }
    });
  });
});
