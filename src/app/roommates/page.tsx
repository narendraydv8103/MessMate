'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import Avatar, { AvatarMember } from '@/components/Avatar';

interface Member extends AvatarMember {
  id: string;
  name: string;
  avatarColor: string;
  hasPhoto?: boolean;
  photoVersion?: number | null;
  notificationPreferences?: Record<string, unknown>;
}

export default function RoommatesPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingMemberId, setProcessingMemberId] = useState<string | null>(null);
  const [cardFeedback, setCardFeedback] = useState<
    Record<string, { type: 'success' | 'error'; message: string } | null>
  >({});

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    async function loadData() {
      try {
        // Fetch current session
        const meRes = await fetch('/api/auth/me');
        if (meRes.status === 401) {
          router.push('/login');
          return;
        }
        if (meRes.ok) {
          const meData = await meRes.json();
          setCurrentMemberId(meData.member?.id || null);
        }

        // Fetch settings which has full members info
        const settingsRes = await fetch('/api/settings');
        if (settingsRes.status === 401) {
          router.push('/login');
          return;
        }
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          if (data.members) {
            setMembers(data.members);
          }
        }
      } catch (err) {
        console.error('Failed to load roommates data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router]);

  /**
   * Resizes selected image with center-crop square to 256x256, JPEG 0.85 quality.
   */
  async function resizeImageToSquareJpeg(file: File): Promise<Blob> {
    const fileNameLower = file.name.toLowerCase();
    if (
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      fileNameLower.endsWith('.heic') ||
      fileNameLower.endsWith('.heif')
    ) {
      throw new Error(
        'HEIC images are not directly supported by browsers. Please choose a JPEG, PNG, or WebP photo.'
      );
    }

    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        try {
          const sw = img.naturalWidth || img.width;
          const sh = img.naturalHeight || img.height;

          if (!sw || !sh) {
            reject(new Error('Invalid image dimensions.'));
            return;
          }

          const cropSize = Math.min(sw, sh);
          const sx = (sw - cropSize) / 2;
          const sy = (sh - cropSize) / 2;

          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 2D context is not available.'));
            return;
          }

          ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, 256, 256);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to compress image.'));
              }
            },
            'image/jpeg',
            0.85
          );
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Image canvas resize failed.'));
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(
          new Error(
            'Could not load this file as an image. Please select a valid JPEG, PNG, or WebP photo.'
          )
        );
      };

      img.src = objectUrl;
    });
  }

  async function handleFileSelected(memberId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset file input so the same file can be selected again if needed
    event.target.value = '';

    if (!file) return;

    setProcessingMemberId(memberId);
    setCardFeedback((prev) => ({ ...prev, [memberId]: null }));

    try {
      const resizedBlob = await resizeImageToSquareJpeg(file);

      const res = await fetch(`/api/members/${memberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
        },
        body: resizedBlob,
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update photo.');
      }

      // Update state only after backend confirms!
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? {
                ...m,
                hasPhoto: true,
                photoVersion: data.photoVersion || Date.now(),
              }
            : m
        )
      );

      setCardFeedback((prev) => ({
        ...prev,
        [memberId]: { type: 'success', message: 'Photo updated successfully!' },
      }));
    } catch (err: unknown) {
      setCardFeedback((prev) => ({
        ...prev,
        [memberId]: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Photo upload failed.',
        },
      }));
    } finally {
      setProcessingMemberId(null);
    }
  }

  async function handleRemovePhoto(memberId: string) {
    setProcessingMemberId(memberId);
    setCardFeedback((prev) => ({ ...prev, [memberId]: null }));

    try {
      const res = await fetch(`/api/members/${memberId}/photo`, {
        method: 'DELETE',
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove photo.');
      }

      // Update state only after backend confirms!
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? {
                ...m,
                hasPhoto: false,
                photoVersion: null,
              }
            : m
        )
      );

      setCardFeedback((prev) => ({
        ...prev,
        [memberId]: { type: 'success', message: 'Photo removed.' },
      }));
    } catch (err: unknown) {
      setCardFeedback((prev) => ({
        ...prev,
        [memberId]: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to remove photo.',
        },
      }));
    } finally {
      setProcessingMemberId(null);
    }
  }

  return (
    <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>Roommates</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '2px' }}>
          The 4 members sharing the mess meals
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          Loading roommates...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {members.map((member) => {
            const isMe = member.id === currentMemberId;
            const isBusy = processingMemberId === member.id;
            const feedback = cardFeedback[member.id];

            return (
              <div
                key={member.id}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  border: isMe ? '1px solid var(--primary)' : '1px solid var(--border)',
                  backgroundColor: isMe ? 'var(--info-bg)' : 'var(--surface)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  {/* Shared Avatar Component */}
                  <Avatar member={member} size={52} />

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {member.name}
                      </h2>
                      {isMe && (
                        <span
                          className="badge badge-green"
                          style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                        >
                          You
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: member.avatarColor || 'var(--primary)',
                        }}
                      />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Color: {member.avatarColor || 'var(--primary)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Photo Actions: Change photo & Remove photo */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    borderTop: '1px solid var(--border)',
                    paddingTop: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Hidden file input */}
                  <input
                    ref={(el) => {
                      fileInputRefs.current[member.id] = el;
                    }}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileSelected(member.id, e)}
                    data-testid={`file-input-${member.id}`}
                  />

                  {/* Change photo button (44px+ tap target) */}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => fileInputRefs.current[member.id]?.click()}
                    style={{
                      minHeight: '44px',
                      minWidth: '44px',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: isBusy ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      opacity: isBusy ? 0.7 : 1,
                    }}
                    aria-label={`Change photo for ${member.name}`}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <span>{isBusy ? 'Processing...' : 'Change photo'}</span>
                  </button>

                  {/* Remove photo button if member has a photo */}
                  {member.hasPhoto && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRemovePhoto(member.id)}
                      style={{
                        minHeight: '44px',
                        minWidth: '44px',
                        padding: '8px 14px',
                        borderRadius: '8px',
                        backgroundColor: 'transparent',
                        border: '1px solid transparent',
                        color: 'var(--danger)',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                      aria-label={`Remove photo for ${member.name}`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      <span>Remove photo</span>
                    </button>
                  )}
                </div>

                {/* Per-card error or success message */}
                {feedback && (
                  <div
                    role={feedback.type === 'error' ? 'alert' : 'status'}
                    className={`alert-bar ${
                      feedback.type === 'success' ? 'alert-bar-success' : 'alert-bar-danger'
                    }`}
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  >
                    {feedback.message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
