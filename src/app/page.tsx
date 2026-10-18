'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import CountdownTimer from '@/components/CountdownTimer';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActionRequiredPanel from '@/components/ActionRequiredPanel';
import SchedulerStaleBanner from '@/components/SchedulerStaleBanner';

import { useIsOffline } from '@/lib/hooks/useIsOffline';
import { isPushSupported } from '@/lib/push/client';
import Avatar, { AvatarMember } from '@/components/Avatar';

interface MealStatusResponse {
  messName?: string;
  mealDate: string;
  mealPeriod: 'DINNER' | 'LUNCH';
  serverTime: string;
  reminderTime: string;
  deadlineTime: string;
  isBeforeDeadline: boolean;
  decision: 'JAAYENGE' | 'NAHI_JAAYENGE' | null;
  submittedBy: string | null;
  submittedByMember?: AvatarMember | null;
  submittedAt: string | null;
  notes?: string | null;
  callJobStatus: string | null;
  statusLabel: string;
  messPhone: string;
  prefilledWhatsAppText: string;
  whatsappUrl: string;
  telUrl: string;
  actionRequiredAt?: string | null;
  informedBy?: string | null;
  informedByMember?: AvatarMember | null;
  informedAt?: string | null;
  lastTickAt?: string | null;
  isSchedulerStale: boolean;
  hasGroupSubscriptions?: boolean;
  groupSubscriptionCount?: number;
  urgentPushFailed?: boolean;
  members?: AvatarMember[];
}

export default function HomePage() {
  const router = useRouter();
  const [status, setStatus] = useState<MealStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCountdownZero, setIsCountdownZero] = useState(false);
  const isOffline = useIsOffline();

  // Push permission check for fallback banner
  const [showPushFallback, setShowPushFallback] = useState(false);

  // Confirmation dialog state
  const [pendingDecision, setPendingDecision] = useState<'JAAYENGE' | 'NAHI_JAAYENGE' | null>(null);
  const [activeIdempotencyKey, setActiveIdempotencyKey] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Poll status endpoint
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res) return;
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.ok) {
        const data: MealStatusResponse = await res.json();
        setStatus(data);
        if (!data.isBeforeDeadline) {
          setIsCountdownZero(true);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch status:', err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Check push support / permission on mount and listen to sw messages
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        const supported = isPushSupported();
        const denied = 'Notification' in window && Notification.permission === 'denied';
        if (!supported || denied) {
          setShowPushFallback(true);
        }
      }, 0);

      // Listen for messages from service worker (e.g. notification click re-fetch)
      if ('serviceWorker' in navigator) {
        const handleSwMessage = (event: MessageEvent) => {
          if (event.data?.type === 'REFETCH_STATUS') {
            void fetchStatus();
          }
        };
        navigator.serviceWorker.addEventListener('message', handleSwMessage);
        return () => navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    }
  }, [fetchStatus]);

  // Initial fetch and 15s polling + tab focus
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!mounted || !res) return;
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (res.ok) {
          const data: MealStatusResponse = await res.json();
          if (mounted) {
            setStatus(data);
            if (!data.isBeforeDeadline) {
              setIsCountdownZero(true);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch status:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();

    const interval = setInterval(() => {
      void fetchStatus();
    }, 15000);

    const handleFocus = () => {
      void fetchStatus();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchStatus();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchStatus, router]);

  // Action initiated by tapping decision buttons
  function handleInitiateDecision(decision: 'JAAYENGE' | 'NAHI_JAAYENGE') {
    if (isOffline || isSubmitting) return;

    // Generate new idempotency key per confirmed action
    const newKey = `decision-${decision}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    setActiveIdempotencyKey(newKey);
    setPendingDecision(decision);
    setFeedbackMessage(null);
  }

  // Submission after confirmation dialog
  async function handleConfirmSubmit() {
    if (!pendingDecision || !activeIdempotencyKey || isSubmitting) return;

    setIsSubmitting(true);
    setFeedbackMessage(null);

    try {
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: pendingDecision,
          idempotencyKey: activeIdempotencyKey,
        }),
      });

      if (!res) throw new Error('No response from server');
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (res.status === 422) {
        setFeedbackMessage({
          text: data.error || 'Deadline has passed or this meal decision is closed.',
          type: 'error',
        });
        setPendingDecision(null);
        await fetchStatus();
        return;
      }

      if (!res.ok) {
        setFeedbackMessage({
          text: data.error || 'Failed to submit decision. Tap retry to submit with same key.',
          type: 'error',
        });
        return;
      }

      // Backend confirmed success!
      setFeedbackMessage({
        text: `Decision "${pendingDecision === 'JAAYENGE' ? 'JAAYENGE' : 'NAHI JAAYENGE'}" confirmed!`,
        type: 'success',
      });
      setPendingDecision(null);
      setActiveIdempotencyKey(null);
      await fetchStatus();
    } catch {
      setFeedbackMessage({
        text: 'Network error. Decision not saved. Please check connection and retry.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading && !status) {
    return (
      <main style={{ padding: '24px 20px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading MessMate status...</p>
      </main>
    );
  }

  // Display status label formatting
  const messName = status?.messName || 'Mishra Tiffin Centre';
  const rawStatusLabel = status?.statusLabel || 'No Decision';
  const displayStatusLabel = rawStatusLabel === 'Call Scheduled' ? `${messName} alert scheduled` : rawStatusLabel;

  // Determine disabled reason visibly
  let disabledReason: string | null = null;
  if (isOffline) {
    disabledReason = 'You are offline: reconnect to the internet to submit decision';
  } else if (status?.callJobStatus === 'MISSED') {
    disabledReason = 'Decision closed: Deadline passed without action (Missed)';
  } else if (status?.callJobStatus === 'MESS_INFORMED') {
    disabledReason = `Decision closed: ${messName} has already been informed`;
  } else if (status?.callJobStatus === 'ACTION_REQUIRED') {
    disabledReason = `Decision closed: Deadline passed. ${messName} must be alerted directly`;
  } else if ((status && !status.isBeforeDeadline) || isCountdownZero) {
    disabledReason = 'Deadline reached: Meal attendance decisions are now closed';
  } else if (isSubmitting) {
    disabledReason = 'Submitting decision...';
  }

  const isDecisionDisabled = Boolean(disabledReason);

  const badgeColorClass =
    status?.callJobStatus === 'MISSED'
      ? 'badge-missed'
      : status?.decision === 'JAAYENGE'
      ? 'badge-green'
      : status?.decision === 'NAHI_JAAYENGE'
      ? 'badge-red'
      : status?.callJobStatus === 'ACTION_REQUIRED'
      ? 'badge-amber'
      : 'badge-muted';

  return (
    <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Scheduler Stale Warning Banner */}
      <SchedulerStaleBanner
        isSchedulerStale={Boolean(status?.isSchedulerStale)}
        lastTickAt={status?.lastTickAt}
      />

      {/* Urgent Push Delivery Failure Warning Banner */}
      {status?.callJobStatus === 'ACTION_REQUIRED' && status?.urgentPushFailed && (
        <div
          role="alert"
          aria-label="Push Delivery Failure Warning"
          className="alert-bar alert-bar-danger"
          data-testid="push-failed-banner"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              Push could not be sent. Please inform {messName} yourself.
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Automated push alert failed or is not configured. Use the Call or WhatsApp buttons below to notify {messName} immediately.
            </div>
          </div>
        </div>
      )}

      {/* No Group Subscriptions Warning Banner */}
      {status && status.hasGroupSubscriptions === false && (
        <div
          role="region"
          aria-label="No Push Subscriptions Warning"
          className="alert-bar alert-bar-warning"
          data-testid="no-group-subscriptions-banner"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>No device in your group is subscribed for push notifications. Add your device in Settings to receive alerts.</span>
        </div>
      )}

      {/* In-app Push Fallback Banner */}
      {showPushFallback && (
        <div
          role="region"
          aria-label="Push Fallback Notice"
          className="alert-bar alert-bar-info"
          style={{ justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span>Push notifications are disabled or unsupported on this device. Please check MessMate regularly before the deadline!</span>
          </div>
          <button
            type="button"
            onClick={() => setShowPushFallback(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px 6px',
              minHeight: 'auto',
              fontSize: '1rem',
              lineHeight: 1,
            }}
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      )}

      {/* Distinct MISSED Status Banner */}
      {status?.callJobStatus === 'MISSED' && (
        <div
          className="alert-bar alert-bar-danger"
          data-testid="missed-status-card"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
              Meal Status: Missed
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              The deadline passed more than 2 hours ago. No decision was saved and no automated alert was sent.
            </div>
          </div>
        </div>
      )}

      {/* Summary Card */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Today&apos;s Meal
            </span>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginTop: '2px', color: 'var(--text-primary)' }}>
              {status?.mealPeriod === 'DINNER' ? 'Dinner' : 'Lunch'}
            </h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {status?.mealDate}
            </p>
          </div>

          <div className={`badge ${badgeColorClass}`} id="status-label-badge">
            {displayStatusLabel}
          </div>
        </div>

        {/* Live Countdown Sync */}
        {status?.serverTime && status?.deadlineTime && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
              Deadline Countdown
            </span>
            <div style={{ marginTop: '6px' }}>
              <CountdownTimer
                serverTime={status.serverTime}
                deadlineTime={status.deadlineTime}
                onDeadlinePassed={() => {
                  setIsCountdownZero(true);
                  void fetchStatus();
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
              <span>Reminder: {status.reminderTime ? new Date(status.reminderTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              <span>Deadline: {status.deadlineTime ? new Date(status.deadlineTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            </div>
          </div>
        )}
      </div>

      {/* Current Group Decision Card */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.875rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Current group decision</span>
          <span style={{
            fontWeight: 600,
            color: status?.decision === 'JAAYENGE' ? 'var(--success)' : status?.decision === 'NAHI_JAAYENGE' ? 'var(--danger)' : 'var(--text-muted)'
          }}>
            {status?.decision === 'JAAYENGE' ? 'JAAYENGE' : status?.decision === 'NAHI_JAAYENGE' ? 'NAHI JAAYENGE' : 'None yet'}
          </span>
        </div>
        {status?.submittedBy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <Avatar
              member={
                status.submittedByMember || {
                  name: status.submittedBy,
                }
              }
              size={24}
            />
            <div>
              Submitted by <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{status.submittedBy}</span>{' '}
              {status.submittedAt ? `at ${new Date(status.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Decision Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          type="button"
          className="btn btn-jaayenge"
          onClick={() => handleInitiateDecision('JAAYENGE')}
          disabled={isDecisionDisabled}
          id="btn-jaayenge"
          aria-label="Confirm eating at mess (Jaayenge)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          JAAYENGE (Khaana Hai)
        </button>

        <button
          type="button"
          className="btn btn-nahi"
          onClick={() => handleInitiateDecision('NAHI_JAAYENGE')}
          disabled={isDecisionDisabled}
          id="btn-nahi-jaayenge"
          aria-label="Confirm not eating at mess (Nahi Jaayenge)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          NAHI JAAYENGE (Cancel)
        </button>

        {/* Visible disabled reason */}
        {disabledReason && (
          <div
            style={{
              textAlign: 'center',
              padding: '6px 10px',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
            data-testid="decision-disabled-reason"
          >
            {disabledReason}
          </div>
        )}
      </div>

      {/* Feedback Alert */}
      {feedbackMessage && (
        <div
          role="status"
          className={`alert-bar ${feedbackMessage.type === 'success' ? 'alert-bar-success' : 'alert-bar-danger'}`}
          style={{ justifyContent: 'center', textAlign: 'center' }}
        >
          {feedbackMessage.text}
        </div>
      )}

      {/* Action Required Panel (Shown when status is ACTION_REQUIRED or MESS_INFORMED) */}
      {status && (
        <ActionRequiredPanel
          messName={messName}
          messPhone={status.messPhone}
          telUrl={status.telUrl}
          whatsappUrl={status.whatsappUrl}
          prefilledWhatsAppText={status.prefilledWhatsAppText}
          callJobStatus={status.callJobStatus}
          informedBy={status.informedBy}
          informedAt={status.informedAt}
          onInformedSuccess={fetchStatus}
          isOffline={isOffline}
        />
      )}

      {/* Decision Confirmation Dialog */}
      <ConfirmDialog
        isOpen={pendingDecision !== null}
        title={pendingDecision === 'JAAYENGE' ? 'Confirm: Eating at Mess' : 'Confirm: NOT Eating at Mess'}
        message={
          pendingDecision === 'JAAYENGE'
            ? 'Are you sure? This confirms that the group is eating at the mess today. No call will be scheduled.'
            : `Are you sure? If not changed before the deadline, ${messName} will be alerted that the group will NOT eat.`
        }
        confirmText={pendingDecision === 'JAAYENGE' ? 'Yes, JAAYENGE' : 'Yes, NAHI JAAYENGE'}
        variant={pendingDecision === 'JAAYENGE' ? 'green' : 'red'}
        isSubmitting={isSubmitting}
        onConfirm={handleConfirmSubmit}
        onCancel={() => {
          setPendingDecision(null);
        }}
      />

      <BottomNav />
    </main>
  );
}
