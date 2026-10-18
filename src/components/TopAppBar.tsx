'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Avatar, { AvatarMember } from '@/components/Avatar';

interface TopAppBarProps {
  messName?: string;
  memberName?: string;
  avatarColor?: string;
  member?: AvatarMember;
}

export default function TopAppBar({
  messName: propMessName,
  memberName: propMemberName,
  avatarColor: propAvatarColor,
  member: propMember,
}: TopAppBarProps) {
  const pathname = usePathname();
  const [fetchedData, setFetchedData] = useState<{
    messName?: string;
    member?: AvatarMember;
  } | null>(null);

  // Hide top app bar on login screen
  const isLoginPage = pathname === '/login';

  useEffect(() => {
    if (isLoginPage) return;
    if (propMemberName || propMember) return;

    let mounted = true;
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!mounted || !data) return;
        setFetchedData({
          member: data.member,
          messName: data.group?.messName,
        });
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [isLoginPage, propMemberName, propMember]);

  if (isLoginPage) return null;

  const messName = propMessName || fetchedData?.messName || 'Mishra Tiffin Centre';
  const member: AvatarMember | undefined =
    propMember ||
    (propMemberName
      ? { name: propMemberName, avatarColor: propAvatarColor }
      : fetchedData?.member);

  const memberName = member?.name || propMemberName || '';

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
          <Avatar member={member} size={32} />
        </div>
      )}
    </header>
  );
}
