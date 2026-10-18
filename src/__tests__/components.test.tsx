// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActionRequiredPanel from '@/components/ActionRequiredPanel';
import OfflineBanner from '@/components/OfflineBanner';
import CountdownTimer from '@/components/CountdownTimer';
import HomePage from '@/app/page';
import Avatar from '@/components/Avatar';
import RoommatesPage from '@/app/roommates/page';
import HistoryPage from '@/app/history/page';
import SettingsPage from '@/app/settings/page';

// Mock next/navigation
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  usePathname: () => '/',
}));

describe('Frontend Component Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({}),
    } as Response));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ConfirmDialog Component', () => {
    it('renders title, message, and invokes onConfirm only after clicking confirm', () => {
      const handleConfirm = vi.fn();
      const handleCancel = vi.fn();

      const { rerender } = render(
        <ConfirmDialog
          isOpen={false}
          title="Confirm Eating"
          message="Are you sure you want to go?"
          confirmText="Yes, Go"
          variant="green"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      );

      // Not rendered when isOpen is false
      expect(screen.queryByText('Confirm Eating')).toBeNull();

      // Open dialog
      rerender(
        <ConfirmDialog
          isOpen={true}
          title="Confirm Eating"
          message="Are you sure you want to go?"
          confirmText="Yes, Go"
          variant="green"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      );

      expect(screen.getByText('Confirm Eating')).toBeTruthy();
      expect(screen.getByText('Are you sure you want to go?')).toBeTruthy();

      // Click Confirm
      const confirmBtn = screen.getByText('Yes, Go');
      fireEvent.click(confirmBtn);
      expect(handleConfirm).toHaveBeenCalledTimes(1);
      expect(handleCancel).not.toHaveBeenCalled();

      // Click Cancel
      const cancelBtn = screen.getByText('Cancel');
      fireEvent.click(cancelBtn);
      expect(handleCancel).toHaveBeenCalledTimes(1);
    });

    it('disables buttons while submitting', () => {
      render(
        <ConfirmDialog
          isOpen={true}
          title="Submitting Action"
          message="Processing..."
          confirmText="Confirm"
          variant="red"
          isSubmitting={true}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      const confirmBtn = screen.getByText('Confirming...');
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

      const cancelBtn = screen.getByText('Cancel');
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('ActionRequiredPanel Component', () => {
    const mockProps = {
      messPhone: '+919876543210',
      telUrl: 'tel:+919876543210',
      whatsappUrl: 'https://wa.me/919876543210?text=test',
      prefilledWhatsAppText: 'Namaste, aaj hum chaaron mess mein khana khane nahi aayenge. Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad.',
      callJobStatus: 'ACTION_REQUIRED',
    };

    it('renders Call Mishra Tiffin Centre, WhatsApp, and I informed Mishra Tiffin Centre buttons when ACTION_REQUIRED', () => {
      render(<ActionRequiredPanel {...mockProps} />);

      const callLink = screen.getByText(/Call Mishra Tiffin Centre/i).closest('a');
      expect(callLink?.getAttribute('href')).toBe('tel:+919876543210');

      const waLink = screen.getByText(/WhatsApp Mishra Tiffin Centre/i).closest('a');
      expect(waLink?.getAttribute('href')).toContain('https://wa.me/919876543210');

      const informedBtn = screen.getByText(/I informed Mishra Tiffin Centre/i);
      expect(informedBtn).toBeTruthy();
    });

    it('opens confirm dialog and sends POST /api/mess/informed on confirm', async () => {
      const handleSuccess = vi.fn();
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

      render(<ActionRequiredPanel {...mockProps} onInformedSuccess={handleSuccess} />);

      // Click "I informed Mishra Tiffin Centre" button
      const openDialogBtn = screen.getByText(/I informed Mishra Tiffin Centre/i);
      fireEvent.click(openDialogBtn);

      // Confirm dialog is open
      const confirmActionBtn = screen.getByText('Yes, I Informed Mishra Tiffin Centre');
      fireEvent.click(confirmActionBtn);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/mess/informed', expect.objectContaining({
          method: 'POST',
        }));
        expect(handleSuccess).toHaveBeenCalledTimes(1);
      });
    });

    it('shows who informed and when once callJobStatus is MESS_INFORMED', () => {
      render(
        <ActionRequiredPanel
          {...mockProps}
          callJobStatus="MESS_INFORMED"
          informedBy="Neeraj Yadav"
          informedAt="2026-10-18T21:35:00+05:30"
        />
      );

      expect(screen.getByText('Mishra Tiffin Centre Informed')).toBeTruthy();
      expect(screen.getByText(/Neeraj Yadav informed Mishra Tiffin Centre/i)).toBeTruthy();
      expect(screen.queryByText(/Call Mishra Tiffin Centre/i)).toBeNull();
    });
  });

  describe('OfflineBanner & Offline Behavior', () => {
    it('shows offline warning when offline and hides when back online', () => {
      const originalOnLine = navigator.onLine;

      try {
        // Mock offline
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

        const { rerender } = render(<OfflineBanner />);
        expect(screen.getByText(/You are offline, decision not saved/i)).toBeTruthy();

        // Simulate online event
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
        fireEvent(window, new Event('online'));

        rerender(<OfflineBanner />);
        expect(screen.queryByText(/You are offline, decision not saved/i)).toBeNull();
      } finally {
        Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
      }
    });
  });

  describe('CountdownTimer Component', () => {
    it('calculates countdown from server time rather than client clock', () => {
      // 1 hour difference: server is 20:30, deadline is 21:30
      const serverTime = '2026-10-18T20:30:00+05:30';
      const deadlineTime = '2026-10-18T21:30:00+05:30';

      render(<CountdownTimer serverTime={serverTime} deadlineTime={deadlineTime} />);

      // Should show 01:00:00
      expect(screen.getByText(/01:00:00/)).toBeTruthy();
    });

    it('shows Deadline Passed when current server time is past deadline', () => {
      const serverTime = '2026-10-18T21:35:00+05:30';
      const deadlineTime = '2026-10-18T21:30:00+05:30';

      render(<CountdownTimer serverTime={serverTime} deadlineTime={deadlineTime} />);
      expect(screen.getByText(/Deadline Passed/i)).toBeTruthy();
    });
  });

  describe('Home Page Decision Confirm Flow & 401 Redirect', () => {
    it('redirects to /login when /api/status returns 401', async () => {
      vi.mocked(fetch).mockImplementation(async () => {
        return {
          status: 401,
          ok: false,
          json: async () => ({ error: 'Unauthorized' }),
        } as Response;
      });

      render(<HomePage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });

    it('initiates confirm dialog, submits decision with idempotencyKey, and updates UI on confirmation', async () => {
      // 1. Initial /api/status fetch
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          mealDate: '2026-10-18',
          mealPeriod: 'DINNER',
          serverTime: '2026-10-18T20:30:00+05:30',
          reminderTime: '2026-10-18T20:00:00+05:30',
          deadlineTime: '2026-10-18T21:30:00+05:30',
          isBeforeDeadline: true,
          decision: null,
          submittedBy: null,
          submittedAt: null,
          statusLabel: 'No Decision',
          callJobStatus: 'PENDING',
          messPhone: '+919876543210',
          prefilledWhatsAppText: 'Namaste, aaj hum chaaron mess mein khana khane nahi aayenge. Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad.',
          whatsappUrl: 'https://wa.me/919876543210',
          telUrl: 'tel:+919876543210',
          isSchedulerStale: false,
        }),
      } as Response);

      render(<HomePage />);

      // Wait for status to load
      await waitFor(() => {
        expect(screen.getByText(/No Decision/i)).toBeTruthy();
      });

      // 2. Click JAAYENGE button -> opens ConfirmDialog
      const jaayengeBtn = screen.getByRole('button', { name: /Confirm eating at mess/i });
      fireEvent.click(jaayengeBtn);

      // Confirm dialog opens
      expect(screen.getByText('Confirm: Eating at Mess')).toBeTruthy();

      // Mock decision submission response
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          decision: { decision: 'JAAYENGE' },
          statusLabel: 'Decision Saved',
        }),
      } as Response);

      // Mock updated status response after submission
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          mealDate: '2026-10-18',
          mealPeriod: 'DINNER',
          serverTime: '2026-10-18T20:31:00+05:30',
          reminderTime: '2026-10-18T20:00:00+05:30',
          deadlineTime: '2026-10-18T21:30:00+05:30',
          isBeforeDeadline: true,
          decision: 'JAAYENGE',
          submittedBy: 'Aarav',
          submittedAt: '2026-10-18T20:31:00+05:30',
          statusLabel: 'Decision Saved',
          callJobStatus: 'CANCELLED',
          messPhone: '+919876543210',
          prefilledWhatsAppText: 'Namaste, aaj hum chaaron mess mein khana khane nahi aayenge. Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad.',
          whatsappUrl: 'https://wa.me/919876543210',
          telUrl: 'tel:+919876543210',
          isSchedulerStale: false,
        }),
      } as Response);

      // Confirm the decision in the dialog
      const confirmDialogBtn = screen.getByText('Yes, JAAYENGE');
      fireEvent.click(confirmDialogBtn);

      // Verify POST /api/decisions was called with idempotencyKey
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/decisions', expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"decision":"JAAYENGE"'),
        }));
      });

      // Confirm success feedback displayed
      await waitFor(() => {
        expect(screen.getByText(/Decision "JAAYENGE" confirmed!/i)).toBeTruthy();
      });
    });

    it('renders Push Delivery Failure Banner when ACTION_REQUIRED and urgentPushFailed is true', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          mealDate: '2026-10-18',
          mealPeriod: 'DINNER',
          serverTime: '2026-10-18T21:35:00+05:30',
          reminderTime: '2026-10-18T20:00:00+05:30',
          deadlineTime: '2026-10-18T21:30:00+05:30',
          isBeforeDeadline: false,
          decision: 'NAHI_JAAYENGE',
          submittedBy: 'Aarav',
          submittedAt: '2026-10-18T21:00:00+05:30',
          statusLabel: 'Action Required',
          callJobStatus: 'ACTION_REQUIRED',
          messPhone: '+919876543210',
          prefilledWhatsAppText: 'Namaste, aaj hum chaaron mess mein khana khane nahi aayenge. Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad.',
          whatsappUrl: 'https://wa.me/919876543210',
          telUrl: 'tel:+919876543210',
          isSchedulerStale: false,
          urgentPushFailed: true,
          hasGroupSubscriptions: true,
        }),
      } as Response);

      render(<HomePage />);

      await waitFor(() => {
        expect(screen.getByText(/Push could not be sent. Please inform Mishra Tiffin Centre yourself./i)).toBeTruthy();
      });
    });

    it('renders No Group Subscriptions Banner when hasGroupSubscriptions is false', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          mealDate: '2026-10-18',
          mealPeriod: 'DINNER',
          serverTime: '2026-10-18T20:00:00+05:30',
          reminderTime: '2026-10-18T20:00:00+05:30',
          deadlineTime: '2026-10-18T21:30:00+05:30',
          isBeforeDeadline: true,
          decision: null,
          submittedBy: null,
          submittedAt: null,
          statusLabel: 'No Decision',
          callJobStatus: 'PENDING',
          messPhone: '+919876543210',
          prefilledWhatsAppText: 'Namaste, aaj hum chaaron mess mein khana khane nahi aayenge. Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad.',
          whatsappUrl: 'https://wa.me/919876543210',
          telUrl: 'tel:+919876543210',
          isSchedulerStale: false,
          hasGroupSubscriptions: false,
        }),
      } as Response);

      render(<HomePage />);

      await waitFor(() => {
        expect(screen.getByText(/No device in your group is subscribed for push notifications/i)).toBeTruthy();
      });
    });
  });

  describe('Avatar Component', () => {
    it('renders initials with avatarColor when hasPhoto is false or absent', () => {
      render(
        <Avatar
          member={{
            id: 'm1',
            name: 'Sujeet Yadav',
            avatarColor: '#3b82f6',
            hasPhoto: false,
          }}
          size={40}
        />
      );

      const initialsElement = screen.getByTestId('avatar-initials');
      expect(initialsElement.textContent).toBe('SY');
      expect(initialsElement.style.backgroundColor).toBe('rgb(59, 130, 246)');
      expect(screen.queryByTestId('avatar-photo')).toBeNull();
    });

    it('renders img with correct src and alt when hasPhoto is true', () => {
      render(
        <Avatar
          member={{
            id: 'm-photo-1',
            name: 'Sujeet Yadav',
            avatarColor: '#3b82f6',
            hasPhoto: true,
            photoVersion: 1776518400000,
          }}
          size={48}
        />
      );

      const imgElement = screen.getByTestId('avatar-photo') as HTMLImageElement;
      expect(imgElement).toBeTruthy();
      expect(imgElement.getAttribute('src')).toBe('/api/members/m-photo-1/photo?v=1776518400000');
      expect(imgElement.getAttribute('alt')).toBe('Sujeet Yadav');
      expect(imgElement.style.borderRadius).toBe('50%');
      expect(imgElement.style.objectFit).toBe('cover');
    });

    it('falls back to initials on image load error', () => {
      render(
        <Avatar
          member={{
            id: 'm-photo-2',
            name: 'Devansh Tiwari',
            avatarColor: '#ec4899',
            hasPhoto: true,
            photoVersion: 9999,
          }}
          size={36}
        />
      );

      // Initially renders img
      const imgElement = screen.getByTestId('avatar-photo');
      expect(imgElement).toBeTruthy();

      // Trigger error on image
      fireEvent.error(imgElement);

      // Should now fall back to initials
      expect(screen.queryByTestId('avatar-photo')).toBeNull();
      const initialsElement = screen.getByTestId('avatar-initials');
      expect(initialsElement.textContent).toBe('DT');
      expect(initialsElement.style.backgroundColor).toBe('rgb(236, 72, 153)');
    });
  });

  describe('401 Redirects across Pages', () => {
    it('redirects RoommatesPage to /login when API returns 401', async () => {
      vi.mocked(fetch).mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({ error: 'Unauthorized' }),
      } as Response);

      render(<RoommatesPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });

    it('redirects HistoryPage to /login when /api/history returns 401', async () => {
      vi.mocked(fetch).mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({ error: 'Unauthorized' }),
      } as Response);

      render(<HistoryPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });

    it('redirects SettingsPage to /login when /api/settings returns 401', async () => {
      vi.mocked(fetch).mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => ({ error: 'Unauthorized' }),
      } as Response);

      render(<SettingsPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });
  });
});

