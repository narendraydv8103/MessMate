'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot() {
  return typeof navigator !== 'undefined' ? !navigator.onLine : false;
}

function getServerSnapshot() {
  return false;
}

export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
