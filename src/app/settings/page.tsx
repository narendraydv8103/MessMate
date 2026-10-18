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
    auntyPhone: string;
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
  const [auntyPhone, setAuntyPhone] = useState('');
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
          window.matchMedia('(display-mode: standalone)').matches ||
          ('standalone' in window.navigator &&
            (window.navigator as unknown as { standalone: boolean }).standalone === true);
        setIsStandalone(standalone);

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
        setAuntyPhone(json.group.auntyPhone || '');

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
    const phoneTrimmed = auntyPhone.trim();
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
    const originalPhone = (data?.group.auntyPhone || '').trim();
    const newPhone = auntyPhone.trim();
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
          auntyPhone: auntyPhone.trim(),
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
          group: { ...data.group, auntyPhone: auntyPhone.trim() },
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
        setMessage({ text: 'Web push notifications enabled successfully on this device! 🎉', type: 'success' });
        // Refresh subscription count
        const refreshRes = await fetch('/api/settings');
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
      const resJson = await res.json().catch(() => ({}));

      if (res.status === 429) {
        setTestResult(`⏳ ${resJson.error || 'Please wait before sending another test push.'}`);
        return;
      }

      if (res.ok && resJson.success) {
        setTestResult(`✓ ${resJson.message || 'Test notification sent to your device!'}`);
      } else {
        setTestResult(`✕ ${resJson.error || 'Failed to send test push.'}`);
      }
    } catch {
      setTestResult('✕ Network error while sending test notification.');
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
        <p style={{ color: '#94a3b8' }}>Loading settings...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Settings</h1>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Configure mess details, nicknames, and alerts</p>
      </div>

      {message && (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            borderRadius: '12px',
            textAlign: 'center',
            fontSize: '0.875rem',
            fontWeight: 600,
            backgroundColor: message.type === 'success' ? 'var(--green-bg)' : 'var(--red-bg)',
            border: `1px solid ${message.type === 'success' ? 'var(--green-border)' : 'var(--red-border)'}`,
            color: message.type === 'success' ? '#34d399' : '#f87171',
          }}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSaveTrigger} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Mess Name Card */}
        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Mess Name</h2>
          <p style={{ fontSize: '0.825rem', color: '#94a3b8', marginBottom: '12px' }}>
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
          <h2 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Mess Phone Number</h2>
          <p style={{ fontSize: '0.825rem', color: '#94a3b8', marginBottom: '12px' }}>
            Used for urgent calls and prefilled WhatsApp cancellation messages.
          </p>
          <input
            type="tel"
            className="input-field"
            value={auntyPhone}
            onChange={(e) => setAuntyPhone(e.target.value)}
            placeholder="+919876543210"
            disabled={saving}
            id="aunty-phone-input"
          />
        </div>

        {/* Roommate Nicknames Card */}
        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Roommate Nicknames</h2>
          <p style={{ fontSize: '0.825rem', color: '#94a3b8', marginBottom: '14px' }}>
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
                    backgroundColor: member.avatarColor || '#3b82f6',
                    flexShrink: 0,
                  }}
                />
                <input
                  type="text"
                  maxLength={20}
                  className="input-field"
                  style={{ padding: '10px 14px' }}
                  value={memberNames[member.id] || ''}
                  onChange={(e) =>
                    setMemberNames((prev) => ({
                      ...prev,
                      [member.id]: e.target.value,
                    }))
                  }
                  placeholder="Roommate nickname (1-20 chars)"
                  disabled={saving}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Web Push Notifications Card */}
        <div className="card">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Web Push Notifications</h2>
          <p style={{ fontSize: '0.825rem', color: '#94a3b8', marginBottom: '14px' }}>
            Receive dinner reminder alerts and urgent cancellation notices directly on your phone.
          </p>

          {/* iOS Safari instruction banner */}
          {isIosDevice && !isStandalone && (
            <div
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '10px',
                padding: '10px 12px',
                fontSize: '0.8rem',
                color: '#38bdf8',
                marginBottom: '12px',
              }}
            >
              📱 <strong>iOS requirement:</strong> Push notifications require iOS 16.4+ and adding MessMate to your Home Screen (Share &gt; Add to Home Screen).
            </div>
          )}

          {/* Push status info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem', marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Browser Permission:</span>
              <span
                style={{
                  fontWeight: 600,
                  color: permissionState === 'granted' ? '#34d399' : permissionState === 'denied' ? '#f87171' : '#fbbf24',
                }}
              >
                {permissionState.toUpperCase()}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Devices subscribed for you:</span>
              <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                {data?.push.memberSubscriptionsCount || 0}
              </span>
            </div>
          </div>

          {permissionState === 'denied' && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid var(--red-border)',
                borderRadius: '10px',
                padding: '10px 12px',
                fontSize: '0.8rem',
                color: '#f87171',
                marginBottom: '14px',
              }}
            >
              ⚠️ Notifications are blocked in this browser. To receive alerts, tap the lock/info icon in your browser address bar and set Notifications to &ldquo;Allow&rdquo;.
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
              style={{ width: '100%', borderColor: 'var(--blue-border)', color: '#38bdf8' }}
            >
              {sendingTest ? 'Sending Test...' : 'Send Test Notification'}
            </button>

            {testResult && (
              <div style={{ fontSize: '0.825rem', textAlign: 'center', marginTop: '4px', color: testResult.startsWith('✓') ? '#34d399' : '#f87171' }}>
                {testResult}
              </div>
            )}
          </div>
        </div>

        {/* Status Panel */}
        <div className="card" style={{ border: '1px solid var(--border-active)' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>System Status</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Web Push</span>
              <span
                className={`badge ${data?.push.isConfigured ? 'badge-green' : 'badge-muted'}`}
              >
                {data?.push.isConfigured ? 'VAPID Configured ✓' : 'Push not configured yet'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Scheduler Heartbeat</span>
              <span
                style={{
                  fontWeight: 600,
                  color: data?.scheduler.isSchedulerStale ? '#f87171' : '#34d399',
                }}
              >
                {data?.scheduler.isSchedulerStale ? 'Stale' : 'Active'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Last Tick Time</span>
              <span style={{ color: '#cbd5e1' }}>
                {data?.scheduler.lastTickAt
                  ? new Date(data.scheduler.lastTickAt).toLocaleString()
                  : 'No heartbeat recorded'}
              </span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-jaayenge"
          disabled={saving}
          style={{ width: '100%', marginTop: '4px' }}
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
        style={{ width: '100%', borderColor: 'var(--red-border)', color: '#f87171' }}
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
          const originalPhone = (data?.group.auntyPhone || '').trim();
          const newPhone = auntyPhone.trim();
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
        message={`Are you sure you want to change the mess phone number to "${auntyPhone.trim()}"? All future calls and cancellation messages will be routed to this number.`}
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
