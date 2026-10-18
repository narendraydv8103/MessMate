'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';

interface Member {
  id: string;
  name: string;
  avatarColor: string;
  notificationPreferences?: Record<string, unknown>;
}

export default function RoommatesPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ marginBottom: '8px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Roommates</h1>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>The 4 members sharing the mess meals</p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
          Loading profiles...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {members.map((member) => {
            const isMe = member.id === currentMemberId;
            const initials = member.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2);

            return (
              <div
                key={member.id}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  border: isMe ? '1px solid var(--green-border)' : '1px solid var(--border-subtle)',
                  backgroundColor: isMe ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-card)',
                }}
              >
                {/* Avatar with custom color */}
                <div
                  style={{
                    width: '52px',
                    height: '52px',
                    borderRadius: '50%',
                    backgroundColor: member.avatarColor || '#3b82f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '1.2rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    flexShrink: 0,
                  }}
                >
                  {initials}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: member.avatarColor || '#3b82f6',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      Color: {member.avatarColor || '#3b82f6'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BottomNav />
    </main>
  );
}
