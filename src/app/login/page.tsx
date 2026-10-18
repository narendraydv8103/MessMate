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
        setErrorMessage(`Too many failed attempts. Locked out for ${retryAfter} seconds.`);
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
    <main style={{ padding: '24px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', backgroundColor: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={{ display: 'inline-flex', padding: '10px', borderRadius: '16px', backgroundColor: 'var(--primary)', marginBottom: '14px', boxShadow: '0 2px 4px rgba(29, 78, 216, 0.2)' }}>
          <Image src="/icons/icon-192.svg" alt="MessMate Logo" width={56} height={56} unoptimized />
        </div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          MessMate
        </h1>
        <p style={{ marginTop: '4px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Roommates Mess Attendance Coordinator
        </p>
      </div>

      <div className="card" style={{ maxWidth: '400px', margin: '0 auto', width: '100%' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px', textAlign: 'center' }}>
          Sign in to your group
        </h2>

        {lockoutSeconds !== null && lockoutSeconds > 0 && (
          <div
            role="alert"
            className="alert-bar alert-bar-danger"
            style={{ marginBottom: '16px', flexDirection: 'column', alignItems: 'flex-start' }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Account temporarily locked</div>
            <div style={{ fontSize: '0.8rem', marginTop: '2px' }}>
              Too many failed attempts. Try again in {lockoutSeconds} seconds.
            </div>
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Roommate Selector */}
          <div>
            <label htmlFor="roommate-select" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Select Roommate
            </label>
            {fetchingMembers ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '8px 0' }}>Loading roommates...</div>
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
            <label htmlFor="passcode-input" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
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
            <div role="alert" className="alert-bar alert-bar-danger" style={{ textAlign: 'center', justifyContent: 'center' }}>
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || lockoutSeconds !== null || fetchingMembers}
            style={{ width: '100%', height: '48px', fontSize: '0.95rem', marginTop: '4px' }}
          >
            {loading ? 'Logging in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  );
}
