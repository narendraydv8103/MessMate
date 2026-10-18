'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  isPushSupported,
  subscribeToPush,
  getExistingSubscription,
  silentResubscribeIfMissing,
} from '@/lib/push/client';

interface Member {
  id: string;
  name: string;
  avatarColor: string;
  notificationPreferences?: Record<string, unknown>;
}

interface SettingsData {
  group: {
    id: string;
    name: string;
    messName?: string;
    messPhone: string;
    settings: Record<string, unknown>;
  };
  members: Member[];
  scheduler: {
    lastTickAt: string | null;
    isSchedulerStale: boolean;
  };
  push: {
    isConfigured: boolean;
    memberSubscriptionsCount: number;
  };
}

export default function SettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<SettingsData | null>(null);
  const [messPhone, setMessPhone] = useState('');
  const [messName, setMessName] = useState('');
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Mess name & phone change confirmation modals
  const [isMessNameConfirmOpen, setIsMessNameConfirmOpen] = useState(false);
  const [isPhoneConfirmOpen, setIsPhoneConfirmOpen] = useState(false);

  // Web Push state
  const [pushSupported, setPushSupported] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Detect iOS and standalone mode
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        setIsIosDevice(/iphone|ipad|ipod/.test(userAgent));
        const standalone =
          (typeof window.matchMedia === 'function' &&
            window.matchMedia('(display-mode: standalone)').matches) ||
          ('standalone' in window.navigator &&
            (window.navigator as unknown as { standalone: boolean }).standalone === true);
        setIsStandalone(Boolean(standalone));

        const supported = isPushSupported();
        setPushSupported(supported);
        if (supported && 'Notification' in window) {
          setPermissionState(Notification.permission);
          getExistingSubscription().then((sub) => {
            setIsSubscribed(Boolean(sub));
          });
          // Silent re-subscribe if permission already granted
          void silentResubscribeIfMissing();
        }
      }, 0);
    }

    async function loadSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (!res.ok) {
          throw new Error('Failed to load settings');
        }

        const json: SettingsData = await res.json();
        setData(json);
        setMessName(json.group.messName || 'Mishra Tiffin Centre');
        setMessPhone(json.group.messPhone || '');

        const namesMap: Record<string, string> = {};
        json.members.forEach((m) => {
          namesMap[m.id] = m.name;
        });
        setMemberNames(namesMap);
      } catch (err) {
        setMessage({
          text: err instanceof Error ? err.message : 'Error loading settings',
          type: 'error',
        });
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, [router]);

  function validateInputs(): boolean {
    // 0. Mess name validation (1-40 chars)
    const messNameTrimmed = messName.trim();
    if (messNameTrimmed.length < 1 || messNameTrimmed.length > 40) {
      setMessage({
        text: 'Mess name must be between 1 and 40 characters.',
        type: 'error',
      });
      return false;
    }

    // 1. Mess phone validation
    const phoneTrimmed = messPhone.trim();
    const phoneRegex = /^\+91[6-9]\d{9}$/;
    if (!phoneRegex.test(phoneTrimmed)) {
      setMessage({
        text: 'Invalid phone number. Must start with +91 followed by 10 digits (e.g. +919876543210).',
        type: 'error',
      });
      return false;
    }

    // 2. Roommate nickname validations: length 1-20 and unique within group
    const seenNames = new Set<string>();
    for (const member of data?.members || []) {
      const name = (memberNames[member.id] || member.name || '').trim();
      if (name.length < 1 || name.length > 20) {
        setMessage({
          text: `Nickname "${name}" must be between 1 and 20 characters.`,
          type: 'error',
        });
        return false;
      }
      const lower = name.toLowerCase();
      if (seenNames.has(lower)) {
        setMessage({
          text: `Roommate nicknames must be unique within the group. Duplicate: "${name}".`,
          type: 'error',
        });
        return false;
      }
      seenNames.add(lower);
    }

    return true;
  }

  async function handleSaveTrigger(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (!validateInputs()) return;

    // Check if mess name changed
    const originalMessName = (data?.group.messName || 'Mishra Tiffin Centre').trim();
    const newMessName = messName.trim();
    if (originalMessName && newMessName !== originalMessName) {
      setIsMessNameConfirmOpen(true);
      return;
    }

    // If mess phone changed, require confirmation dialog
    const originalPhone = (data?.group.messPhone || '').trim();
    const newPhone = messPhone.trim();
    if (originalPhone && newPhone !== originalPhone) {
      setIsPhoneConfirmOpen(true);
      return;
    }

    await performSave();
  }

  async function performSave() {
    setSaving(true);
    setIsMessNameConfirmOpen(false);
    setIsPhoneConfirmOpen(false);

    try {
      const updatedMembers = data?.members.map((m) => ({
        id: m.id,
        name: (memberNames[m.id] || m.name).trim(),
      }));

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messName: messName.trim(),
          messPhone: messPhone.trim(),
          members: updatedMembers,
        }),
      });

      const resData = await res.json().catch(() => ({}));

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        setMessage({
          text: resData.error || 'Failed to update settings.',
          type: 'error',
        });
        return;
      }

      setMessage({ text: 'Settings saved successfully!', type: 'success' });
      // Refresh local group phone baseline
      if (data) {
        setData({
          ...data,
          group: { ...data.group, messPhone: messPhone.trim(), messName: messName.trim() },
        });
      }
    } catch {
      setMessage({
        text: 'Network error. Could not save settings.',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleEnablePush() {
    setEnablingPush(true);
    setMessage(null);
    try {
      const result = await subscribeToPush();
      if (result.success) {
        setIsSubscribed(true);
        setPermissionState(Notification.permission);
        setMessage({ text: 'Web push notifications enabled successfully on this device.', type: 'success' });
        // Refresh subscription count
        const refreshRes = await fetch('/api/settings');
        if (refreshRes.status === 401) {
          router.push('/login');
          return;
        }
        if (refreshRes.ok) {
          const freshData = await refreshRes.json();
          setData(freshData);
        }
      } else {
        setPermissionState(Notification.permission);
        setMessage({ text: result.error || 'Failed to enable notifications.', type: 'error' });
      }
    } finally {
      setEnablingPush(false);
    }
  }

  async function handleSendTestPush() {
    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const resJson = await res.json().catch(() => ({}));

      if (res.status === 429) {
        setTestResult(resJson.error || 'Please wait before sending another test push.');
        return;
      }

      if (res.ok && resJson.success) {
        setTestResult(resJson.message || 'Test notification sent to your device.');
      } else {
        setTestResult(resJson.error || 'Failed to send test push.');
      }
    } catch {
      setTestResult('Network error while sending test notification.');
    } finally {
      setSendingTest(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout network error:', err);
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  if (loading) {
    return (
      <main style={{ padding: '24px 20px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading settings...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '2px' }}>
          Configure mess details, nicknames, and alerts
        </p>
      </div>

      {message && (
        <div
          role="status"
          className={`alert-bar ${message.type === 'success' ? 'alert-bar-success' : 'alert-bar-danger'}`}
          style={{ justifyContent: 'center', textAlign: 'center' }}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSaveTrigger} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Mess Name Card */}
        <div className="card">
          <label htmlFor="mess-name-input" style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Mess Name
          </label>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            The name of your tiffin service or mess (1-40 characters).
          </p>
          <input
            type="text"
            maxLength={40}
            className="input-field"
            value={messName}
            onChange={(e) => setMessName(e.target.value)}
            placeholder="Mishra Tiffin Centre"
            disabled={saving}
            id="mess-name-input"
          />
        </div>

        {/* Mess Phone Card */}
        <div className="card">
          <label htmlFor="mess-phone-input" style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Mess Phone Number
          </label>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Used for urgent calls and prefilled WhatsApp cancellation messages.
          </p>
          <input
            type="tel"
            className="input-field"
            value={messPhone}
            onChange={(e) => setMessPhone(e.target.value)}
            placeholder="+919876543210"
            disabled={saving}
            id="mess-phone-input"
          />
        </div>

        {/* Roommate Nicknames Card */}
        <div className="card">
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Roommate Nicknames
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Must be 1-20 characters and unique within the group.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {data?.members.map((member) => (
              <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: member.avatarColor || 'var(--primary)',
                    flexShrink: 0,
                  }}
                />
                <input
                  type="text"
                  maxLength={20}
                  className="input-field"
                  style={{ padding: '8px 12px' }}
                  value={memberNames[member.id] || ''}
                  onChange={(e) =>
                    setMemberNames((prev) => ({
                      ...prev,
                      [member.id]: e.target.value,
                    }))
                  }
                  placeholder="Roommate nickname (1-20 chars)"
                  disabled={saving}
                  aria-label={`Nickname for member ${member.name}`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Web Push Notifications Card */}
        <div className="card">
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Web Push Notifications
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Receive dinner reminder alerts and urgent cancellation notices directly on your phone.
          </p>

          {/* iOS Safari instruction banner */}
          {isIosDevice && !isStandalone && (
            <div className="alert-bar alert-bar-info" style={{ marginBottom: '12px' }}>
              <span>iOS requirement: Push notifications require iOS 16.4+ and adding MessMate to your Home Screen (Share &gt; Add to Home Screen).</span>
            </div>
          )}

          {/* Push status info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Browser Permission:</span>
              <span
                style={{
                  fontWeight: 600,
                  color: permissionState === 'granted' ? 'var(--success)' : permissionState === 'denied' ? 'var(--danger)' : 'var(--warning)',
                }}
              >
                {permissionState}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Devices subscribed for you:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {data?.push.memberSubscriptionsCount || 0}
              </span>
            </div>
          </div>

          {permissionState === 'denied' && (
            <div className="alert-bar alert-bar-danger" style={{ marginBottom: '14px' }}>
              <span>Notifications are blocked in this browser. To receive alerts, open site settings in your browser and allow notifications.</span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleEnablePush}
              disabled={enablingPush || permissionState === 'denied' || !pushSupported}
              id="btn-enable-push"
              style={{ width: '100%' }}
            >
              {enablingPush ? 'Requesting Permission...' : isSubscribed ? 'Re-subscribe / Update Device Push' : 'Enable Push Notifications'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSendTestPush}
              disabled={sendingTest || !data?.push.isConfigured}
              id="btn-test-push"
              style={{ width: '100%', borderColor: 'var(--primary)', color: 'var(--primary)' }}
            >
              {sendingTest ? 'Sending Test...' : 'Send Test Notification'}
            </button>

            {testResult && (
              <div style={{ fontSize: '0.8rem', textAlign: 'center', marginTop: '4px', color: 'var(--text-secondary)' }}>
                {testResult}
              </div>
            )}
          </div>
        </div>

        {/* System Status Panel */}
        <div className="card">
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
            System Status
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Web Push</span>
              <span className={`badge ${data?.push.isConfigured ? 'badge-green' : 'badge-muted'}`}>
                {data?.push.isConfigured ? 'VAPID Configured' : 'Push not configured'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Scheduler Heartbeat</span>
              <span style={{ fontWeight: 600, color: data?.scheduler.isSchedulerStale ? 'var(--danger)' : 'var(--success)' }}>
                {data?.scheduler.isSchedulerStale ? 'Stale' : 'Active'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Last Tick Time</span>
              <span style={{ color: 'var(--text-primary)' }}>
                {data?.scheduler.lastTickAt
                  ? new Date(data.scheduler.lastTickAt).toLocaleString()
                  : 'No heartbeat recorded'}
              </span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
          style={{ width: '100%', height: '48px', fontSize: '0.95rem' }}
          id="btn-save-settings"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* Logout button */}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleLogout}
        disabled={loggingOut}
        style={{ width: '100%', borderColor: 'var(--danger)', color: 'var(--danger)' }}
        id="btn-logout"
      >
        {loggingOut ? 'Logging out...' : 'Log Out'}
      </button>

      {/* Mess Name Change Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isMessNameConfirmOpen}
        title="Change Mess Name?"
        message={`Are you sure you want to update the mess name to "${messName.trim()}"? This name will be displayed across all roommate screens, status badges, and alert notifications.`}
        confirmText="Confirm Name Change"
        variant="amber"
        isSubmitting={saving}
        onConfirm={async () => {
          setIsMessNameConfirmOpen(false);
          const originalPhone = (data?.group.messPhone || '').trim();
          const newPhone = messPhone.trim();
          if (originalPhone && newPhone !== originalPhone) {
            setIsPhoneConfirmOpen(true);
          } else {
            await performSave();
          }
        }}
        onCancel={() => setIsMessNameConfirmOpen(false)}
      />

      {/* Mess Phone Change Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isPhoneConfirmOpen}
        title="Change Mess Phone Number?"
        message={`Are you sure you want to change the mess phone number to "${messPhone.trim()}"? All future calls and cancellation messages will be routed to this number.`}
        confirmText="Confirm Phone Change"
        variant="amber"
        isSubmitting={saving}
        onConfirm={performSave}
        onCancel={() => setIsPhoneConfirmOpen(false)}
      />

      <BottomNav />
    </main>
  );
}
