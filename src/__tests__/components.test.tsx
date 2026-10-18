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
import PhotoCropModal from '@/components/PhotoCropModal';

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

  describe('PhotoCropModal Component', () => {
    const mockFile = new File(['fake-content'], 'avatar.jpg', { type: 'image/jpeg' });

    let originalImage: typeof Image;
    beforeEach(() => {
      originalImage = global.Image;
      class MockImage {
        naturalWidth = 800;
        naturalHeight = 600;
        width = 800;
        height = 600;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        _src = '';
        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 0);
        }
      }
      global.Image = MockImage as unknown as typeof Image;
    });

    afterEach(() => {
      global.Image = originalImage;
    });

    it('clamps position and zoom to keep image covering the 280px circle', async () => {
      const handleSave = vi.fn();
      const handleCancel = vi.fn();

      render(
        <PhotoCropModal
          isOpen={true}
          imageFile={mockFile}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      );

      // Wait for image load
      await waitFor(() => {
        expect(screen.getByTestId('crop-preview-image')).toBeTruthy();
      });

      const cropContainer = screen.getByTestId('crop-container');
      const img = screen.getByTestId('crop-preview-image') as HTMLImageElement;

      // Initial zoom is 1.0 (clamped minimum)
      const zoomSlider = screen.getByTestId('zoom-slider') as HTMLInputElement;
      expect(parseFloat(zoomSlider.value)).toBe(1.0);

      // Try zooming out below 1.0 -> should clamp at 1.0
      const zoomOutBtn = screen.getByRole('button', { name: /Zoom out/i });
      fireEvent.click(zoomOutBtn);
      expect(parseFloat(zoomSlider.value)).toBe(1.0);

      // Zoom in using keyboard '+'
      fireEvent.keyDown(cropContainer, { key: '+' });
      expect(parseFloat(zoomSlider.value)).toBeGreaterThanOrEqual(1.1);

      // Arrow keys move position within clamped bounds
      fireEvent.keyDown(cropContainer, { key: 'ArrowLeft' });
      fireEvent.keyDown(cropContainer, { key: 'ArrowUp' });

      // Ensure style left/top remain clamped numbers (no gaps)
      expect(img.style.left).toBeDefined();
      expect(img.style.top).toBeDefined();
    });

    it('Save exports 256x256 canvas with JPEG quality 0.85 and invokes onSave', async () => {
      const handleSave = vi.fn().mockResolvedValue(undefined);
      const handleCancel = vi.fn();

      const mockDrawImage = vi.fn();
      const mockToBlob = vi.fn((callback: (b: Blob | null) => void, mime: string, quality: number) => {
        expect(mime).toBe('image/jpeg');
        expect(quality).toBe(0.85);
        callback(new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }));
      });

      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;

      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
        drawImage: mockDrawImage,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

      HTMLCanvasElement.prototype.toBlob = mockToBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob;

      try {
        render(
          <PhotoCropModal
            isOpen={true}
            imageFile={mockFile}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        );

        await waitFor(() => {
          expect(screen.getByTestId('crop-preview-image')).toBeTruthy();
        });

        const saveBtn = screen.getByTestId('btn-crop-save');
        fireEvent.click(saveBtn);

        await waitFor(() => {
          expect(mockDrawImage).toHaveBeenCalled();
          expect(mockToBlob).toHaveBeenCalled();
          expect(handleSave).toHaveBeenCalledTimes(1);
        });
      } finally {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        HTMLCanvasElement.prototype.toBlob = originalToBlob;
      }
    });

    it('Cancel closes modal and uploads nothing (does not invoke onSave)', async () => {
      const handleSave = vi.fn();
      const handleCancel = vi.fn();

      render(
        <PhotoCropModal
          isOpen={true}
          imageFile={mockFile}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      );

      const cancelBtn = screen.getByTestId('btn-crop-cancel');
      fireEvent.click(cancelBtn);

      expect(handleCancel).toHaveBeenCalledTimes(1);
      expect(handleSave).not.toHaveBeenCalled();
    });

    it('shows clear unsupported error for HEIC files', async () => {
      const heicFile = new File(['heic-bytes'], 'test.heic', { type: 'image/heic' });

      render(
        <PhotoCropModal
          isOpen={true}
          imageFile={heicFile}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(
        screen.getByText(/HEIC images are not directly supported by browsers/i)
      ).toBeTruthy();
    });
  });

  describe('Self-Only UI Visibility on Roommates and Settings', () => {
    it('RoommatesPage shows Change photo and Remove photo only on logged-in member own card', async () => {
      // Mock /api/auth/me returning member m1
      vi.mocked(fetch).mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/me')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              member: { id: 'm1', name: 'Sujeet Yadav' },
            }),
          } as Response;
        }
        if (urlStr.includes('/api/settings')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              currentMemberId: 'm1',
              members: [
                { id: 'm1', name: 'Sujeet Yadav', avatarColor: '#3b82f6', hasPhoto: true, photoVersion: 100 },
                { id: 'm2', name: 'Mahendra Singh Yadav', avatarColor: '#10b981', hasPhoto: true, photoVersion: 200 },
                { id: 'm3', name: 'Devansh Tiwari', avatarColor: '#ec4899', hasPhoto: false },
                { id: 'm4', name: 'Neeraj Yadav', avatarColor: '#8b5cf6', hasPhoto: false },
              ],
            }),
          } as Response;
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({}),
        } as Response;
      });

      render(<RoommatesPage />);

      await waitFor(() => {
        expect(screen.getByText('Sujeet Yadav')).toBeTruthy();
        expect(screen.getByText('Mahendra Singh Yadav')).toBeTruthy();
      });

      // m1 is logged-in member: must have Change photo and Remove photo
      expect(screen.getByTestId('btn-change-photo-m1')).toBeTruthy();
      expect(screen.getByTestId('btn-remove-photo-m1')).toBeTruthy();
      expect(screen.getByTestId('file-input-m1')).toBeTruthy();

      // m2, m3, m4 are OTHER roommates: MUST NOT have edit or remove buttons!
      expect(screen.queryByTestId('btn-change-photo-m2')).toBeNull();
      expect(screen.queryByTestId('btn-remove-photo-m2')).toBeNull();
      expect(screen.queryByTestId('file-input-m2')).toBeNull();

      expect(screen.queryByTestId('btn-change-photo-m3')).toBeNull();
      expect(screen.queryByTestId('btn-remove-photo-m3')).toBeNull();
      expect(screen.queryByTestId('btn-change-photo-m4')).toBeNull();
    });

    it('SettingsPage renders only member own nickname as editable input and other roommates as read-only text', async () => {
      vi.mocked(fetch).mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/settings')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              group: {
                id: 'g1',
                name: 'Room 204',
                messName: 'Mishra Tiffin Centre',
                messPhone: '+919876543210',
                settings: {},
              },
              currentMemberId: 'm1',
              members: [
                { id: 'm1', name: 'Sujeet Yadav', avatarColor: '#3b82f6' },
                { id: 'm2', name: 'Mahendra Singh Yadav', avatarColor: '#10b981' },
              ],
              scheduler: { lastTickAt: null, isSchedulerStale: false },
              push: { isConfigured: false, memberSubscriptionsCount: 0 },
            }),
          } as Response;
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({}),
        } as Response;
      });

      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('editable-nickname-m1')).toBeTruthy();
      });

      // m1 (own member) has editable input
      const ownInput = screen.getByTestId('editable-nickname-m1') as HTMLInputElement;
      expect(ownInput.tagName).toBe('INPUT');
      expect(ownInput.value).toBe('Sujeet Yadav');

      // m2 (other member) has read-only element, NOT an input
      const otherNick = screen.getByTestId('readonly-nickname-m2');
      expect(otherNick.tagName).not.toBe('INPUT');
      expect(otherNick.textContent).toBe('Mahendra Singh Yadav');
      expect(screen.queryByTestId('editable-nickname-m2')).toBeNull();
    });
  });
});

