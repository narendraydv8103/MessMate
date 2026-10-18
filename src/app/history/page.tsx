'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import Avatar, { AvatarMember } from '@/components/Avatar';

export interface HistoryItem {
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

export interface DecisionChangeItem {
  seq: number;
  id: string;
  memberId: string;
  member_id?: string;
  memberName: string;
  member_name?: string;
  avatarColor: string;
  hasPhoto?: boolean;
  photoVersion?: number | null;
  decision: 'JAAYENGE' | 'NAHI_JAAYENGE';
  createdAt: string;
  created_at?: string;
  mealDate: string;
  meal_date?: string;
  mealPeriod: 'DINNER' | 'LUNCH';
  meal_period?: 'DINNER' | 'LUNCH';
  isFinal: boolean;
  is_final?: boolean;
}

/**
 * Formats a date/time string or Date instance into 12-hour IST time (e.g. 9:10 PM).
 */
export function formatIstTime(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return '';
  const date = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export default function HistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [decisions, setDecisions] = useState<DecisionChangeItem[]>([]);
  const [expandedMeals, setExpandedMeals] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadHistory() {
      try {
        const [historyRes, decisionsRes] = await Promise.all([
          fetch('/api/history', { cache: 'no-store' }),
          fetch('/api/decisions/history', { cache: 'no-store' }),
        ]);

        if (historyRes.status === 401 || decisionsRes.status === 401) {
          router.push('/login');
          return;
        }

        if (!historyRes.ok || !decisionsRes.ok) {
          throw new Error('Failed to load history');
        }

        const historyData = await historyRes.json();
        const decisionsData = await decisionsRes.json();

        setHistory(historyData.history || []);
        setDecisions(decisionsData.decisions || decisionsData.history || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading history');
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [router]);

  // Group decision changes by meal: `${mealDate}-${mealPeriod}` in chronological order
  const decisionsByMeal = useMemo(() => {
    const map: Record<string, DecisionChangeItem[]> = {};
    for (const d of decisions) {
      const mealDate = d.mealDate || d.meal_date || '';
      const mealPeriod = d.mealPeriod || d.meal_period || '';
      const key = `${mealDate}-${mealPeriod}`;
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(d);
    }

    for (const key in map) {
      map[key].sort((a, b) => a.seq - b.seq);
    }
    return map;
  }, [decisions]);

  function toggleExpand(key: string) {
    setExpandedMeals((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

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
          const rowKey = `${item.date}-${item.mealPeriod}`;
          const isExpanded = Boolean(expandedMeals[rowKey]);
          const mealChanges = decisionsByMeal[rowKey] || [];

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
            <div
              key={`${item.date}-${item.mealPeriod}-${idx}`}
              className="card"
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              data-testid={`history-row-${item.date}-${item.mealPeriod}`}
            >
              {/* Collapsed top row */}
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
                  {item.decision ? item.decision.replace('_', ' ') : 'No Decision'}
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
                  {item.scheduledFor ? `Scheduled: ${formatIstTime(item.scheduledFor)}` : ''}
                </span>
              </div>

              {item.informedByName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--success)', backgroundColor: 'var(--success-bg)', padding: '4px 8px', borderRadius: '6px' }}>
                  <Avatar
                    member={item.informedByMember || { name: item.informedByName }}
                    size={18}
                  />
                  <span>
                    Informed by {item.informedByName} {item.informedAt ? `(${formatIstTime(item.informedAt)})` : ''}
                  </span>
                </div>
              )}

              {/* Expand / Collapse Button (44px+ tap target) */}
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => toggleExpand(rowKey)}
                  style={{
                    minHeight: '44px',
                    minWidth: '44px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--primary)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  aria-expanded={isExpanded}
                  data-testid={`toggle-changes-${item.date}-${item.mealPeriod}`}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease',
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <span>{isExpanded ? 'Hide changes' : 'View changes'}</span>
                </button>
              </div>

              {/* Expanded Change Timeline */}
              {isExpanded && (
                <div
                  data-testid={`timeline-${item.date}-${item.mealPeriod}`}
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: '12px',
                    marginTop: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Change Timeline (IST)
                  </div>

                  {mealChanges.length === 0 && !item.informedByName && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      No decision changes recorded for this meal.
                    </div>
                  )}

                  {mealChanges.map((change, cIdx) => {
                    const isLastChange = cIdx === mealChanges.length - 1;
                    const istTime = formatIstTime(change.createdAt || change.created_at);
                    const decisionDisplay = change.decision === 'JAAYENGE' ? 'JAAYENGE' : 'NAHI JAAYENGE';
                    const decisionColor = change.decision === 'JAAYENGE' ? 'var(--success)' : 'var(--danger)';
                    const isFinal = Boolean(change.isFinal || change.is_final || isLastChange);

                    return (
                      <div
                        key={change.seq || change.id || cIdx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                          padding: '8px 10px',
                          backgroundColor: 'var(--surface-hover, rgba(255, 255, 255, 0.03))',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          border: '1px solid var(--border)',
                        }}
                        data-testid={`timeline-item-${change.seq}`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                          <Avatar
                            member={{
                              id: change.memberId || change.member_id,
                              name: change.memberName || change.member_name,
                              avatarColor: change.avatarColor,
                              hasPhoto: change.hasPhoto,
                              photoVersion: change.photoVersion,
                            }}
                            size={28}
                          />
                          <span style={{ color: 'var(--text-primary)', lineHeight: 1.4 }}>
                            <strong>{change.memberName || change.member_name}</strong> chose{' '}
                            <span style={{ color: decisionColor, fontWeight: 600 }}>{decisionDisplay}</span>{' '}
                            at {istTime}
                          </span>
                        </div>

                        {isFinal && (
                          <span
                            className="badge badge-green"
                            style={{ fontSize: '0.65rem', padding: '2px 6px', flexShrink: 0 }}
                            data-testid="final-marker"
                          >
                            Final
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* At the end, show the Mishra Tiffin Centre informed event if it exists */}
                  {item.informedByName && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--success-bg)',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        color: 'var(--success)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                      }}
                      data-testid={`informed-timeline-event-${item.date}-${item.mealPeriod}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <Avatar
                          member={item.informedByMember || { name: item.informedByName }}
                          size={28}
                        />
                        <span style={{ lineHeight: 1.4 }}>
                          <strong>Mishra Tiffin Centre informed</strong> by {item.informedByName}{' '}
                          {item.informedAt ? `at ${formatIstTime(item.informedAt)}` : ''}
                        </span>
                      </div>
                      <span
                        className="badge badge-green"
                        style={{ fontSize: '0.65rem', padding: '2px 6px', flexShrink: 0 }}
                      >
                        Informed
                      </span>
                    </div>
                  )}
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
