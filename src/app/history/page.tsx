'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';

interface HistoryItem {
  date: string;
  mealPeriod: 'DINNER' | 'LUNCH';
  decision: 'JAAYENGE' | 'NAHI_JAAYENGE' | null;
  submittedByName: string | null;
  submittedAt: string | null;
  scheduledFor: string | null;
  callJobStatus: string | null;
  statusLabel: string;
  informedByName?: string | null;
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
      <div style={{ marginBottom: '8px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Meal History</h1>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Past meal attendance decisions and Aunty alerts</p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
          Loading history...
        </div>
      )}

      {error && (
        <div style={{ color: '#f87171', padding: '12px', borderRadius: '12px', backgroundColor: 'var(--red-bg)', border: '1px solid var(--red-border)' }}>
          {error}
        </div>
      )}

      {!loading && history.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px', color: '#94a3b8' }}>
          No past meal records found yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {history.map((item, idx) => {
          const badgeClass =
            item.decision === 'JAAYENGE'
              ? 'badge-green'
              : item.decision === 'NAHI_JAAYENGE'
              ? 'badge-red'
              : 'badge-muted';

          return (
            <div key={`${item.date}-${item.mealPeriod}-${idx}`} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#f8fafc' }}>
                    {item.date}
                  </span>
                  <span style={{ marginLeft: '8px', fontSize: '0.85rem', color: '#38bdf8' }}>
                    {item.mealPeriod === 'DINNER' ? '🌙 Dinner' : '☀️ Lunch'}
                  </span>
                </div>
                <div className={`badge ${badgeClass}`}>
                  {item.decision || 'No Decision'}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                <span style={{ color: '#94a3b8' }}>Status</span>
                <span style={{ fontWeight: 600, color: item.statusLabel === 'Missed' ? '#f87171' : item.statusLabel === 'Aunty Informed' ? '#34d399' : '#cbd5e1' }}>
                  {item.statusLabel}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                <span>
                  {item.submittedByName ? `Decided by ${item.submittedByName}` : 'Auto-evaluated'}
                </span>
                <span>
                  {item.scheduledFor ? `Scheduled: ${new Date(item.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
              </div>

              {item.informedByName && (
                <div style={{ fontSize: '0.75rem', color: '#34d399', backgroundColor: 'var(--green-bg)', padding: '4px 8px', borderRadius: '6px' }}>
                  Informed by {item.informedByName} {item.informedAt ? `(${new Date(item.informedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}
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
