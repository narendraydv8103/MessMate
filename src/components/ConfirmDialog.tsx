'use client';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  variant: 'green' | 'red' | 'amber';
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText = 'Cancel',
  variant,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const confirmBg =
    variant === 'green' ? 'var(--success)' : variant === 'red' ? 'var(--danger)' : 'var(--warning)';

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div className="modal-content">
        <h2
          id="dialog-title"
          style={{
            marginBottom: '8px',
            fontSize: '16px',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h2>
        <p
          style={{
            marginBottom: '20px',
            color: 'var(--text-secondary)',
            fontSize: '14px',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              flex: 1,
              background: '#FFFFFF',
              border: '1px solid #CBD5E1',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              minHeight: '44px',
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onConfirm}
            disabled={isSubmitting}
            style={{
              flex: 1.2,
              background: confirmBg,
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 600,
              minHeight: '44px',
            }}
          >
            {isSubmitting ? 'Confirming...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
