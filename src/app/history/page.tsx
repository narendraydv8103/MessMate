'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import Avatar, { AvatarMember } from '@/components/Avatar';

interface HistoryItem {
  date: string;
  mealPeriod: 'DINNER' | 'LUNCH';
  decision: 'JAAYENGE' | 'NAHI_JAAYENGE' | null;
  submittedByName: string | null;
  submittedByMember?: AvatarMember | null;
  submittedAt: string | null;
  scheduledFor: string | null;
  callJobStatus: string | null;
  statusLabel: string;
  informedByName?: string | null;
  informedByMember?: AvatarMember | null;
  informedAt?: string | null;
}

export default function HistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch('/api/history', { cache: 'no-store' });
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (!res.ok) {
          throw new Error('Failed to load history');
        }
        const data = await res.json();
        setHistory(data.history || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading history');
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [router]);

  return (
    <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>Meal History</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '2px' }}>
          Past meal attendance decisions and mess alerts
        </p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          Loading history...
        </div>
      )}

      {error && (
        <div className="alert-bar alert-bar-danger">
          {error}
        </div>
      )}

      {!loading && history.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)' }}>
          No past meal records found yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {history.map((item, idx) => {
          const badgeClass =
            item.decision === 'JAAYENGE'
              ? 'badge-green'
              : item.decision === 'NAHI_JAAYENGE'
              ? 'badge-red'
              : 'badge-muted';

          const statusColor =
            item.statusLabel === 'Missed'
              ? 'var(--danger)'
              : item.statusLabel.includes('Informed')
              ? 'var(--success)'
              : 'var(--text-secondary)';

          return (
            <div key={`${item.date}-${item.mealPeriod}-${idx}`} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    {item.date}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 500 }}>
                    {item.mealPeriod === 'DINNER' ? 'Dinner' : 'Lunch'}
                  </span>
                </div>
                <div className={`badge ${badgeClass}`}>
                  {item.decision || 'No Decision'}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span style={{ fontWeight: 600, color: statusColor }}>
                  {item.statusLabel}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {item.submittedByName && (
                    <Avatar
                      member={item.submittedByMember || { name: item.submittedByName }}
                      size={20}
                    />
                  )}
                  <span>
                    {item.submittedByName ? `Decided by ${item.submittedByName}` : 'Auto-evaluated'}
                  </span>
                </div>
                <span>
                  {item.scheduledFor ? `Scheduled: ${new Date(item.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
              </div>

              {item.informedByName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--success)', backgroundColor: 'var(--success-bg)', padding: '4px 8px', borderRadius: '6px' }}>
                  <Avatar
                    member={item.informedByMember || { name: item.informedByName }}
                    size={18}
                  />
                  <span>
                    Informed by {item.informedByName} {item.informedAt ? `(${new Date(item.informedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <BottomNav />
    </main>
  );
}
