'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import Image from 'next/image';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function checkStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator &&
      (window.navigator as unknown as { standalone: boolean }).standalone === true)
  );
}

function checkIos() {
  if (typeof window === 'undefined') return false;
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const isStandalone = useSyncExternalStore(
    (callback) => {
      const mql = typeof window !== 'undefined' ? window.matchMedia('(display-mode: standalone)') : null;
      mql?.addEventListener('change', callback);
      return () => mql?.removeEventListener('change', callback);
    },
    checkStandalone,
    () => false
  );

  const isIos = useSyncExternalStore(
    () => () => {},
    checkIos,
    () => false
  );

  useEffect(() => {
    // Listen for beforeinstallprompt on Android/Chrome
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  if (isStandalone || dismissed) {
    return null;
  }

  // Android / Chrome prompt
  if (deferredPrompt) {
    return (
      <div
        className="card"
        style={{
          position: 'fixed',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 32px)',
          maxWidth: '448px',
          zIndex: 60,
          border: '1px solid var(--green-border)',
          backgroundColor: '#1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '14px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Image
            src="/icons/icon-192.svg"
            alt="App Icon"
            width={38}
            height={38}
            style={{ borderRadius: '8px' }}
            unoptimized
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f8fafc' }}>Install MessMate</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Get instant access from home screen</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={async () => {
              if (deferredPrompt) {
                await deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                if (choice.outcome === 'accepted') {
                  setDeferredPrompt(null);
                }
              }
            }}
            className="btn btn-jaayenge"
            style={{ minHeight: '36px', padding: '6px 14px', fontSize: '0.85rem' }}
          >
            Install
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
              minHeight: 'auto',
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // iOS Safari instructions
  if (isIos && !isStandalone) {
    return (
      <div
        className="card"
        style={{
          position: 'fixed',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 32px)',
          maxWidth: '448px',
          zIndex: 60,
          border: '1px solid var(--border-active)',
          backgroundColor: '#1e293b',
          padding: '12px 16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Image
              src="/icons/apple-touch-icon.svg"
              alt="App Icon"
              width={32}
              height={32}
              style={{ borderRadius: '6px' }}
              unoptimized
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#f8fafc' }}>Install on iPhone</div>
              <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '2px' }}>
                Tap <span style={{ fontWeight: 700, color: '#38bdf8' }}>Share ⎋</span> and select{' '}
                <span style={{ fontWeight: 700, color: '#38bdf8' }}>&ldquo;Add to Home Screen&rdquo;</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              minHeight: 'auto',
            }}
            aria-label="Dismiss iOS tip"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return null;
}
