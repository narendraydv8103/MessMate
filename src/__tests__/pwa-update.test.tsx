// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import UpdatePrompt from '@/components/UpdatePrompt';
import { getAppVersion, getShortAppVersion } from '@/lib/version';
import nextConfig from '../../next.config';

describe('PWA In-App Update Flow & Versioning', () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let mockWaitingWorker: ServiceWorker;
  let mockRegistration: Partial<ServiceWorkerRegistration>;
  let controllerChangeListeners: Array<() => void>;
  let originalReload: typeof window.location.reload;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

    mockPostMessage = vi.fn();
    mockUpdate = vi.fn().mockResolvedValue(undefined);
    controllerChangeListeners = [];

    mockWaitingWorker = {
      postMessage: mockPostMessage,
      state: 'installed',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorker;

    mockRegistration = {
      waiting: mockWaitingWorker,
      installing: null,
      active: null,
      update: mockUpdate as unknown as () => Promise<ServiceWorkerRegistration>,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    // Mock navigator.serviceWorker
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        controller: { state: 'activated' } as ServiceWorker,
        register: vi.fn().mockResolvedValue(mockRegistration),
        addEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === 'controllerchange') {
            controllerChangeListeners.push(listener);
          }
        }),
        removeEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === 'controllerchange') {
            controllerChangeListeners = controllerChangeListeners.filter((l) => l !== listener);
          }
        }),
      },
      writable: true,
      configurable: true,
    });

    // Mock window.location.reload
    originalReload = window.location.reload;
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        reload: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    window.location.reload = originalReload;
    vi.restoreAllMocks();
  });

  describe('UpdatePrompt Component Tests', () => {
    it('1. banner shown when a waiting worker exists', async () => {
      render(<UpdatePrompt />);

      await waitFor(() => {
        expect(screen.getByTestId('update-banner')).toBeTruthy();
      });

      expect(screen.getByText('New version available')).toBeTruthy();
      expect(screen.getByTestId('btn-update-now')).toBeTruthy();
      expect(screen.getByTestId('btn-update-later')).toBeTruthy();

      // Clicking "Later" dismisses the banner and records to sessionStorage
      fireEvent.click(screen.getByTestId('btn-update-later'));
      expect(screen.queryByTestId('update-banner')).toBeNull();
      expect(sessionStorage.getItem('messmate_update_dismissed')).toBe('true');
    });

    it('2. not shown on first install', async () => {
      // On first install, navigator.serviceWorker.controller is null
      Object.defineProperty(navigator.serviceWorker, 'controller', {
        value: null,
        writable: true,
        configurable: true,
      });

      let stateChangeListener: (() => void) | null = null;
      let updateFoundListener: (() => void) | null = null;

      const installingWorker = {
        state: 'installing',
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === 'statechange') {
            stateChangeListener = cb;
          }
        }),
        removeEventListener: vi.fn(),
      } as unknown as ServiceWorker;

      const firstInstallReg: Partial<ServiceWorkerRegistration> = {
        waiting: null,
        installing: installingWorker,
        update: mockUpdate as unknown as () => Promise<ServiceWorkerRegistration>,
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === 'updatefound') {
            updateFoundListener = cb;
          }
        }),
        removeEventListener: vi.fn(),
      };

      vi.mocked(navigator.serviceWorker.register).mockResolvedValue(firstInstallReg as ServiceWorkerRegistration);

      render(<UpdatePrompt />);

      // Trigger updatefound and worker installed
      await act(async () => {
        if (updateFoundListener) updateFoundListener();
        Object.defineProperty(installingWorker, 'state', { value: 'installed', configurable: true });
        if (stateChangeListener) stateChangeListener();
      });

      // Because controller is null (first install), banner must NOT be shown
      expect(screen.queryByTestId('update-banner')).toBeNull();
      expect(screen.queryByText('New version available')).toBeNull();
    });

    it('3. Update sends SKIP_WAITING', async () => {
      render(<UpdatePrompt />);

      await waitFor(() => {
        expect(screen.getByTestId('btn-update-now')).toBeTruthy();
      });

      // Click "Update" button
      fireEvent.click(screen.getByTestId('btn-update-now'));

      // Assert postMessage called with { type: 'SKIP_WAITING' }
      expect(mockPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    });

    it('4. reload guard prevents loops', async () => {
      render(<UpdatePrompt />);

      await waitFor(() => {
        expect(controllerChangeListeners.length).toBeGreaterThan(0);
      });

      // Fire controllerchange once
      act(() => {
        controllerChangeListeners.forEach((listener) => listener());
      });
      expect(window.location.reload).toHaveBeenCalledTimes(1);

      // Fire controllerchange a second time (e.g. rapid events or multiple claims)
      act(() => {
        controllerChangeListeners.forEach((listener) => listener());
      });

      // Guard should ensure reload is NOT called again
      expect(window.location.reload).toHaveBeenCalledTimes(1);
    });

    it('5. banner suppressed while submitting', async () => {
      // When isSubmitting is true, the banner must be suppressed
      const { rerender } = render(<UpdatePrompt isSubmitting={true} />);

      expect(screen.queryByTestId('update-banner')).toBeNull();
      expect(screen.queryByText('New version available')).toBeNull();

      // Controller change should NOT trigger reload while submitting
      await act(async () => {
        controllerChangeListeners.forEach((listener) => listener());
      });
      expect(window.location.reload).not.toHaveBeenCalled();

      // When isSubmitting becomes false, banner shows
      rerender(<UpdatePrompt isSubmitting={false} />);
      await waitFor(() => {
        expect(screen.getByTestId('update-banner')).toBeTruthy();
      });
    });
  });

  describe('Version Utilities & Short Version Formatting', () => {
    it('formats 40-character Git SHA to short 7-character hash', () => {
      const fullGitSha = 'a46982a5f67b8c1234567890abcdef1234567890';
      expect(getShortAppVersion(fullGitSha)).toBe('a46982a');
    });

    it('formats timestamps or handles default dev version', () => {
      expect(getShortAppVersion('dev')).toBe('dev');
      expect(getShortAppVersion('1776518400000')).toBe('1776518');
      expect(getShortAppVersion('v1.0')).toBe('v1.0');
    });

    it('getAppVersion returns non-empty version string', () => {
      const version = getAppVersion();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });
  });

  describe('Next.js Config Headers for Service Worker & Manifest', () => {
    it('sets Cache-Control no-cache headers for /sw.js and /manifest.json', async () => {
      expect(typeof nextConfig.headers).toBe('function');
      if (nextConfig.headers) {
        const headersList = await nextConfig.headers();
        const swHeader = headersList.find((h) => h.source === '/sw.js');
        const manifestHeader = headersList.find((h) => h.source === '/manifest.json');

        expect(swHeader).toBeDefined();
        expect(swHeader?.headers).toContainEqual({
          key: 'Cache-Control',
          value: 'no-cache, no-store, must-revalidate',
        });

        expect(manifestHeader).toBeDefined();
        expect(manifestHeader?.headers).toContainEqual({
          key: 'Cache-Control',
          value: 'no-cache, no-store, must-revalidate',
        });
      }
    });

    it('exposes NEXT_PUBLIC_APP_VERSION in nextConfig.env', () => {
      expect(nextConfig.env?.NEXT_PUBLIC_APP_VERSION).toBeDefined();
      expect(typeof nextConfig.env?.NEXT_PUBLIC_APP_VERSION).toBe('string');
    });
  });
});
