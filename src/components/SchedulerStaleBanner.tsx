'use client';

interface SchedulerStaleBannerProps {
  isSchedulerStale: boolean;
  lastTickAt?: string | null;
}

export default function SchedulerStaleBanner({ isSchedulerStale, lastTickAt }: SchedulerStaleBannerProps) {
  if (!isSchedulerStale) return null;

  return (
    <div
      role="alert"
      className="banner banner-stale"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '10px 16px',
        backgroundColor: '#f59e0b',
        color: '#000000',
        fontWeight: 600,
        fontSize: '0.85rem',
        borderRadius: '12px',
        marginBottom: '16px',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span>
        Scheduler is stale {lastTickAt ? `(last active: ${new Date(lastTickAt).toLocaleTimeString()})` : ''}. Automated checks may be delayed.
      </span>
    </div>
  );
}
