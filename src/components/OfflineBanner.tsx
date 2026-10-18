'use client';

import { useIsOffline } from '@/lib/hooks/useIsOffline';

export default function OfflineBanner() {
  const isOffline = useIsOffline();

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="banner banner-offline"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '10px 16px',
        backgroundColor: '#ef4444',
        color: '#ffffff',
        fontWeight: 600,
        fontSize: '0.9rem',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
        <line x1="12" y1="20" x2="12.01" y2="20"></line>
      </svg>
      <span>You are offline, decision not saved</span>
    </div>
  );
}
