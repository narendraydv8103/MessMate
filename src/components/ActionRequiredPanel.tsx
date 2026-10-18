'use client';

import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

interface ActionRequiredPanelProps {
  messName?: string;
  messPhone: string;
  telUrl: string;
  whatsappUrl: string;
  prefilledWhatsAppText: string;
  callJobStatus: string | null;
  informedBy?: string | null;
  informedAt?: string | null;
  onInformedSuccess?: () => void;
  isOffline?: boolean;
}

export default function ActionRequiredPanel({
  messName = 'Mishra Tiffin Centre',
  messPhone,
  telUrl,
  whatsappUrl,
  prefilledWhatsAppText,
  callJobStatus,
  informedBy,
  informedAt,
  onInformedSuccess,
  isOffline = false,
}: ActionRequiredPanelProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // If already informed, show who and when
  if (callJobStatus === 'MESS_INFORMED') {
    const formattedDate = informedAt
      ? new Date(informedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null;

    return (
      <div
        className="card"
        style={{
          border: '1px solid var(--success-border)',
          backgroundColor: '#F0FDF4',
          marginTop: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--success)' }}>
              {messName} Informed
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {informedBy ? `${informedBy} informed ${messName}` : `${messName} was informed`}{' '}
              {formattedDate ? `at ${formattedDate}` : ''}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Only render when action is required
  if (callJobStatus !== 'ACTION_REQUIRED') {
    return null;
  }

  async function handleConfirmInformed() {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/mess/informed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Marked informed via web UI' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update informed status.');
      }

      setIsConfirmOpen(false);
      if (onInformedSuccess) {
        onInformedSuccess();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCopy() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(prefilledWhatsAppText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      className="card"
      style={{
        border: '1px solid var(--warning-border)',
        backgroundColor: '#FFFBEB',
        marginTop: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
      data-testid="action-required-panel"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div
          style={{
            padding: '6px',
            borderRadius: '8px',
            backgroundColor: '#FEF3C7',
            color: 'var(--warning)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#92400E' }}>
            Action Required: Alert {messName}!
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Deadline passed with NAHI JAAYENGE or no decision. Please contact {messName} directly.
          </p>
        </div>
      </div>

      {/* Prefilled message preview box */}
      <div
        style={{
          background: '#FFFFFF',
          padding: '12px 14px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          fontSize: '13px',
          color: 'var(--text-primary)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            Prefilled Message
          </span>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              minHeight: 'auto',
              padding: '2px 4px',
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ fontStyle: 'italic', lineHeight: 1.4, color: 'var(--text-secondary)' }}>
          &ldquo;{prefilledWhatsAppText}&rdquo;
        </div>
      </div>

      {/* Three Action Buttons: Call (primary blue), WhatsApp (green outline), I informed (neutral outline) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <a
          href={telUrl}
          className="btn btn-call"
          style={{ width: '100%', textDecoration: 'none' }}
          id="btn-call-mess"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: '8px' }}
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          Call {messName} ({messPhone})
        </a>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-whatsapp"
          style={{ width: '100%', textDecoration: 'none' }}
          id="btn-whatsapp-mess"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: '8px' }}
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          WhatsApp {messName}
        </a>

        <button
          type="button"
          className="btn btn-informed"
          onClick={() => setIsConfirmOpen(true)}
          disabled={isOffline || isSubmitting}
          style={{ width: '100%' }}
          id="btn-informed-mess"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: '8px' }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          I informed {messName}
        </button>
      </div>

      {errorMessage && (
        <p style={{ color: 'var(--danger)', fontSize: '13px', textAlign: 'center' }}>
          {errorMessage}
        </p>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Confirm You Informed ${messName}`}
        message={`Did you contact ${messName} (via phone or WhatsApp) to ensure food is not cooked for our group?`}
        confirmText={`Yes, I Informed ${messName}`}
        variant="amber"
        isSubmitting={isSubmitting}
        onConfirm={handleConfirmInformed}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </div>
  );
}
