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
      className="alert-bar alert-bar-warning"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        backgroundColor: '#FFFBEB',
        border: '1px solid #FDE68A',
        borderLeft: '3px solid #B45309',
        borderRadius: '8px',
        color: '#0F172A',
        fontSize: '13px',
      }}
      data-testid="scheduler-stale-banner"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#B45309"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
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
