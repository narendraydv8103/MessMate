'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface TopAppBarProps {
  messName?: string;
  memberName?: string;
  avatarColor?: string;
}

export default function TopAppBar({
  messName: propMessName,
  memberName: propMemberName,
  avatarColor: propAvatarColor,
}: TopAppBarProps) {
  const pathname = usePathname();
  const [fetchedData, setFetchedData] = useState<{
    messName?: string;
    memberName?: string;
    avatarColor?: string;
  } | null>(null);

  // Hide top app bar on login screen
  const isLoginPage = pathname === '/login';

  useEffect(() => {
    if (isLoginPage) return;
    if (propMemberName) return;

    let mounted = true;
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!mounted || !data) return;
        setFetchedData({
          memberName: data.member?.name,
          avatarColor: data.member?.avatarColor,
          messName: data.group?.messName,
        });
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [isLoginPage, propMemberName]);

  if (isLoginPage) return null;

  const messName = propMessName || fetchedData?.messName || 'Mishra Tiffin Centre';
  const memberName = propMemberName || fetchedData?.memberName || '';
  const avatarColor = propAvatarColor || fetchedData?.avatarColor || '#1D4ED8';

  const initials = memberName
    ? memberName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '';

  return (
    <header
      style={{
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid var(--border)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
      data-testid="top-app-bar"
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          MessMate
        </span>
        <span
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            fontWeight: 500,
            marginTop: '-1px',
          }}
        >
          {messName}
        </span>
      </div>

      {memberName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              maxWidth: '120px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {memberName}
          </span>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: avatarColor || '#1D4ED8',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 600,
              flexShrink: 0,
            }}
            title={memberName}
          >
            {initials}
          </div>
        </div>
      )}
    </header>
  );
}
