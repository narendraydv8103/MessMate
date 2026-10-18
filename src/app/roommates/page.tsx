'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import Avatar, { AvatarMember } from '@/components/Avatar';
import PhotoCropModal from '@/components/PhotoCropModal';

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

  // Photo crop modal state
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [isSavingCrop, setIsSavingCrop] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
          if (data.currentMemberId && !currentMemberId) {
            setCurrentMemberId(data.currentMemberId);
          }
        }
      } catch (err) {
        console.error('Failed to load roommates data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [router, currentMemberId]);

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (currentMemberId) {
      setCardFeedback((prev) => ({ ...prev, [currentMemberId]: null }));
    }

    const fileNameLower = file.name.toLowerCase();
    if (
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      fileNameLower.endsWith('.heic') ||
      fileNameLower.endsWith('.heif')
    ) {
      if (currentMemberId) {
        setCardFeedback((prev) => ({
          ...prev,
          [currentMemberId]: {
            type: 'error',
            message:
              'HEIC images are not directly supported by browsers. Please choose a JPEG, PNG, or WebP photo.',
          },
        }));
      }
      return;
    }

    setCropFile(file);
    setIsCropModalOpen(true);
  }

  function handleCancelCrop() {
    setIsCropModalOpen(false);
    setCropFile(null);
  }

  async function handleSaveCroppedPhoto(croppedBlob: Blob) {
    if (!currentMemberId) return;
    setIsSavingCrop(true);
    setProcessingMemberId(currentMemberId);

    try {
      const res = await fetch(`/api/members/${currentMemberId}/photo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
        },
        body: croppedBlob,
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
          m.id === currentMemberId
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
        [currentMemberId]: { type: 'success', message: 'Photo updated successfully!' },
      }));

      setIsCropModalOpen(false);
      setCropFile(null);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Photo upload failed.';
      setCardFeedback((prev) => ({
        ...prev,
        [currentMemberId]: {
          type: 'error',
          message: errorMsg,
        },
      }));
      throw err;
    } finally {
      setIsSavingCrop(false);
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
                data-testid={`roommate-card-${member.id}`}
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

                {/* Self-only photo actions: Change photo & Remove photo */}
                {isMe && (
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
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/*"
                      style={{ display: 'none' }}
                      onChange={handleFileSelected}
                      data-testid={`file-input-${member.id}`}
                    />

                    {/* Change photo button (44px+ tap target) */}
                    <button
                      type="button"
                      disabled={isBusy || isSavingCrop}
                      onClick={() => fileInputRef.current?.click()}
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
                        cursor: isBusy || isSavingCrop ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        opacity: isBusy || isSavingCrop ? 0.7 : 1,
                      }}
                      aria-label={`Change photo for ${member.name}`}
                      data-testid={`btn-change-photo-${member.id}`}
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
                      <span>{isBusy || isSavingCrop ? 'Processing...' : 'Change photo'}</span>
                    </button>

                    {/* Remove photo button if member has a photo */}
                    {member.hasPhoto && (
                      <button
                        type="button"
                        disabled={isBusy || isSavingCrop}
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
                          cursor: isBusy || isSavingCrop ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                        }}
                        aria-label={`Remove photo for ${member.name}`}
                        data-testid={`btn-remove-photo-${member.id}`}
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
                )}

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

      {/* Photo Crop and Adjust Modal */}
      <PhotoCropModal
        isOpen={isCropModalOpen}
        imageFile={cropFile}
        onSave={handleSaveCroppedPhoto}
        onCancel={handleCancelCrop}
        isSaving={isSavingCrop}
      />

      <BottomNav />
    </main>
  );
}
