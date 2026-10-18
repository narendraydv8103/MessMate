'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface UpdatePromptProps {
  isSubmitting?: boolean;
}

const DISMISS_SESSION_KEY = 'messmate_update_dismissed';

function isDismissedThisSession(): boolean {
  try {
    return typeof window !== 'undefined' && sessionStorage.getItem(DISMISS_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Checks if a user action (decision submit, photo upload, confirm dialog)
 * is currently in progress on the page.
 */
export function isActionInProgress(): boolean {
  if (typeof document === 'undefined') return false;

  // 1. Any active modal overlay or dialog (ConfirmDialog, PhotoCropModal)
  const dialog = document.querySelector('[role="dialog"], .modal-overlay, [aria-modal="true"]');
  if (dialog) return true;

  // 2. Explicit data-is-submitting attribute
  const submittingEl = document.querySelector(
    '[data-is-submitting="true"], [data-submitting="true"]'
  );
  if (submittingEl) return true;

  // 3. Disabled buttons with in-flight action text
  const disabledButtons = document.querySelectorAll('button:disabled');
  for (const btn of Array.from(disabledButtons)) {
    const text = btn.textContent?.toLowerCase() || '';
    if (
      text.includes('confirming') ||
      text.includes('saving') ||
      text.includes('submitting') ||
      text.includes('uploading')
    ) {
      return true;
    }
  }

  return false;
}

export default function UpdatePrompt({ isSubmitting = false }: UpdatePromptProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);

  // Trigger reload on controllerchange, exactly once, unless action is in progress
  const performReload = useCallback(() => {
    if (reloadingRef.current) return;

    // Do not reload automatically while decision submit, photo upload, or confirm dialog is in progress
    if (isSubmitting || isActionInProgress()) {
      return;
    }

    reloadingRef.current = true;
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }, [isSubmitting]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const version = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
    const swUrl = `/sw.js?v=${encodeURIComponent(version)}`;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    // Listen for controllerchange event
    const onControllerChange = () => {
      performReload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        // 1. If a worker is already waiting AND one is already controlling the page (update scenario)
        if (reg.waiting && navigator.serviceWorker.controller) {
          if (!isDismissedThisSession()) {
            setWaitingWorker(reg.waiting);
            setShowBanner(true);
          }
        }

        // 2. Listen for a new worker reaching the waiting state
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // Only show banner if worker is installed AND an existing worker is already controlling
            // (first-time install and first load must NOT show the banner)
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              if (!isDismissedThisSession()) {
                setWaitingWorker(newWorker);
                setShowBanner(true);
              }
            }
          });
        });

        // 3. Call registration.update() on load
        reg.update().catch(() => {});

        // 4. Call registration.update() every 10 minutes while open
        intervalId = setInterval(() => {
          reg.update().catch(() => {});
        }, 10 * 60 * 1000);

        // 5. Call registration.update() when tab becomes visible or returns to foreground
        const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        };

        const handleFocus = () => {
          reg.update().catch(() => {});
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);

        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          window.removeEventListener('focus', handleFocus);
        };
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      if (intervalId) clearInterval(intervalId);
    };
  }, [performReload]);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  const handleLater = () => {
    setShowBanner(false);
    try {
      sessionStorage.setItem(DISMISS_SESSION_KEY, 'true');
    } catch {}
  };

  // Banner is suppressed while an action is submitting
  if (!showBanner || isSubmitting) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="alert-bar"
      data-testid="update-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '8px 16px',
        backgroundColor: 'var(--info-bg, #DBEAFE)',
        borderBottom: '1px solid var(--info-border, #BFDBFE)',
        color: 'var(--text-primary, #0F172A)',
        fontSize: '0.875rem',
        fontWeight: 500,
        zIndex: 998,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent, #1D4ED8)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>New version available</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={handleLater}
          style={{
            minHeight: '44px',
            minWidth: '44px',
            padding: '0 12px',
            background: 'transparent',
            border: '1px solid var(--border, #CBD5E1)',
            borderRadius: '6px',
            color: 'var(--text-secondary, #475569)',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          data-testid="btn-update-later"
          aria-label="Later"
        >
          Later
        </button>

        <button
          type="button"
          onClick={handleUpdate}
          style={{
            minHeight: '44px',
            minWidth: '44px',
            padding: '0 16px',
            background: 'var(--accent, #1D4ED8)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '6px',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          data-testid="btn-update-now"
          aria-label="Update"
        >
          Update
        </button>
      </div>
    </div>
  );
}
