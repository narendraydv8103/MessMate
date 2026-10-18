'use client';

import { useState } from 'react';

export interface AvatarMember {
  id?: string;
  name?: string;
  avatarColor?: string;
  hasPhoto?: boolean;
  photoVersion?: number | null;
}

export interface AvatarProps {
  member?: AvatarMember | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function Avatar({
  member,
  size = 40,
  className,
  style,
}: AvatarProps) {
  const [hasError, setHasError] = useState(false);

  const name = member?.name || '';
  const initials = name
    ? name
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '';

  const avatarColor = member?.avatarColor || 'var(--primary, #1D4ED8)';
  const fontSize = Math.max(10, Math.round(size * 0.38));

  const shouldShowPhoto = Boolean(member?.hasPhoto && member?.id && !hasError);

  if (shouldShowPhoto) {
    const versionQuery = member?.photoVersion ? `?v=${member.photoVersion}` : '';
    const src = `/api/members/${member!.id}/photo${versionQuery}`;

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || 'Roommate profile photo'}
        onError={() => setHasError(true)}
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          objectFit: 'cover',
          display: 'block',
          flexShrink: 0,
          ...style,
        }}
        data-testid="avatar-photo"
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        backgroundColor: avatarColor,
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${fontSize}px`,
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
      title={name}
      data-testid="avatar-initials"
    >
      {initials}
    </div>
  );
}
