'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

interface Member {
  id: string;
  name: string;
  avatarColor: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingMembers, setFetchingMembers] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null);

  // Fetch available roommates
  useEffect(() => {
    async function loadMembers() {
      try {
        const res = await fetch('/api/auth/members');
        if (res.ok) {
          const data = await res.json();
          if (data.members && data.members.length > 0) {
            setMembers(data.members);
            setSelectedMemberId(data.members[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load roommates:', err);
      } finally {
        setFetchingMembers(false);
      }
    }
    loadMembers();
  }, []);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds === null || lockoutSeconds <= 0) return;

    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedMemberId) {
      setErrorMessage('Please select who you are.');
      return;
    }
    if (!passcode) {
      setErrorMessage('Please enter the group passcode.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: selectedMemberId,
          passcode: passcode.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        const retryAfter = data.retryAfterSeconds || 60;
        setLockoutSeconds(retryAfter);
        setErrorMessage(`Too many failed attempts. Locked out for ${retryAfter}s.`);
        return;
      }

      if (!res.ok) {
        setErrorMessage(data.error || 'Login failed. Please check the passcode.');
        return;
      }

      // Login confirmed by backend -> Navigate to home
      router.push('/');
      router.refresh();
    } catch {
      setErrorMessage('Network error during login. Please check connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: '24px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '24px', backgroundColor: '#1e293b', marginBottom: '16px' }}>
          <Image src="/icons/icon-192.svg" alt="MessMate Logo" width={64} height={64} unoptimized />
        </div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.03em' }}>MessMate</h1>
        <p style={{ marginTop: '6px', color: '#94a3b8' }}>Roommates Mess Attendance Coordinator</p>
      </div>

      <div className="card" style={{ maxWidth: '400px', margin: '0 auto', width: '100%' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', textAlign: 'center' }}>Who is deciding?</h2>

        {lockoutSeconds !== null && lockoutSeconds > 0 && (
          <div
            role="alert"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid var(--red-border)',
              borderRadius: '12px',
              padding: '12px 14px',
              color: '#f87171',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '18px',
              textAlign: 'center',
            }}
          >
            🔒 Account locked out due to multiple failed attempts.
            <div style={{ marginTop: '4px', fontSize: '1rem', fontWeight: 700 }}>
              Try again in {lockoutSeconds} seconds
            </div>
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Roommate Selector */}
          <div>
            <label htmlFor="roommate-select" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '8px' }}>
              Select Roommate
            </label>
            {fetchingMembers ? (
              <div style={{ color: '#64748b', fontSize: '0.9rem', padding: '10px 0' }}>Loading roommates...</div>
            ) : (
              <select
                id="roommate-select"
                className="input-field"
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                disabled={loading || lockoutSeconds !== null}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Group Passcode Input */}
          <div>
            <label htmlFor="passcode-input" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '8px' }}>
              Group Passcode
            </label>
            <input
              id="passcode-input"
              type="password"
              className="input-field"
              placeholder="Enter passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={loading || lockoutSeconds !== null}
              autoComplete="current-password"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {errorMessage && lockoutSeconds === null && (
            <div role="alert" style={{ color: '#f87171', fontSize: '0.875rem', textAlign: 'center' }}>
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-jaayenge"
            disabled={loading || lockoutSeconds !== null || fetchingMembers}
            style={{ width: '100%', marginTop: '8px' }}
          >
            {loading ? 'Logging in...' : 'Enter MessMate'}
          </button>
        </form>
      </div>
    </main>
  );
}
